import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeConfig } from "../config.js";
import { Blockchain } from "../blockchain.js";
import { NoshWallet, deriveAddress } from "../wallet.js";
import {
  HALVING_INTERVAL,
  MIN_FEE,
  WEI_PER_NOSH,
} from "../types.js";
import { formatNosh } from "../format.js";
import {
  calculateIssuedSupply,
  calculateTotalSupply,
  validateChainState,
} from "../state.js";

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
  };
}

test("HALVING_INTERVAL matches protocol", () => {
  assert.equal(HALVING_INTERVAL, 2_102_400);
});

test("MIN_FEE equals 0.001 NOSH in wei", () => {
  assert.equal(MIN_FEE, WEI_PER_NOSH / 1000n);
  assert.equal(formatNosh(MIN_FEE), "0.001");
});

test("deriveAddress matches wallet address", () => {
  const wallet = new NoshWallet();
  assert.equal(deriveAddress(wallet.publicKey), wallet.address);
});

test("formatNosh avoids floating-point rounding", () => {
  assert.equal(formatNosh(21_000_000n * WEI_PER_NOSH), "21000000");
  assert.equal(formatNosh(MIN_FEE), "0.001");
  assert.equal(
    formatNosh(50n * WEI_PER_NOSH + 123_456_789_012_345_678n),
    "50.123456789012345678"
  );
});

test(
  "supply conservation holds across transfers and mining",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "noshchain-monetary-"));
    const dataFile = join(dir, "chain.json");

    try {
      const blockchain = new Blockchain(testConfig(dataFile));
      const miner = new NoshWallet();
      const alice = new NoshWallet();
      const bob = new NoshWallet();

      blockchain.mineBlock(miner.address);

      const tx1 = miner.sign(
        miner.address,
        alice.address,
        WEI_PER_NOSH.toString(),
        MIN_FEE.toString(),
        0
      );
      const tx2 = miner.sign(
        miner.address,
        bob.address,
        (2n * WEI_PER_NOSH).toString(),
        MIN_FEE.toString(),
        1
      );

      blockchain.addTransaction(tx1);
      blockchain.addTransaction(tx2);
      blockchain.mineBlock(miner.address);

      const chain = blockchain.getChain();
      assert.equal(validateChainState(chain), true);
      assert.equal(calculateTotalSupply(chain), calculateIssuedSupply(chain));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  "rejects replay of confirmed transaction",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "noshchain-replay-"));
    const dataFile = join(dir, "chain.json");

    try {
      const blockchain = new Blockchain(testConfig(dataFile));
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
      blockchain.mineBlock(sender.address);

      assert.throws(
        () => blockchain.addTransaction({ ...tx }),
        /nonce/i
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
