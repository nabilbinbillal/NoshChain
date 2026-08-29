import test from "node:test";
import assert from "node:assert/strict";
import {
  GENESIS_ALLOCATION,
  GENESIS_SENDER,
  MINING_REWARD_SENDER,
  WEI_PER_NOSH,
  INITIAL_SUPPLY,
  BLOCK_REWARD,
  MIN_FEE,
  CHAIN_ID,
  CHAIN_ID_STRING,
  HALVING_INTERVAL,
} from "../types.js";
import {
  calculateBlockReward,
  calculateTotalMiningSupply,
  calculateMaxSupply,
  CANONICAL_MAX_SUPPLY,
  CANONICAL_TOTAL_MINING_SUPPLY,
  CANONICAL_MAX_SUPPLY_NOSH,
  CANONICAL_TOTAL_MINING_SUPPLY_NOSH,
  CANONICAL_MAX_SUPPLY_SUB_UNIT_REMAINDER,
  meetsDifficulty,
  blockHash,
  getChainWork,
  sha256,
} from "../crypto.js";
import {
  validateAddress,
  validateAmount,
  validateFee,
  validateNonce,
  verifyTransaction,
  verifyBlock,
  validChain,
  compareChains,
} from "../validation.js";
import { createGenesisBlock } from "../blockchain.js";
import { NoshWallet } from "../wallet.js";

test("constants", () => {
  assert.equal(WEI_PER_NOSH, 10n ** 18n);
  assert.equal(INITIAL_SUPPLY, 21_000_000n * WEI_PER_NOSH);
  assert.equal(BLOCK_REWARD, 50n * WEI_PER_NOSH);
  assert.equal(MIN_FEE, 1_000_000_000_000_000n);
  assert.equal(CHAIN_ID, 13371337n);
  assert.equal(GENESIS_ALLOCATION.amount, INITIAL_SUPPLY.toString());
});

test("validateAddress", () => {
  assert.equal(
    validateAddress("27982254690517c92abd56fd0f4871f60aee92f6"),
    true
  );
  assert.equal(validateAddress("invalid"), false);
  assert.equal(validateAddress("g".repeat(40)), false);
});

test("validateAmount and fee", () => {
  assert.equal(validateAmount("1000000000000000000"), true);
  assert.equal(validateAmount("0"), false);
  assert.equal(validateAmount("-1"), false);
  assert.equal(validateFee(MIN_FEE.toString()), true);
  assert.equal(validateFee("1"), false);
});

test("validateNonce", () => {
  assert.equal(validateNonce(0), true);
  assert.equal(validateNonce(-1), false);
  assert.equal(validateNonce(1.5), false);
});

test("calculateBlockReward halving", () => {
  assert.equal(calculateBlockReward(1), BLOCK_REWARD);
  assert.equal(calculateBlockReward(HALVING_INTERVAL - 1), BLOCK_REWARD);
  assert.equal(calculateBlockReward(HALVING_INTERVAL), BLOCK_REWARD >> 1n);
  assert.equal(
    calculateBlockReward(HALVING_INTERVAL * 2),
    BLOCK_REWARD >> 2n
  );
});

test("calculateTotalMiningSupply", () => {
  const miningSupply = calculateTotalMiningSupply();
  assert.ok(miningSupply > 0n);
  assert.equal(calculateMaxSupply(), INITIAL_SUPPLY + miningSupply);
  assert.equal(miningSupply, CANONICAL_TOTAL_MINING_SUPPLY);
  assert.equal(calculateMaxSupply(), CANONICAL_MAX_SUPPLY);
  assert.equal(miningSupply / WEI_PER_NOSH, CANONICAL_TOTAL_MINING_SUPPLY_NOSH);
  assert.equal(calculateMaxSupply() / WEI_PER_NOSH, CANONICAL_MAX_SUPPLY_NOSH);
  assert.equal(CANONICAL_MAX_SUPPLY_NOSH, 231_239_949n);
  assert.equal(CANONICAL_TOTAL_MINING_SUPPLY_NOSH, 210_239_949n);

  // Integer wei halving: canonical max is not exactly NOSH * 10^18.
  assert.notEqual(CANONICAL_MAX_SUPPLY, CANONICAL_MAX_SUPPLY_NOSH * WEI_PER_NOSH);
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

test("meetsDifficulty", () => {
  assert.equal(meetsDifficulty("00abcdef", 2), true);
  assert.equal(meetsDifficulty("0abcdef0", 2), false);
});

test("genesis block is valid", () => {
  const genesis = createGenesisBlock();
  assert.equal(genesis.index, 0);
  assert.equal(genesis.chainId, CHAIN_ID_STRING);
  assert.equal(validChain([genesis]), true);
});

test("wallet signing and verification", () => {
  const wallet = new NoshWallet();
  const recipient = new NoshWallet();

  const tx = wallet.sign(
    wallet.address,
    recipient.address,
    WEI_PER_NOSH.toString(),
    MIN_FEE.toString(),
    0
  );

  assert.equal(verifyTransaction(tx), true);
  assert.equal(tx.chainId, CHAIN_ID_STRING);
});

test("invalid signature rejected", () => {
  const wallet = new NoshWallet();
  const recipient = new NoshWallet();
  const tx = wallet.sign(
    wallet.address,
    recipient.address,
    WEI_PER_NOSH.toString(),
    MIN_FEE.toString(),
    0
  );

  tx.signature = "invalid";
  assert.equal(verifyTransaction(tx), false);
});

test("wrong chainId rejected", () => {
  const wallet = new NoshWallet();
  const recipient = new NoshWallet();
  const tx = wallet.sign(
    wallet.address,
    recipient.address,
    WEI_PER_NOSH.toString(),
    MIN_FEE.toString(),
    0
  );

  tx.chainId = "999";
  assert.equal(verifyTransaction(tx), false);
});

test("compareChains prefers more work", () => {
  const genesis = createGenesisBlock();
  const short = [genesis];
  const long = [genesis, { ...genesis, index: 1 } as typeof genesis];
  assert.ok(compareChains(long, short) > 0);
});

test("getChainWork increases with difficulty", () => {
  const genesis = createGenesisBlock();
  assert.equal(getChainWork([genesis]), 1n);
});

test("blockHash is deterministic", () => {
  const genesis = createGenesisBlock();
  const hash1 = blockHash(genesis);
  const hash2 = blockHash(genesis);
  assert.equal(hash1, hash2);
  assert.equal(hash1, genesis.hash);
});

test("sha256", () => {
  assert.equal(
    sha256("test").length,
    64
  );
});

test("validChain rejects empty chain", () => {
  assert.equal(validChain([]), false);
});

test("verifyBlock rejects invalid genesis", () => {
  const genesis = createGenesisBlock();
  genesis.previousHash = "bad";
  assert.equal(verifyBlock(genesis), false);
});

test("system transaction markers", () => {
  const genesis = createGenesisBlock();
  const tx = genesis.transactions[0]!;
  assert.equal(tx.from, GENESIS_SENDER);
  assert.equal(tx.to, GENESIS_ALLOCATION.address);
});

test("mining reward sender constant", () => {
  assert.equal(MINING_REWARD_SENDER, "MINING_REWARD");
});
