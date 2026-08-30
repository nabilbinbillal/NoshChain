import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeConfig } from "../config.js";
import { Blockchain } from "../blockchain.js";
import {
  INITIAL_SUPPLY,
  WEI_PER_NOSH,
  HALVING_INTERVAL,
  INITIAL_DIFFICULTY,
  BLOCK_REWARD,
} from "../types.js";
import {
  calculateBlockReward,
  calculateMaxSupply,
  calculateTotalMiningSupply,
  calculateIssuedMiningSupply,
  CANONICAL_MAX_SUPPLY,
  CANONICAL_TOTAL_MINING_SUPPLY,
  CANONICAL_MAX_SUPPLY_NOSH,
  CANONICAL_TOTAL_MINING_SUPPLY_NOSH,
  CANONICAL_MAX_SUPPLY_SUB_UNIT_REMAINDER,
} from "../crypto.js";
import {
  calculateIssuedSupply,
  calculateTotalSupply,
  validateChainState,
} from "../state.js";
import { validChain } from "../validation.js";
import { createGenesisBlock } from "../blockchain.js";

const EXPECTED_MAX_SUPPLY_NOSH = CANONICAL_MAX_SUPPLY_NOSH;
const EXPECTED_MINING_SUPPLY_NOSH = CANONICAL_TOTAL_MINING_SUPPLY_NOSH;

function testConfig(dataFile: string, initialDifficulty = INITIAL_DIFFICULTY): NodeConfig {
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

test("max supply matches block reward schedule", () => {
  const miningSupply = calculateTotalMiningSupply();
  const maxSupply = calculateMaxSupply();

  assert.equal(miningSupply, CANONICAL_TOTAL_MINING_SUPPLY);
  assert.equal(maxSupply, CANONICAL_MAX_SUPPLY);
  assert.equal(miningSupply / WEI_PER_NOSH, EXPECTED_MINING_SUPPLY_NOSH);
  assert.equal(maxSupply / WEI_PER_NOSH, EXPECTED_MAX_SUPPLY_NOSH);
  assert.equal(maxSupply, INITIAL_SUPPLY + miningSupply);

  // Integer wei halving: canonical max is not exactly NOSH * 10^18.
  assert.notEqual(
    CANONICAL_MAX_SUPPLY,
    EXPECTED_MAX_SUPPLY_NOSH * WEI_PER_NOSH
  );
  assert.equal(CANONICAL_MAX_SUPPLY_SUB_UNIT_REMAINDER, 999_999_999_939_030_400n);

  let eraSum = 0n;
  for (let halving = 0; halving < 64; halving++) {
    const reward = BLOCK_REWARD >> BigInt(halving);
    if (reward === 0n) {
      break;
    }
    const blocksInEra =
      halving === 0 ? HALVING_INTERVAL - 1 : HALVING_INTERVAL;
    eraSum += reward * BigInt(blocksInEra);
  }
  assert.equal(eraSum, miningSupply);
});

test("halving boundary uses floor(height / interval)", () => {
  assert.equal(calculateBlockReward(HALVING_INTERVAL - 1), calculateBlockReward(1));
  assert.equal(
    calculateBlockReward(HALVING_INTERVAL),
    calculateBlockReward(1) >> 1n
  );
});

test("issued supply invariant holds while mining", () => {
  const dir = mkdtempSync(join(tmpdir(), "noshchain-consensus-"));
  const dataFile = join(dir, "chain.db");

  try {
    const blockchain = new Blockchain(testConfig(dataFile, 1));

    for (let i = 0; i < 5; i++) {
      blockchain.mineBlock("27982254690517c92abd56fd0f4871f60aee92f6");
      const chain = blockchain.getChain();
      assert.equal(validateChainState(chain), true);
      assert.equal(
        calculateTotalSupply(chain),
        calculateIssuedSupply(chain)
      );
      assert.equal(
        calculateIssuedMiningSupply(chain.length),
        calculateIssuedSupply(chain) - INITIAL_SUPPLY
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("independent nodes with same params validate identical chains", () => {
  const dirA = mkdtempSync(join(tmpdir(), "noshchain-a-"));
  const dirB = mkdtempSync(join(tmpdir(), "noshchain-b-"));
  const fileA = join(dirA, "chain.db");
  const fileB = join(dirB, "chain.db");

  try {
    const nodeA = new Blockchain(testConfig(fileA, 1));
    const nodeB = new Blockchain(testConfig(fileB, 1));

    for (let i = 0; i < 3; i++) {
      nodeA.mineBlock("27982254690517c92abd56fd0f4871f60aee92f6");
    }

    const chain = nodeA.getChain();
    assert.equal(validChain(chain, Date.now(), 1), true);
    assert.equal(nodeB.replaceChain(chain), true);
    assert.equal(nodeB.getChain().length, chain.length);
    assert.deepEqual(nodeB.getBalances(), nodeA.getBalances());
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test("mismatched initial difficulty rejects otherwise valid chain", () => {
  const genesis = createGenesisBlock();
  const dir = mkdtempSync(join(tmpdir(), "noshchain-diff-"));
  const dataFile = join(dir, "chain.db");

  try {
    const fastNode = new Blockchain(testConfig(dataFile, 1));
    const block = fastNode.mineBlock("27982254690517c92abd56fd0f4871f60aee92f6");
    const chain = [genesis, block];

    assert.equal(validChain(chain, Date.now(), 1), true);
    assert.equal(validChain(chain, Date.now(), INITIAL_DIFFICULTY), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
