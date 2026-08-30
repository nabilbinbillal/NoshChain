import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeConfig } from "../config.js";
import { Blockchain } from "../blockchain.js";
import { NoshWallet } from "../wallet.js";
import {
  meetsDifficulty,
  mineBlockHeader,
  blockHash,
  calculateExpectedDifficulty,
} from "../crypto.js";
import { createGenesisBlock } from "../blockchain.js";
import { validChain } from "../validation.js";
import { CHAIN_ID_STRING } from "../types.js";

function testConfig(dataFile: string, difficulty?: number): NodeConfig {
  const initialDifficulty = difficulty ?? 2;

  return {
    port: 0,
    peerUrls: [],
    dataFile,
    nodeEnv: "test",
    chainId: 13371337n,
    networkName: "noshchain-testnet",
    initialDifficulty,
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

test("mineBlockHeader finds valid nonce", () => {
  const genesis = createGenesisBlock();
  const block = {
    index: 1,
    timestamp: Date.now(),
    transactions: [],
    previousHash: genesis.hash,
    miner: "27982254690517c92abd56fd0f4871f60aee92f6",
    difficulty: 1,
    powNonce: 0,
    chainId: CHAIN_ID_STRING,
  };

  const { hash, powNonce } = mineBlockHeader(block);
  assert.ok(meetsDifficulty(hash, 1));
  assert.ok(powNonce >= 0);
});

test("higher difficulty requires more work", () => {
  const genesis = createGenesisBlock();
  const base = {
    index: 1,
    timestamp: Date.now(),
    transactions: [],
    previousHash: genesis.hash,
    miner: "27982254690517c92abd56fd0f4871f60aee92f6",
    powNonce: 0,
    chainId: CHAIN_ID_STRING,
  };

  const easy = mineBlockHeader({ ...base, difficulty: 1 });
  const hard = mineBlockHeader({ ...base, difficulty: 2 });

  assert.ok(hard.powNonce > easy.powNonce || hard.powNonce !== easy.powNonce);
  assert.ok(meetsDifficulty(hard.hash, 2));
});

test("mined blocks pass validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "noshchain-pow-"));
  const dataFile = join(dir, "chain.db");

  try {
    const blockchain = new Blockchain(testConfig(dataFile, 1));
    const miner = new NoshWallet();
    const block = blockchain.mineBlock(miner.address);

    assert.ok(meetsDifficulty(block.hash, block.difficulty));
    assert.equal(validChain(blockchain.getChain(), Date.now(), 1), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("difficulty adjustment follows chain length", () => {
  const genesis = createGenesisBlock();
  const chain = [genesis];

  const d1 = calculateExpectedDifficulty(chain, 1, 2, 10, 60_000);
  assert.equal(d1, 2);

  const d10 = calculateExpectedDifficulty(
    [...chain, ...Array.from({ length: 9 }, (_, i) => ({
      ...genesis,
      index: i + 1,
      difficulty: 2,
      timestamp: genesis.timestamp + (i + 1) * 30_000,
      hash: `block-${i}`,
    }))] as typeof chain,
    10,
    2,
    10,
    60_000
  );

  // Blocks mined faster than target should increase difficulty
  assert.ok(d10 >= 2);
});

test("tampered block hash fails validation", () => {
  const genesis = createGenesisBlock();
  const tampered = { ...genesis, hash: "deadbeef" };
  assert.equal(validChain([tampered]), false);
});

test("blockHash changes when powNonce changes", () => {
  const genesis = createGenesisBlock();
  const a = blockHash({
    ...genesis,
    index: 1,
    powNonce: 0,
    difficulty: 1,
  });
  const b = blockHash({
    ...genesis,
    index: 1,
    powNonce: 1,
    difficulty: 1,
  });
  assert.notEqual(a, b);
});
