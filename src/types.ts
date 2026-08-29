export type Transaction = {
  from: string;
  to: string;
  amount: string;
  fee: string;
  nonce: number;
  signature: string;
  publicKey: string;
  chainId: string;
};

export type Block = {
  index: number;
  timestamp: number;
  transactions: Transaction[];
  previousHash: string;
  hash: string;
  miner: string;
  difficulty: number;
  powNonce: number;
  chainId: string;
};

export type Chain = Block[];

export type PersistedState = {
  chain: Chain;
  mempool: Transaction[];
  peers: string[];
};

// Network identification
export const CHAIN_ID = 13371337n;
export const NETWORK_NAME = "noshchain-testnet" as const;
export const CHAIN_ID_STRING = CHAIN_ID.toString();

// System senders
export const GENESIS_SENDER = "GENESIS" as const;
export const MINING_REWARD_SENDER = "MINING_REWARD" as const;

// Monetary constants (18 decimals)
export const WEI_PER_NOSH = 10n ** 18n;
export const INITIAL_SUPPLY = 21_000_000n * WEI_PER_NOSH;
export const BLOCK_REWARD = 50n * WEI_PER_NOSH;
export const HALVING_INTERVAL = 2_102_400;
export const MIN_FEE = 1_000_000_000_000_000n; // 0.001 NOSH

// Consensus constants
export const INITIAL_DIFFICULTY = 2;
export const TARGET_BLOCK_TIME_MS = 60_000;
export const DIFFICULTY_ADJUSTMENT_INTERVAL = 10;
export const MAX_FUTURE_BLOCK_TIME_MS = 2 * 60_000;
export const MAX_BLOCK_DRIFT_MS = 2 * 60 * 60_000;

export function configuredInitialDifficulty(): number {
  const value = Number(process.env.DIFFICULTY ?? INITIAL_DIFFICULTY);
  return Number.isFinite(value) && value >= 1 ? value : INITIAL_DIFFICULTY;
}

// Deterministic genesis
export const GENESIS_TIMESTAMP = 1_704_067_200_000;
export const GENESIS_PREVIOUS_HASH = "0";

export const GENESIS_ALLOCATION = {
  address: "27982254690517c92abd56fd0f4871f60aee92f6",
  amount: INITIAL_SUPPLY.toString(),
} as const;
