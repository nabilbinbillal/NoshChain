import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Blockchain } from "./blockchain.js";
import type { P2PNetwork } from "./p2p.js";
import type { NodeConfig } from "./config.js";
import type { Block, Transaction } from "./types.js";
import {
  WEI_PER_NOSH,
  MIN_FEE,
  CHAIN_ID_STRING,
  INITIAL_SUPPLY,
} from "./types.js";
import {
  calculateBlockReward,
  calculateMaxSupply,
  calculateTotalMiningSupply,
  getChainWork,
} from "./crypto.js";
import { validateAddress } from "./validation.js";
import { handleApiRequest } from "./api/router.js";
import { getMonetaryInfo } from "./api/monetary.js";
import { calculateIssuedSupply, calculateTotalSupply } from "./state.js";

function jsonResponse(
  res: ServerResponse,
  status: number,
  data: unknown
): void {
  const body = JSON.stringify(data, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );

  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

async function readBody(
  req: IncomingMessage,
  maxSize: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

export function createNodeServer(
  config: NodeConfig,
  blockchain: Blockchain,
  p2p: P2PNetwork
) {
  const isProduction = config.nodeEnv === "production";

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);

      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        });
        res.end();
        return;
      }

      const apiHandled = await handleApiRequest(req, res, {
        config,
        blockchain,
        p2p,
        isProduction,
      });
      if (apiHandled) {
        return;
      }

      if (req.method === "GET" && url.pathname === "/") {
        const latest = blockchain.getLatestBlock();
        return jsonResponse(res, 200, {
          name: "NoshChain",
          network: config.networkName,
          chainId: CHAIN_ID_STRING,
          coin: "NOSH",
          decimals: 18,
          node: `http://localhost:${config.port}`,
          peers: p2p.getPeerUrls(),
          blocks: blockchain.getChain().length,
          genesisHash: blockchain.getGenesisHash(),
          latestHash: latest.hash,
          chainWork: getChainWork(blockchain.getChain()).toString(),
          reward: `${(calculateBlockReward(blockchain.getChain().length) / WEI_PER_NOSH).toString()} NOSH`,
          minFee: `${(MIN_FEE / WEI_PER_NOSH).toString()} NOSH`,
          consensus: "proof-of-work",
          difficulty: latest.difficulty,
          mempool: blockchain.mempool.list().length,
          endpoints: [
            "GET /api/status",
            "GET /api/network",
            "GET /api/stats",
            "GET /api/peers",
            "GET /api/blocks",
            "GET /api/blocks/latest",
            "GET /api/blocks/:height",
            "GET /api/blocks/hash/:hash",
            "GET /api/chain",
            "POST /api/transactions",
            "GET /api/transactions/:hash",
            "GET /api/mempool",
            "GET /api/mempool/stats",
            "GET /api/address/:address",
            "GET /api/address/:address/balance",
            "GET /api/address/:address/transactions",
            "GET /",
            "GET /chain",
            "GET /blockchain",
            "GET /blocks/:height",
            "GET /balances",
            "GET /balance/:address",
            "GET /nonce/:address",
            "GET /network",
            "GET /peers",
            "POST /transaction",
            "POST /mine",
            "POST /peers",
            "POST /blocks",
            "GET /sync",
          ],
        });
      }

      if (
        req.method === "GET" &&
        (url.pathname === "/chain" || url.pathname === "/blockchain")
      ) {
        const chain = blockchain.getChain();
        return jsonResponse(res, 200, {
          blocks: chain.length,
          chainWork: getChainWork(chain).toString(),
          genesisHash: blockchain.getGenesisHash(),
          chain,
        });
      }

      if (req.method === "GET" && url.pathname.startsWith("/blocks/")) {
        const height = Number(url.pathname.split("/")[2]);
        if (!Number.isInteger(height) || height < 0) {
          return jsonResponse(res, 400, { error: "Invalid block height" });
        }

        const block = blockchain.getBlock(height);
        if (!block) {
          return jsonResponse(res, 404, { error: "Block not found" });
        }

        return jsonResponse(res, 200, block);
      }

      if (req.method === "GET" && url.pathname === "/balances") {
        return jsonResponse(res, 200, blockchain.getBalances());
      }

      if (req.method === "GET" && url.pathname.startsWith("/balance/")) {
        const address = url.pathname.split("/")[2];
        if (!address || !validateAddress(address)) {
          return jsonResponse(res, 400, { error: "Invalid address" });
        }

        return jsonResponse(res, 200, {
          address,
          balance: blockchain.getBalance(address).toString(),
          decimals: 18,
        });
      }

      if (req.method === "GET" && url.pathname.startsWith("/nonce/")) {
        const address = url.pathname.split("/")[2];
        if (!address || !validateAddress(address)) {
          return jsonResponse(res, 400, { error: "Invalid address" });
        }

        return jsonResponse(res, 200, {
          address,
          nonce: blockchain.getNonce(address),
        });
      }

      if (req.method === "GET" && url.pathname === "/network") {
        const chain = blockchain.getChain();
        const monetary = getMonetaryInfo(chain, config);

        return jsonResponse(res, 200, {
          network: config.networkName,
          chainId: CHAIN_ID_STRING,
          genesisHash: blockchain.getGenesisHash(),
          genesisAllocation: INITIAL_SUPPLY.toString(),
          genesisSupply: INITIAL_SUPPLY.toString(),
          issuedSupply: calculateIssuedSupply(chain).toString(),
          circulatingSupply: calculateTotalSupply(chain).toString(),
          blockReward: calculateBlockReward(chain.length).toString(),
          totalMiningSupply: calculateTotalMiningSupply().toString(),
          maxSupply: calculateMaxSupply().toString(),
          minFee: MIN_FEE.toString(),
          decimals: 18,
          halvingInterval: monetary.halvingInterval,
          halvingEra: monetary.halvingEra,
          blocksUntilNextHalving: monetary.blocksUntilNextHalving,
          targetBlockTimeSeconds: config.targetBlockTimeMs / 1000,
          initialDifficulty: config.initialDifficulty,
        });
      }

      if (req.method === "GET" && url.pathname === "/peers") {
        return jsonResponse(res, 200, {
          peers: p2p.getPeerUrls(),
        });
      }

      if (req.method === "POST" && url.pathname === "/transaction") {
        const body = (await readBody(req, config.maxBodySize)) as Transaction;
        blockchain.addTransaction(body);
        void p2p.broadcastTransaction(body);

        return jsonResponse(res, 201, {
          message: "Transaction accepted",
          mempool: blockchain.mempool.list().length,
        });
      }

      if (req.method === "POST" && url.pathname === "/mine") {
        const body = (await readBody(req, config.maxBodySize)) as {
          miner?: unknown;
        };

        if (typeof body.miner !== "string" || !validateAddress(body.miner)) {
          return jsonResponse(res, 400, {
            error: "Valid miner address required",
          });
        }

        const block = blockchain.mineBlock(body.miner);
        void p2p.broadcastBlock(block);

        return jsonResponse(res, 200, {
          message: "Block mined",
          reward: calculateBlockReward(block.index).toString(),
          block,
        });
      }

      if (req.method === "POST" && url.pathname === "/blocks") {
        const body = (await readBody(req, config.maxBodySize)) as Block;
        const accepted = blockchain.tryAddBlock(body);

        return jsonResponse(res, accepted ? 201 : 409, {
          message: accepted ? "Block accepted" : "Block rejected",
          blocks: blockchain.getChain().length,
        });
      }

      if (req.method === "POST" && url.pathname === "/peers") {
        const body = (await readBody(req, config.maxBodySize)) as {
          peer?: unknown;
        };

        if (typeof body.peer !== "string") {
          return jsonResponse(res, 400, { error: "peer URL required" });
        }

        p2p.addPeer(body.peer);

        return jsonResponse(res, 201, {
          message: "Peer added",
          peers: p2p.getPeerUrls(),
        });
      }

      if (req.method === "GET" && url.pathname === "/sync") {
        const result = await p2p.syncWithPeers();
        return jsonResponse(res, 200, {
          message: "Chain synchronized",
          ...result,
        });
      }

      return jsonResponse(res, 404, { error: "Not found" });
    } catch (error) {
      const status = isProduction ? 500 : 400;
      const errorMessage = isProduction
        ? "Internal server error"
        : error instanceof Error
          ? error.message
          : "Unknown error";

      return jsonResponse(res, status, { error: errorMessage });
    }
  });
}
