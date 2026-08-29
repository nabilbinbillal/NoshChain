import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeConfig } from "../config.js";
import { Blockchain } from "../blockchain.js";
import { NoshWallet } from "../wallet.js";
import {
  GENESIS_ALLOCATION,
  MIN_FEE,
  WEI_PER_NOSH,
  CHAIN_ID_STRING,
} from "../types.js";
import { calculateBlockReward } from "../crypto.js";
import { getBalance } from "../state.js";
import { loadState } from "../storage.js";

function testConfig(dataFile: string): NodeConfig {
  return {
    port: 0,
    peerUrls: [],
    dataFile,
    nodeEnv: "test",
    chainId: 13371337n,
    networkName: "noshchain-testnet",
    initialDifficulty: 2,
    targetBlockTimeMs: 60_000,
    difficultyAdjustmentInterval: 10,
    maxBodySize: 1024 * 1024,
  };
}

function withTempChain(
  fn: (blockchain: Blockchain, dataFile: string) => void | Promise<void>
) {
  const dir = mkdtempSync(join(tmpdir(), "noshchain-"));
  const dataFile = join(dir, "chain.json");

  return async () => {
    try {
      const blockchain = new Blockchain(testConfig(dataFile));
      await fn(blockchain, dataFile);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  "genesis allocation",
  withTempChain((blockchain) => {
    const balance = blockchain.getBalance(GENESIS_ALLOCATION.address);
    assert.equal(balance, 21_000_000n * WEI_PER_NOSH);
  })
);

test(
  "mine block with reward",
  withTempChain((blockchain) => {
    const miner = new NoshWallet();
    const block = blockchain.mineBlock(miner.address);

    assert.equal(block.index, 1);
    assert.equal(block.miner, miner.address);
    assert.equal(block.chainId, CHAIN_ID_STRING);
    assert.equal(
      blockchain.getBalance(miner.address),
      calculateBlockReward(1)
    );
  })
);

test(
  "transaction requires mining to affect balance",
  withTempChain((blockchain) => {
    const sender = new NoshWallet();
    const recipient = new NoshWallet();

    blockchain.mineBlock(sender.address);

    const tx = sender.sign(
      sender.address,
      recipient.address,
      WEI_PER_NOSH.toString(),
      MIN_FEE.toString(),
      0
    );

    blockchain.addTransaction(tx);
    assert.equal(blockchain.getBalance(recipient.address), 0n);

    blockchain.mineBlock(sender.address);
    assert.equal(blockchain.getBalance(recipient.address), WEI_PER_NOSH);
  })
);

test(
  "insufficient balance rejected",
  withTempChain((blockchain) => {
    const sender = new NoshWallet();
    const recipient = new NoshWallet();

    const tx = sender.sign(
      sender.address,
      recipient.address,
      WEI_PER_NOSH.toString(),
      MIN_FEE.toString(),
      0
    );

    assert.throws(() => blockchain.addTransaction(tx), /Insufficient/);
  })
);

test(
  "invalid nonce rejected",
  withTempChain((blockchain) => {
    const sender = new NoshWallet();
    const recipient = new NoshWallet();
    blockchain.mineBlock(sender.address);

    const tx = sender.sign(
      sender.address,
      recipient.address,
      WEI_PER_NOSH.toString(),
      MIN_FEE.toString(),
      1
    );

    assert.throws(() => blockchain.addTransaction(tx), /nonce/i);
  })
);

test(
  "fees go to miner",
  withTempChain((blockchain) => {
    const miner = new NoshWallet();
    const recipient = new NoshWallet();

    blockchain.mineBlock(miner.address);
    const minerBefore = blockchain.getBalance(miner.address);

    const sendAmount = WEI_PER_NOSH / 2n;
    const signed = miner.sign(
      miner.address,
      recipient.address,
      sendAmount.toString(),
      MIN_FEE.toString(),
      0
    );
    blockchain.addTransaction(signed);
    blockchain.mineBlock(miner.address);

    const minerAfter = blockchain.getBalance(miner.address);
    const reward = calculateBlockReward(2);

    assert.equal(
      minerAfter,
      minerBefore - sendAmount - MIN_FEE + reward + MIN_FEE
    );
  })
);

test(
  "persistence survives restart",
  withTempChain(async (blockchain, dataFile) => {
    const miner = new NoshWallet();
    blockchain.mineBlock(miner.address);

    const restarted = new Blockchain(testConfig(dataFile));
    assert.equal(restarted.getChain().length, 2);
    assert.equal(
      restarted.getBalance(miner.address),
      calculateBlockReward(1)
    );

    const stored = loadState(dataFile);
    assert.ok(stored);
    assert.equal(stored.chain.length, 2);
  })
);

test(
  "replaceChain rejects invalid chain",
  withTempChain((blockchain) => {
    const badChain = [...blockchain.getChain()];
    badChain.push({
      index: 1,
      timestamp: Date.now(),
      transactions: [],
      previousHash: "bad",
      hash: "bad",
      miner: "0000000000000000000000000000000000000000",
      difficulty: 1,
      powNonce: 0,
      chainId: CHAIN_ID_STRING,
    });

    assert.throws(
      () => blockchain.replaceChain(badChain),
      /validation/i
    );
  })
);

test(
  "overflow protection on large amounts",
  withTempChain((blockchain) => {
    const sender = new NoshWallet();
    blockchain.mineBlock(sender.address);

    const recipient = new NoshWallet();
    const huge = (2n ** 200n).toString();

    assert.throws(() => {
      const tx = sender.sign(
        sender.address,
        recipient.address,
        huge,
        MIN_FEE.toString(),
        0
      );
      blockchain.addTransaction(tx);
    });
  })
);

test(
  "getBalance from state module",
  withTempChain((blockchain) => {
    const chain = blockchain.getChain();
    assert.equal(
      getBalance(chain, GENESIS_ALLOCATION.address),
      21_000_000n * WEI_PER_NOSH
    );
  })
);
