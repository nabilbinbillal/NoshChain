import type { IncomingMessage, ServerResponse } from "node:http";
import type { Blockchain } from "../blockchain.js";
import type { P2PNetwork } from "../p2p.js";
import type { NodeConfig } from "../config.js";
import type { Block, Transaction } from "../types.js";
import {
  CHAIN_ID_STRING,
  MIN_FEE,
  NETWORK_NAME,
} from "../types.js";
import { calculateBlockReward, getChainWork } from "../crypto.js";
import {
  countAddressTransactions,
  findBlockByHash,
  findTransaction,
  getAddressTransactions,
} from "./indexer.js";
import { getMonetaryInfo, getNetworkStats } from "./monetary.js";
import { sendError, sendSuccess } from "./responses.js";
import { transactionHash } from "./transaction-id.js";
import { createHash } from "node:crypto";
import { getAllTokens, getToken, getTokenBalance, validateTokenMetadata, tokenIdFromCreation } from "../tokens.js";
import { NoshWallet } from "../wallet.js";

export type ApiContext = {
  config: NodeConfig;
  blockchain: Blockchain;
  p2p: P2PNetwork;
  isProduction: boolean;
};

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

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function summarizeBlock(block: Block) {
  return {
    height: block.index,
    hash: block.hash,
    previousHash: block.previousHash,
    timestamp: block.timestamp,
    miner: block.miner,
    difficulty: block.difficulty,
    transactionCount: block.transactions.length,
    chainId: block.chainId,
  };
}

function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== "object") {
    return false;
  }

  const tx = value as Partial<Transaction>;
  return (
    typeof tx.from === "string" &&
    typeof tx.to === "string" &&
    typeof tx.amount === "string" &&
    typeof tx.fee === "string" &&
    typeof tx.nonce === "number" &&
    typeof tx.signature === "string" &&
    typeof tx.publicKey === "string" &&
    typeof tx.chainId === "string"
  );
}

function handleApiError(
  res: ServerResponse,
  ctx: ApiContext,
  error: unknown
): void {
  const message =
    error instanceof Error ? error.message : "Unknown error";
  const status = ctx.isProduction ? 500 : 400;
  const code = status === 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";

  sendError(
    res,
    status,
    code,
    ctx.isProduction ? "Internal server error" : message
  );
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://localhost:${ctx.config.port}`);
  if (!url.pathname.startsWith("/api/")) {
    return false;
  }

  try {
    const chain = ctx.blockchain.getChain();
    const latest = ctx.blockchain.getLatestBlock();
    const mempool = ctx.blockchain.mempool.list();

    if (req.method === "GET" && url.pathname === "/api/status") {
      sendSuccess(res, 200, {
        name: "NoshChain",
        network: ctx.config.networkName,
        chainId: CHAIN_ID_STRING,
        node: `http://localhost:${ctx.config.port}`,
        blocks: chain.length,
        genesisHash: ctx.blockchain.getGenesisHash(),
        latestBlock: summarizeBlock(latest),
        chainWork: getChainWork(chain).toString(),
        mempoolSize: mempool.length,
        peers: ctx.p2p.getPeerUrls().length,
        consensus: "proof-of-work",
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      const uptime = process.uptime();
      const mem = process.memoryUsage();
      sendSuccess(res, 200, {
        status: "healthy",
        uptime: Math.floor(uptime),
        memory: { heapUsed: Math.round(mem.heapUsed/1024/1024), heapTotal: Math.round(mem.heapTotal/1024/1024), rss: Math.round(mem.rss/1024/1024) },
        blockchain: { blocks: chain.length, mempoolSize: mempool.length, peers: ctx.p2p.getPeerUrls().length, latestBlock: { height: latest.index, hash: latest.hash, timestamp: latest.timestamp } },
        timestamp: Date.now()
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/metrics") {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage();
      sendSuccess(res, 200, {
        timestamp: Date.now(),
        uptime: process.uptime(),
        memory: { heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external, rss: mem.rss },
        cpu: { user: cpu.user, system: cpu.system },
        blockchain: { blocks: chain.length, chainWork: getChainWork(chain).toString(), mempoolSize: mempool.length, peerCount: ctx.p2p.getPeerUrls().length, latestBlockHeight: latest.index, latestBlockTimestamp: latest.timestamp, difficulty: latest.difficulty },
        network: { chainId: CHAIN_ID_STRING, genesisHash: ctx.blockchain.getGenesisHash() }
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/network") {
      sendSuccess(res, 200, {
        network: NETWORK_NAME,
        chainId: CHAIN_ID_STRING,
        genesisHash: ctx.blockchain.getGenesisHash(),
        ...getMonetaryInfo(chain, ctx.config),
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      const stats = getNetworkStats(chain);
      sendSuccess(res, 200, {
        ...stats,
        mempoolSize: mempool.length,
        peerCount: ctx.p2p.getPeerUrls().length,
        nextBlockReward: calculateBlockReward(chain.length).toString(),
        monetary: getMonetaryInfo(chain, ctx.config),
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/peers") {
      sendSuccess(res, 200, {
        peers: ctx.p2p.getPeerUrls(),
        count: ctx.p2p.getPeerUrls().length,
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/blocks") {
      const limit = parsePositiveInt(url.searchParams.get("limit"), 20, 100);
      const offset = parsePositiveInt(
        url.searchParams.get("offset"),
        0,
        chain.length
      );
      const reversed = [...chain].reverse();

      sendSuccess(res, 200, {
        total: chain.length,
        limit,
        offset,
        blocks: reversed.slice(offset, offset + limit).map(summarizeBlock),
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/blocks/latest") {
      sendSuccess(res, 200, latest);
      return true;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/blocks/hash/")) {
      const hash = url.pathname.slice("/api/blocks/hash/".length);
      if (!/^[0-9a-f]{64}$/.test(hash)) {
        sendError(res, 400, "INVALID_HASH", "Invalid block hash format");
        return true;
      }

      const block = findBlockByHash(chain, hash);
      if (!block) {
        sendError(res, 404, "BLOCK_NOT_FOUND", "Block not found");
        return true;
      }

      sendSuccess(res, 200, block);
      return true;
    }

    const blockHeightMatch = url.pathname.match(/^\/api\/blocks\/(\d+)$/);
    if (req.method === "GET" && blockHeightMatch) {
      const height = Number(blockHeightMatch[1]);
      const block = ctx.blockchain.getBlock(height);
      if (!block) {
        sendError(res, 404, "BLOCK_NOT_FOUND", "Block not found");
        return true;
      }

      sendSuccess(res, 200, block);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/chain") {
      sendSuccess(res, 200, {
        blocks: chain.length,
        chainWork: getChainWork(chain).toString(),
        genesisHash: ctx.blockchain.getGenesisHash(),
        latestHash: latest.hash,
        chain,
      });
      return true;
    }


    /*
     * ============================================================
     * TOKEN API
     * ============================================================
     */

    if (req.method === "GET" && url.pathname === "/api/tokens") {
      sendSuccess(res, 200, {
        tokens: getAllTokens(chain),
        count: getAllTokens(chain).length,
      });
      return true;
    }

    const tokenMatch = url.pathname.match(
      /^\/api\/tokens\/([0-9a-f]{64})$/
    );

    if (req.method === "GET" && tokenMatch) {
      const tokenId = tokenMatch[1]!;
      const token = getToken(chain, tokenId);

      if (!token) {
        sendError(res, 404, "TOKEN_NOT_FOUND", "Token not found");
        return true;
      }

      sendSuccess(res, 200, token);
      return true;
    }

    const tokenBalanceMatch = url.pathname.match(
      /^\/api\/tokens\/([0-9a-f]{64})\/balance\/([0-9a-f]{40})$/
    );

    if (req.method === "GET" && tokenBalanceMatch) {
      const tokenId = tokenBalanceMatch[1]!;
      const address = tokenBalanceMatch[2]!;

      const token = getToken(chain, tokenId);

      if (!token) {
        sendError(res, 404, "TOKEN_NOT_FOUND", "Token not found");
        return true;
      }

      sendSuccess(res, 200, {
        tokenId,
        address,
        balance: getTokenBalance(chain, tokenId, address).toString(),
        decimals: token.decimals,
        symbol: token.symbol,
      });

      return true;
    }

    const createTokenMatch =
      req.method === "POST" &&
      url.pathname === "/api/tokens/create";

    if (createTokenMatch) {
      const body = await readBody(req, ctx.config.maxBodySize) as {
        name?: string;
        symbol?: string;
        decimals?: number;
        totalSupply?: string;
        creator?: string;
        fee?: string;
        nonce?: number;
        signature?: string;
        publicKey?: string;
      };

      if (
        typeof body.name !== "string" ||
        typeof body.symbol !== "string" ||
        typeof body.decimals !== "number" ||
        typeof body.totalSupply !== "string" ||
        typeof body.creator !== "string"
      ) {
        sendError(
          res,
          400,
          "INVALID_TOKEN",
          "name, symbol, decimals, totalSupply and creator are required"
        );
        return true;
      }

      const metadataError = validateTokenMetadata({
        name: body.name,
        symbol: body.symbol,
        decimals: body.decimals,
        totalSupply: body.totalSupply,
        creator: body.creator,
      });

      if (metadataError) {
        sendError(res, 400, "INVALID_TOKEN", metadataError);
        return true;
      }

      const nonce =
        typeof body.nonce === "number"
          ? body.nonce
          : ctx.blockchain.getNonce(body.creator);

      const tokenId = tokenIdFromCreation(
        body.creator,
        body.name,
        body.symbol,
        body.totalSupply,
        body.decimals,
        nonce
      );

      const token = {
        id: tokenId,
        name: body.name,
        symbol: body.symbol,
        decimals: body.decimals,
        totalSupply: body.totalSupply,
        creator: body.creator,
        createdAt: Date.now(),
      };

      sendSuccess(res, 201, {
        message:
          "Token specification created. Token creation transactions are accepted through the signed transaction API.",
        token,
        nextStep:
          "Use POST /api/transactions with tokenAction=create and the returned tokenId.",
      });

      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/transactions") {
      const body = await readBody(req, ctx.config.maxBodySize);
      if (!isTransaction(body)) {
        sendError(
          res,
          400,
          "INVALID_TRANSACTION",
          "Malformed transaction payload"
        );
        return true;
      }

      ctx.blockchain.addTransaction(body);
      void ctx.p2p.broadcastTransaction(body);

      sendSuccess(res, 201, {
        hash: transactionHash(body),
        status: "pending",
        transaction: body,
        mempoolSize: ctx.blockchain.mempool.list().length,
      });
      return true;
    }

    const txHashMatch = url.pathname.match(
      /^\/api\/transactions\/([0-9a-fA-F]{64})$/
    );
    if (req.method === "GET" && txHashMatch) {
      const hash = txHashMatch[1]!.toLowerCase();
      const indexed = findTransaction(chain, mempool, hash);
      if (!indexed) {
        sendError(res, 404, "TRANSACTION_NOT_FOUND", "Transaction not found");
        return true;
      }

      sendSuccess(res, 200, indexed);
      return true;
    }

    const invalidTxMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)$/);
    if (req.method === "GET" && invalidTxMatch) {
      const param = invalidTxMatch[1]!;
      if (/^[0-9a-fA-F]{40}$/.test(param)) {
        sendError(
          res,
          400,
          "IS_ACCOUNT_ADDRESS",
          `'${param}' is a 40-character account address, not a 64-character transaction hash. Use the Check Balance / Account tool instead.`
        );
      } else {
        sendError(
          res,
          400,
          "INVALID_TRANSACTION_HASH",
          "Transaction hash must be a 64-character hexadecimal string"
        );
      }
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/mempool") {
      const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 100);
      const offset = parsePositiveInt(
        url.searchParams.get("offset"),
        0,
        mempool.length
      );

      sendSuccess(res, 200, {
        total: mempool.length,
        limit,
        offset,
        transactions: mempool.slice(offset, offset + limit).map((tx) => ({
          hash: transactionHash(tx),
          status: "pending" as const,
          transaction: tx,
        })),
      });
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/mempool/stats") {
      const totalFees = mempool.reduce((sum, tx) => sum + BigInt(tx.fee), 0n);
      const totalAmount = mempool.reduce(
        (sum, tx) => sum + BigInt(tx.amount),
        0n
      );

      sendSuccess(res, 200, {
        count: mempool.length,
        totalFees: totalFees.toString(),
        totalAmount: totalAmount.toString(),
        minFee: MIN_FEE.toString(),
      });
      return true;
    }

    const addressMatch = url.pathname.match(/^\/api\/address\/([0-9a-f]{40})$/);
    if (req.method === "GET" && addressMatch) {
      const address = addressMatch[1]!;
      sendSuccess(res, 200, {
        address,
        balance: ctx.blockchain.getBalance(address).toString(),
        nonce: ctx.blockchain.getNonce(address),
        transactionCount: countAddressTransactions(chain, mempool, address),
        decimals: 18,
      });
      return true;
    }

    const addressBalanceMatch = url.pathname.match(
      /^\/api\/address\/([0-9a-f]{40})\/balance$/
    );
    if (req.method === "GET" && addressBalanceMatch) {
      const address = addressBalanceMatch[1]!;
      sendSuccess(res, 200, {
        address,
        balance: ctx.blockchain.getBalance(address).toString(),
        decimals: 18,
      });
      return true;
    }

    const addressTxMatch = url.pathname.match(
      /^\/api\/address\/([0-9a-f]{40})\/transactions$/
    );
    if (req.method === "GET" && addressTxMatch) {
      const address = addressTxMatch[1]!;
      const limit = parsePositiveInt(url.searchParams.get("limit"), 50, 100);
      const offset = parsePositiveInt(
        url.searchParams.get("offset"),
        0,
        Number.MAX_SAFE_INTEGER
      );
      const all = getAddressTransactions(chain, mempool, address);

      sendSuccess(res, 200, {
        address,
        total: all.length,
        limit,
        offset,
        transactions: all.slice(offset, offset + limit),
      });
      return true;
    }

    const invalidAddressMatch = url.pathname.match(/^\/api\/address\/([^/]+)/);
    if (req.method === "GET" && invalidAddressMatch) {
      sendError(res, 400, "INVALID_ADDRESS", "Invalid address format");
      return true;
    }

    /*
     * ============================================================
     * WALLET API
     * ============================================================
     */

    if (
      req.method === "POST" &&
      (url.pathname === "/api/wallet/create" || url.pathname === "/api/wallet/generate")
    ) {
      const body = (await readBody(req, ctx.config.maxBodySize)) as { name?: string };
      const wallet = new NoshWallet();
      let savedFile: string | null = null;

      if (body.name && typeof body.name === "string" && /^[a-zA-Z0-9_-]{1,32}$/.test(body.name)) {
        savedFile = wallet.save(body.name);
      }

      sendSuccess(res, 201, {
        message: savedFile
          ? `Wallet created and saved as ${savedFile}`
          : "Secp256k1 keypair generated successfully",
        wallet: {
          name: body.name || "ephemeral",
          address: wallet.address,
          publicKey: wallet.publicKey,
          privateKey: wallet.getPrivateKeyPem(),
          savedFile,
        },
      });
      return true;
    }

    sendError(res, 404, "NOT_FOUND", "API endpoint not found");
    return true;
  } catch (error) {
    handleApiError(res, ctx, error);
    return true;
  }
}
