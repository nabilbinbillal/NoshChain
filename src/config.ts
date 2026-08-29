import {
  CHAIN_ID,
  NETWORK_NAME,
  TARGET_BLOCK_TIME_MS,
  DIFFICULTY_ADJUSTMENT_INTERVAL,
  configuredInitialDifficulty,
} from "./types.js";

export type NodeConfig = {
  port: number;
  peerUrls: string[];
  dataFile: string;
  nodeEnv: string;
  chainId: bigint;
  networkName: string;
  initialDifficulty: number;
  targetBlockTimeMs: number;
  difficultyAdjustmentInterval: number;
  maxBodySize: number;
};

function parsePeerUrls(value: string | undefined): string[] {
  if (!value || value.trim() === "") {
    return [];
  }
  return value
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

export function loadConfig(): NodeConfig {
  return {
    port: Number(process.env.PORT ?? 3001),
    peerUrls: parsePeerUrls(process.env.PEER),
    dataFile: process.env.DATA_FILE ?? "data/blockchain.json",
    nodeEnv: process.env.NODE_ENV ?? "development",
    chainId: CHAIN_ID,
    networkName: NETWORK_NAME,
    initialDifficulty: configuredInitialDifficulty(),
    targetBlockTimeMs: TARGET_BLOCK_TIME_MS,
    difficultyAdjustmentInterval: DIFFICULTY_ADJUSTMENT_INTERVAL,
    maxBodySize: 1024 * 1024,
  };
}
