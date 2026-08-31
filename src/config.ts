import { config as loadDotenv } from "dotenv";
import {
  CHAIN_ID,
  NETWORK_NAME,
  TARGET_BLOCK_TIME_MS,
  DIFFICULTY_ADJUSTMENT_INTERVAL,
  configuredInitialDifficulty,
} from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("Config");

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
  logLevel: string;
  logDir: string;
  enableWs: boolean;
  enableRateLimit: boolean;
  corsOrigins: string[];
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

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value || value.trim() === "") {
    return ["*"];
  }
  return value
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

function validateConfig(config: NodeConfig): void {
  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid port: ${config.port}. Must be between 1 and 65535.`);
  }

  if (config.initialDifficulty < 0) {
    throw new Error(`Invalid difficulty: ${config.initialDifficulty}. Must be non-negative.`);
  }

  if (config.targetBlockTimeMs < 1000) {
    throw new Error(`Invalid target block time: ${config.targetBlockTimeMs}. Must be at least 1000ms.`);
  }

  if (config.difficultyAdjustmentInterval < 1) {
    throw new Error(`Invalid difficulty adjustment interval: ${config.difficultyAdjustmentInterval}. Must be at least 1.`);
  }

  if (config.maxBodySize < 1024) {
    throw new Error(`Invalid max body size: ${config.maxBodySize}. Must be at least 1024 bytes.`);
  }

  const validLogLevels = ["error", "warn", "info", "debug"];
  if (!validLogLevels.includes(config.logLevel)) {
    throw new Error(`Invalid log level: ${config.logLevel}. Must be one of: ${validLogLevels.join(", ")}`);
  }

  const validEnvs = ["development", "production", "test"];
  if (!validEnvs.includes(config.nodeEnv)) {
    throw new Error(`Invalid node environment: ${config.nodeEnv}. Must be one of: ${validEnvs.join(", ")}`);
  }

  // Validate peer URLs
  for (const peer of config.peerUrls) {
    try {
      new URL(peer);
    } catch {
      throw new Error(`Invalid peer URL: ${peer}`);
    }
  }
}

export function loadConfig(): NodeConfig {
  loadDotenv();
  const config = {
    port: Number(process.env.PORT ?? 3001),
    peerUrls: parsePeerUrls(process.env.PEER),
    dataFile: process.env.DATA_FILE ?? "data/blockchain.db",
    nodeEnv: process.env.NODE_ENV ?? "development",
    chainId: CHAIN_ID,
    networkName: NETWORK_NAME,
    initialDifficulty: configuredInitialDifficulty(),
    targetBlockTimeMs: TARGET_BLOCK_TIME_MS,
    difficultyAdjustmentInterval: DIFFICULTY_ADJUSTMENT_INTERVAL,
    maxBodySize: Number(process.env.MAX_BODY_SIZE ?? 1024 * 1024),
    logLevel: process.env.LOG_LEVEL ?? "info",
    logDir: process.env.LOG_DIR ?? "logs",
    enableWs: process.env.ENABLE_WS !== "false",
    enableRateLimit: process.env.ENABLE_RATE_LIMIT !== "false",
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
  };

  try {
    validateConfig(config);
    logger.info("Configuration loaded and validated", {
      port: config.port,
      nodeEnv: config.nodeEnv,
      dataFile: config.dataFile,
      peerCount: config.peerUrls.length,
      enableWs: config.enableWs,
      enableRateLimit: config.enableRateLimit,
    });
  } catch (error) {
    logger.error("Configuration validation failed", { error });
    throw error;
  }

  return config;
}
