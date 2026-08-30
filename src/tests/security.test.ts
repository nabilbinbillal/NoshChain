import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeConfig } from "../config.js";
import { Blockchain, createGenesisBlock } from "../blockchain.js";
import { NoshWallet } from "../wallet.js";
import {
  GENESIS_ALLOCATION,
  MIN_FEE,
  WEI_PER_NOSH,
  CHAIN_ID_STRING,
  MINING_REWARD_SENDER,
  GENESIS_TIMESTAMP,
  INITIAL_SUPPLY,
} from "../types.js";
import {
  validChain,
  verifyGenesisBlock,
  verifyBlock,
  compareChains,
  verifyTransaction,
} from "../validation.js";
import { calculateBlockReward, blockHash, meetsDifficulty } from "../crypto.js";
import { saveStateDb } from "../storage-db.js";

function testConfig(dataFile: string): NodeConfig {
  return {
    port: 0,
    peerUrls: [],
    dataFile,
    nodeEnv: "test",
    chainId: 13371337n,
    networkName: "noshchain-testnet",
    initialDifficulty: 1,
    targetBlockTimeMs: 60_000,
    difficultyAdjustmentInterval: 10,
    maxBodySize: 1024 * 1024,
    logLevel: "error",
    logDir: "logs",
    enableWs: false,
    enableRateLimit: false,
    corsOrigins: ["*"],
  };
}

function withTempChain(
  fn: (blockchain: Blockchain, dataFile: string) => void | Promise<void>
) {
  const dir = mkdtempSync(join(tmpdir(), "noshchain-sec-"));
  const dataFile = join(dir, "chain.db");

  return async () => {
    try {
      const blockchain = new Blockchain(testConfig(dataFile));
      await fn(blockchain, dataFile);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("rejects tampered genesis timestamp", () => {
  const genesis = createGenesisBlock();
  genesis.timestamp = GENESIS_TIMESTAMP + 1;
  genesis.hash = blockHash(genesis);
  assert.equal(verifyGenesisBlock(genesis), false);
  assert.equal(validChain([genesis]), false);
});

test("rejects non-genesis block with zero difficulty", () => {
  const genesis = createGenesisBlock();
  const badBlock = {
    index: 1,
    timestamp: GENESIS_TIMESTAMP + 60_000,
    transactions: [
      {
        from: MINING_REWARD_SENDER,
        to: "27982254690517c92abd56fd0f4871f60aee92f6",
        amount: calculateBlockReward(1).toString(),
        fee: "0",
        nonce: 0,
        signature: MINING_REWARD_SENDER,
        publicKey: MINING_REWARD_SENDER,
        chainId: CHAIN_ID_STRING,
      },
    ],
    previousHash: genesis.hash,
    hash: "00deadbeef",
    miner: GENESIS_ALLOCATION.address,
    difficulty: 0,
    powNonce: 0,
    chainId: CHAIN_ID_STRING,
  };

  assert.equal(meetsDifficulty(badBlock.hash, 0), true);
  assert.equal(verifyBlock(badBlock, genesis), false);
});

test(
  "rejects mempool balance oversubscription",
  withTempChain((blockchain) => {
    const sender = new NoshWallet();
    const recipient = new NoshWallet();
    blockchain.mineBlock(sender.address);

    const balance = blockchain.getBalance(sender.address);
    const half = (balance / 2n).toString();

    const tx1 = sender.sign(
      sender.address,
      recipient.address,
      half,
      MIN_FEE.toString(),
      0
    );
    const tx2 = sender.sign(
      sender.address,
      recipient.address,
      half,
      MIN_FEE.toString(),
      1
    );

    blockchain.addTransaction(tx1);
    assert.throws(
      () => blockchain.addTransaction(tx2),
      /Insufficient/
    );
  })
);

test(
  "rejects duplicate nonce already in mempool",
  withTempChain((blockchain) => {
    const sender = new NoshWallet();
    const recipient = new NoshWallet();
    blockchain.mineBlock(sender.address);

    const tx = sender.sign(
      sender.address,
      recipient.address,
      MIN_FEE.toString(),
      MIN_FEE.toString(),
      0
    );

    blockchain.addTransaction(tx);
    assert.throws(
      () => blockchain.addTransaction({ ...tx }),
      /already in mempool/i
    );
  })
);

test(
  "rejects out-of-order mempool nonce",
  withTempChain((blockchain) => {
    const sender = new NoshWallet();
    const recipient = new NoshWallet();
    blockchain.mineBlock(sender.address);

    const tx = sender.sign(
      sender.address,
      recipient.address,
      MIN_FEE.toString(),
      MIN_FEE.toString(),
      1
    );

    assert.throws(
      () => blockchain.addTransaction(tx),
      /nonce/i
    );
  })
);

test(
  "sanitizes invalid persisted mempool on restart",
  withTempChain(async (blockchain, dataFile) => {
    const sender = new NoshWallet();
    blockchain.mineBlock(sender.address);

    const validTx = sender.sign(
      sender.address,
      new NoshWallet().address,
      MIN_FEE.toString(),
      MIN_FEE.toString(),
      0
    );

    const invalidTx = {
      ...validTx,
      nonce: 99,
      signature: "invalid",
    };

    saveStateDb(dataFile, {
      chain: blockchain.getChain(),
      mempool: [validTx, invalidTx],
      peers: [],
    });

    const restarted = new Blockchain(testConfig(dataFile));
    assert.equal(restarted.mempool.list().length, 1);
    assert.equal(restarted.mempool.list()[0]?.nonce, 0);
  })
);

test("rejects wallet with mismatched address and public key", () => {
  const wallet = new NoshWallet();
  const dir = mkdtempSync(join(tmpdir(), "noshchain-wallet-"));
  const file = join(dir, "bad-wallet.json");

  try {
    writeFileSync(
      file,
      JSON.stringify({
        address: "0000000000000000000000000000000000000001",
        publicKey: wallet.publicKey,
        privateKey: "invalid",
      })
    );

    assert.throws(
      () => NoshWallet.loadFromFile(file),
      /address does not match public key/i
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "rejects inflated mining reward in block",
  withTempChain((blockchain) => {
    const genesis = blockchain.getChain();
    const miner = new NoshWallet();
    const block = blockchain.mineBlock(miner.address);
    const tampered = {
      ...block,
      transactions: block.transactions.map((tx) =>
        tx.from === MINING_REWARD_SENDER
          ? {
              ...tx,
              amount: (calculateBlockReward(block.index) * 2n).toString(),
            }
          : tx
      ),
    };
    tampered.hash = blockHash(tampered);

    assert.equal(validChain([...genesis, tampered], Date.now(), 1), false);
  })
);

test(
  "replaceChain rejects equal-work chain",
  withTempChain((blockchain) => {
    const chain = blockchain.getChain();
    assert.equal(blockchain.replaceChain(chain), false);
    assert.equal(compareChains(chain, chain), 0);
  })
);

test(
  "self-transfer only burns fee when mined by another miner",
  withTempChain((blockchain) => {
    const sender = new NoshWallet();
    const miner = new NoshWallet();
    blockchain.mineBlock(sender.address);
    const before = blockchain.getBalance(sender.address);

    const tx = sender.sign(
      sender.address,
      sender.address,
      MIN_FEE.toString(),
      MIN_FEE.toString(),
      0
    );
    blockchain.addTransaction(tx);
    blockchain.mineBlock(miner.address);

    const after = blockchain.getBalance(sender.address);
    assert.equal(after, before - MIN_FEE);
  })
);

test("rejects block missing mining reward", () => {
  const genesis = createGenesisBlock();
  const blockWithoutHash = {
    index: 1,
    timestamp: GENESIS_TIMESTAMP + 60_000,
    transactions: [],
    previousHash: genesis.hash,
    miner: GENESIS_ALLOCATION.address,
    difficulty: 1,
    powNonce: 0,
    chainId: CHAIN_ID_STRING,
  };

  assert.equal(verifyBlock({ ...blockWithoutHash, hash: "00" }, genesis), false);
});

test(
  "reject chain with wrong genesis allocation amount",
  () => {
    const genesis = createGenesisBlock();
    const tx = genesis.transactions[0]!;
    genesis.transactions = [
      {
        ...tx,
        amount: (INITIAL_SUPPLY + 1n).toString(),
      },
    ];
    genesis.hash = blockHash(genesis);
    assert.equal(validChain([genesis]), false);
  }
);
