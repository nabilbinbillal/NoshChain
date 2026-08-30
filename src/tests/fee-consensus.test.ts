import { calculateBlockReward } from "../crypto.js";
import test from "node:test";
import assert from "node:assert/strict";

import {
  MIN_FEE,
  WEI_PER_NOSH,
  CHAIN_ID_STRING,
  MAX_BLOCK_DRIFT_MS,
} from "../types.js";

import {
  validateFee,
  validateNonce,
} from "../validation.js";

test("MIN_FEE is the canonical protocol minimum fee", () => {
  assert.equal(MIN_FEE, 1_000_000_000_000_000n);
  assert.equal(MIN_FEE, WEI_PER_NOSH / 1000n);
});

test("fee exactly at MIN_FEE is valid", () => {
  assert.equal(validateFee(MIN_FEE.toString()), true);
});

test("fee below MIN_FEE is invalid", () => {
  assert.equal(
    validateFee((MIN_FEE - 1n).toString()),
    false
  );
});

test("zero fee is invalid for normal transactions", () => {
  assert.equal(validateFee("0"), false);
});

test("negative fee is invalid", () => {
  assert.equal(validateFee("-1"), false);
});

test("malformed fee is invalid", () => {
  assert.equal(validateFee("abc"), false);
  assert.equal(validateFee("1.5"), false);
  assert.equal(validateFee(""), false);
});

test("very large bigint fee remains valid", () => {
  assert.equal(
    validateFee("1000000000000000000000000000000000"),
    true
  );
});

test("safe integer nonce is valid", () => {
  assert.equal(validateNonce(0), true);
  assert.equal(validateNonce(Number.MAX_SAFE_INTEGER), true);
});

test("unsafe integer nonce is rejected", () => {
  assert.equal(
    validateNonce(Number.MAX_SAFE_INTEGER + 1),
    false
  );
});

test("negative nonce is rejected", () => {
  assert.equal(validateNonce(-1), false);
});

test("canonical chain ID remains fixed", () => {
  assert.equal(CHAIN_ID_STRING, "13371337");
});


test("block timestamp cannot drift too far from previous block", async () => {
  const { createGenesisBlock } = await import("../blockchain.js");
  const { verifyBlock } = await import("../validation.js");
  const { blockHash, mineBlockHeader } = await import("../crypto.js");
  const {
    MINING_REWARD_SENDER,
    CHAIN_ID_STRING,
  } = await import("../types.js");

  const genesis = createGenesisBlock();

  const previousWithoutHash = {
    index: 1,
    timestamp: Date.now(),
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
    miner: "27982254690517c92abd56fd0f4871f60aee92f6",
    difficulty: 1,
    powNonce: 0,
    chainId: CHAIN_ID_STRING,
  };

  const previousMined = mineBlockHeader(previousWithoutHash);
  const previous = {
    ...previousWithoutHash,
    hash: previousMined.hash,
    powNonce: previousMined.powNonce,
  };

  const blockWithoutHash = {
    index: 2,
    timestamp: previous.timestamp + MAX_BLOCK_DRIFT_MS + 1,
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
    previousHash: previous.hash,
    miner: "27982254690517c92abd56fd0f4871f60aee92f6",
    difficulty: 1,
    powNonce: 0,
    chainId: CHAIN_ID_STRING,
  };

  const { hash, powNonce } = mineBlockHeader(blockWithoutHash);
  const block = { ...blockWithoutHash, hash, powNonce };

  assert.equal(verifyBlock(block, previous), false);
});
