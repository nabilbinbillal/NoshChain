import { createHash } from "node:crypto";
import type { Block, Transaction } from "./types.js";
import {
  BLOCK_REWARD,
  HALVING_INTERVAL,
  INITIAL_SUPPLY,
  WEI_PER_NOSH,
  DIFFICULTY_ADJUSTMENT_INTERVAL,
  TARGET_BLOCK_TIME_MS,
} from "./types.js";
import { INITIAL_DIFFICULTY } from "./types.js";

export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function transactionMessage(tx: {
  chainId: string;
  from: string;
  to: string;
  amount: string;
  fee: string;
  nonce: number;
  tokenId?: string;
  tokenAction?: "transfer" | "create";
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  tokenSupply?: string;
}): string {
  return JSON.stringify({
    chainId: tx.chainId,
    from: tx.from,
    to: tx.to,
    amount: tx.amount,
    fee: tx.fee,
    nonce: tx.nonce,
    tokenId: tx.tokenId ?? null,
    tokenAction: tx.tokenAction ?? null,
    tokenName: tx.tokenName ?? null,
    tokenSymbol: tx.tokenSymbol ?? null,
    tokenDecimals: tx.tokenDecimals ?? null,
    tokenSupply: tx.tokenSupply ?? null,
  });
}

export function blockHeaderPayload(
  block: Omit<Block, "hash">
): string {
  return JSON.stringify({
    index: block.index,
    timestamp: block.timestamp,
    transactions: block.transactions,
    previousHash: block.previousHash,
    miner: block.miner,
    difficulty: block.difficulty,
    powNonce: block.powNonce,
    chainId: block.chainId,
  });
}

export function blockHash(block: Omit<Block, "hash">): string {
  return sha256(blockHeaderPayload(block));
}

export function calculateBlockReward(blockHeight: number): bigint {
  const halvings = Math.floor(blockHeight / HALVING_INTERVAL);
  if (halvings >= 64) {
    return 0n;
  }
  return BLOCK_REWARD >> BigInt(halvings);
}

/**
 * Sum mining rewards across all halving eras using the same rule as
 * calculateBlockReward(): reward = BLOCK_REWARD >> era, with era 0 spanning
 * heights 1..HALVING_INTERVAL-1 and later eras spanning HALVING_INTERVAL blocks.
 *
 * Integer right-shift on wei (not on whole NOSH) is the protocol rule. From era
 * 2 onward each block reward has a non-zero remainder mod WEI_PER_NOSH (e.g.
 * 12.5 NOSH = 12.5e18 wei). Those fractional-NOSH remainders accumulate across
 * all blocks, so the total maximum supply in wei is not exactly
 * (floor(maxSupply / WEI_PER_NOSH) * WEI_PER_NOSH). The canonical value is
 * this sum; display in whole NOSH uses integer division.
 */
function sumMiningRewardsAcrossSchedule(): bigint {
  let total = 0n;

  for (let halving = 0; halving < 64; halving++) {
    const reward = BLOCK_REWARD >> BigInt(halving);
    if (reward === 0n) {
      break;
    }

    const blocksInEra =
      halving === 0 ? HALVING_INTERVAL - 1 : HALVING_INTERVAL;
    total += reward * BigInt(blocksInEra);
  }

  return total;
}

/** Exact total mining supply in wei from the halving schedule. */
export const CANONICAL_TOTAL_MINING_SUPPLY = sumMiningRewardsAcrossSchedule();

/** Exact maximum supply in wei (genesis + mining). */
export const CANONICAL_MAX_SUPPLY = INITIAL_SUPPLY + CANONICAL_TOTAL_MINING_SUPPLY;

/** Whole-NOSH display value: floor(CANONICAL_MAX_SUPPLY / WEI_PER_NOSH). */
export const CANONICAL_MAX_SUPPLY_NOSH = CANONICAL_MAX_SUPPLY / WEI_PER_NOSH;

/** Whole-NOSH display value for total mining rewards. */
export const CANONICAL_TOTAL_MINING_SUPPLY_NOSH =
  CANONICAL_TOTAL_MINING_SUPPLY / WEI_PER_NOSH;

/**
 * Sub-unit remainder from integer wei halving. CANONICAL_MAX_SUPPLY equals
 * CANONICAL_MAX_SUPPLY_NOSH * WEI_PER_NOSH + this value.
 */
export const CANONICAL_MAX_SUPPLY_SUB_UNIT_REMAINDER =
  CANONICAL_MAX_SUPPLY - CANONICAL_MAX_SUPPLY_NOSH * WEI_PER_NOSH;

export function meetsDifficulty(hash: string, difficulty: number): boolean {
  const prefix = "0".repeat(difficulty);
  return hash.startsWith(prefix);
}

export function mineBlockHeader(
  block: Omit<Block, "hash">,
  maxNonce = Number.MAX_SAFE_INTEGER
): { hash: string; powNonce: number } {
  let powNonce = 0;

  while (powNonce <= maxNonce) {
    const candidate = blockHash({ ...block, powNonce });
    if (meetsDifficulty(candidate, block.difficulty)) {
      return { hash: candidate, powNonce };
    }
    powNonce++;
  }

  throw new Error("Failed to find valid proof-of-work nonce");
}

export function getBlockWork(difficulty: number): bigint {
  // Each difficulty unit requires ~16x more work (one hex zero).
  return 1n << BigInt(difficulty * 4);
}

export function getChainWork(chain: Block[]): bigint {
  let work = 0n;
  for (const block of chain) {
    work += getBlockWork(block.difficulty);
  }
  return work;
}

export function calculateExpectedDifficulty(
  chain: Block[],
  blockIndex: number,
  initialDifficulty = INITIAL_DIFFICULTY,
  adjustmentInterval = DIFFICULTY_ADJUSTMENT_INTERVAL,
  targetBlockTimeMs = TARGET_BLOCK_TIME_MS
): number {
  if (blockIndex === 0) {
    return 0;
  }

  if (blockIndex === 1) {
    return Math.min(3, initialDifficulty);
  }

  if (blockIndex % adjustmentInterval !== 0) {
    const previous = chain[blockIndex - 1];
    const prevDiff = previous?.difficulty ?? initialDifficulty;
    return Math.min(3, Math.max(1, prevDiff));
  }

  const windowStart = blockIndex - adjustmentInterval;
  const startBlock = chain[windowStart];
  const endBlock = chain[blockIndex - 1];

  if (!startBlock || !endBlock) {
    return Math.min(3, initialDifficulty);
  }

  const elapsed = endBlock.timestamp - startBlock.timestamp;
  const expected = targetBlockTimeMs * adjustmentInterval;

  let difficulty = endBlock.difficulty;

  if (elapsed < expected / 2) {
    difficulty += 1;
  } else if (elapsed > expected * 2) {
    difficulty = Math.max(1, difficulty - 1);
  }

  return Math.min(3, Math.max(1, difficulty));
}

export function calculateTotalMiningSupply(): bigint {
  return CANONICAL_TOTAL_MINING_SUPPLY;
}

export function calculateIssuedMiningSupply(chainLength: number): bigint {
  let total = 0n;
  for (let height = 1; height < chainLength; height++) {
    total += calculateBlockReward(height);
  }
  return total;
}

export function calculateMaxSupply(): bigint {
  return CANONICAL_MAX_SUPPLY;
}
