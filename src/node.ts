import { loadConfig } from "./config.js";
import { Blockchain } from "./blockchain.js";
import { P2PNetwork } from "./p2p.js";
import { createNodeServer } from "./server.js";
import { calculateBlockReward } from "./crypto.js";
import { formatNosh } from "./format.js";
import { createLogger } from "./logger.js";
import type { Block, Transaction } from "./types.js";

const logger = createLogger("Node");

const config = loadConfig();
const blockchain = new Blockchain(config);
const p2p = new P2PNetwork(blockchain);
const { server, ws } = createNodeServer(config, blockchain, p2p);

// Connect blockchain events to WebSocket
if (config.enableWs) {
  blockchain.onEvent((event) => {
    switch (event.type) {
      case "block":
        ws.broadcastBlock(event.data as Block);
        break;
      case "transaction":
        ws.broadcastTransaction(event.data as Transaction);
        break;
      case "chain":
        const chainData = event.data as { height: number; hash: string };
        ws.broadcastChain(chainData.height, chainData.hash);
        break;
    }
  });
}

// Global error handlers
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { error: error.message, stack: error.stack });
  gracefulShutdown(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection", { reason, promise });
});

// Graceful shutdown
process.on("SIGTERM", () => gracefulShutdown(0));
process.on("SIGINT", () => gracefulShutdown(0));

let isShuttingDown = false;

async function gracefulShutdown(exitCode: number) {
  if (isShuttingDown) {
    logger.warn("Shutdown already in progress");
    return;
  }

  isShuttingDown = true;
  logger.info("Shutting down gracefully...");

  try {
    // Stop accepting new connections
    server.close(() => {
      logger.info("HTTP server closed");
    });

    // Close WebSocket server
    if (config.enableWs) {
      ws.close();
    }

    // Close database connection
    blockchain.close();

    logger.info("Shutdown complete");
    process.exit(exitCode);
  } catch (error) {
    logger.error("Error during shutdown", { error });
    process.exit(1);
  }

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

server.listen(config.port, () => {
  const latest = blockchain.getLatestBlock();
  console.log(`
╔══════════════════════════════════════╗
║          🪙 NOSHCHAIN NODE           ║
╚══════════════════════════════════════╝

Network: NoshChain (${config.networkName})
Chain ID: ${config.chainId}
Coin:    NOSH (18 decimals)
Node:    http://localhost:${config.port}
Peers:   ${p2p.getPeerUrls().join(", ") || "(none)"}
Blocks:  ${blockchain.getChain().length}
Reward:  ${formatNosh(calculateBlockReward(blockchain.getChain().length))} NOSH
Difficulty: ${latest.difficulty}
Consensus: proof-of-work

Endpoints:
GET  /
GET  /chain
GET  /blockchain
GET  /blocks/:height
GET  /balances
GET  /balance/:address
GET  /nonce/:address
GET  /network
GET  /peers
POST /transaction
POST /mine
POST /peers
POST /blocks
GET  /sync

Blockchain:
${config.dataFile}
`);
});
