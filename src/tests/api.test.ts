import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { NodeConfig } from "../config.js";
import { Blockchain } from "../blockchain.js";
import { P2PNetwork } from "../p2p.js";
import { createNodeServer } from "../server.js";
import { NoshWallet } from "../wallet.js";
import {
  MIN_FEE,
  WEI_PER_NOSH,
  CHAIN_ID_STRING,
  GENESIS_ALLOCATION,
} from "../types.js";
import { transactionHash } from "../api/transaction-id.js";
import { containsPrivateKeyMaterial } from "../api/responses.js";
import { calculateMaxSupply, CANONICAL_MAX_SUPPLY, CANONICAL_MAX_SUPPLY_NOSH } from "../crypto.js";

type ApiBody = {
  success: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
};

function testConfig(dataFile: string): NodeConfig {
  return {
    port: 0,
    peerUrls: [],
    dataFile,
    nodeEnv: "test",
    chainId: 13371337n,
    networkName: "noshchain-testnet",
    initialDifficulty: 1,
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

async function withApiServer(
  fn: (baseUrl: string, blockchain: Blockchain) => Promise<void>
) {
  const dir = mkdtempSync(join(tmpdir(), "noshchain-api-"));
  const dataFile = join(dir, "chain.db");
  const config = testConfig(dataFile);
  const blockchain = new Blockchain(config);
  const p2p = new P2PNetwork(blockchain);
  const { server } = createNodeServer(config, blockchain, p2p);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl, blockchain);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    rmSync(dir, { recursive: true, force: true });
  }
}

async function apiGet(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = (await response.json()) as ApiBody;
  return { response, body };
}

async function apiPost(baseUrl: string, path: string, payload: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as ApiBody;
  return { response, body };
}

test("GET /api/status returns node summary", async () => {
  await withApiServer(async (baseUrl) => {
    const { response, body } = await apiGet(baseUrl, "/api/status");
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data?.name, "NoshChain");
    assert.equal(body.data?.chainId, CHAIN_ID_STRING);
    assert.equal(containsPrivateKeyMaterial(body), false);
  });
});

test("GET /api/network exposes monetary information", async () => {
  await withApiServer(async (baseUrl) => {
    const { response, body } = await apiGet(baseUrl, "/api/network");
    assert.equal(response.status, 200);
    assert.equal(body.data?.symbol, "NOSH");
    assert.equal(body.data?.decimals, 18);
    assert.equal(body.data?.maxSupply, CANONICAL_MAX_SUPPLY.toString());
    assert.equal(body.data?.maxSupply, calculateMaxSupply().toString());
    assert.equal(
      BigInt(body.data?.maxSupply as string) / WEI_PER_NOSH,
      CANONICAL_MAX_SUPPLY_NOSH
    );
    assert.equal(body.data?.genesisSupply, "21000000000000000000000000");
    assert.equal(typeof body.data?.blockReward, "string");
    assert.equal(typeof body.data?.issuedSupply, "string");
    assert.equal(typeof body.data?.circulatingSupply, "string");
    assert.equal(typeof body.data?.halvingEra, "number");
    assert.equal(typeof body.data?.blocksUntilNextHalving, "number");
  });
});

test("GET /api/stats and /api/peers succeed", async () => {
  await withApiServer(async (baseUrl) => {
    const stats = await apiGet(baseUrl, "/api/stats");
    assert.equal(stats.response.status, 200);
    assert.equal(stats.body.data?.blocks, 1);

    const peers = await apiGet(baseUrl, "/api/peers");
    assert.equal(peers.response.status, 200);
    assert.deepEqual(peers.body.data?.peers, []);
  });
});

test("block endpoints return genesis and handle missing blocks", async () => {
  await withApiServer(async (baseUrl) => {
    const latest = await apiGet(baseUrl, "/api/blocks/latest");
    assert.equal(latest.response.status, 200);
    assert.equal(latest.body.data?.index, 0);

    const byHeight = await apiGet(baseUrl, "/api/blocks/0");
    assert.equal(byHeight.response.status, 200);
    assert.equal(byHeight.body.data?.hash, latest.body.data?.hash);

    const byHash = await apiGet(
      baseUrl,
      `/api/blocks/hash/${latest.body.data?.hash}`
    );
    assert.equal(byHash.response.status, 200);

    const missing = await apiGet(baseUrl, "/api/blocks/999");
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.error?.code, "BLOCK_NOT_FOUND");

    const badHash = await apiGet(baseUrl, "/api/blocks/hash/not-a-hash");
    assert.equal(badHash.response.status, 400);
    assert.equal(badHash.body.error?.code, "INVALID_HASH");
  });
});

test("GET /api/blocks supports pagination", async () => {
  await withApiServer(async (baseUrl, blockchain) => {
    const miner = new NoshWallet();
    blockchain.mineBlock(miner.address);

    const { response, body } = await apiGet(baseUrl, "/api/blocks?limit=1&offset=0");
    assert.equal(response.status, 200);
    assert.equal(body.data?.total, 2);
    assert.equal((body.data?.blocks as unknown[]).length, 1);
  });
});

test("GET /api/chain returns full chain", async () => {
  await withApiServer(async (baseUrl) => {
    const { response, body } = await apiGet(baseUrl, "/api/chain");
    assert.equal(response.status, 200);
    assert.equal(body.data?.blocks, 1);
    assert.ok(Array.isArray(body.data?.chain));
  });
});

test("invalid address requests return 400", async () => {
  await withApiServer(async (baseUrl) => {
    const bad = await apiGet(baseUrl, "/api/address/not-an-address");
    assert.equal(bad.response.status, 400);
    assert.equal(bad.body.error?.code, "INVALID_ADDRESS");
  });
});

test("address endpoints return balance and nonce", async () => {
  await withApiServer(async (baseUrl) => {
    const address = GENESIS_ALLOCATION.address;
    const info = await apiGet(baseUrl, `/api/address/${address}`);
    assert.equal(info.response.status, 200);
    assert.equal(info.body.data?.balance, GENESIS_ALLOCATION.amount);

    const balance = await apiGet(baseUrl, `/api/address/${address}/balance`);
    assert.equal(balance.response.status, 200);
    assert.equal(balance.body.data?.balance, GENESIS_ALLOCATION.amount);

    const txs = await apiGet(baseUrl, `/api/address/${address}/transactions`);
    assert.equal(txs.response.status, 200);
    assert.ok((txs.body.data?.total as number) >= 1);
  });
});

test("POST /api/transactions accepts valid signed transaction", async () => {
  await withApiServer(async (baseUrl, blockchain) => {
    const sender = new NoshWallet();
    const recipient = new NoshWallet();
    blockchain.mineBlock(sender.address);

    const tx = sender.sign(
      sender.address,
      recipient.address,
      WEI_PER_NOSH.toString(),
      MIN_FEE.toString(),
      0
    );

    const { response, body } = await apiPost(baseUrl, "/api/transactions", tx);
    assert.equal(response.status, 201);
    assert.equal(body.data?.status, "pending");
    assert.equal(body.data?.hash, transactionHash(tx));
    assert.equal(containsPrivateKeyMaterial(body), false);

    const mempool = await apiGet(baseUrl, "/api/mempool");
    assert.equal(mempool.body.data?.total, 1);

    const stats = await apiGet(baseUrl, "/api/mempool/stats");
    assert.equal(stats.body.data?.count, 1);
    assert.equal(stats.body.data?.minFee, MIN_FEE.toString());
  });
});

test("transaction lookup works for pending and confirmed states", async () => {
  await withApiServer(async (baseUrl, blockchain) => {
    const sender = new NoshWallet();
    const recipient = new NoshWallet();
    blockchain.mineBlock(sender.address);

    const tx = sender.sign(
      sender.address,
      recipient.address,
      MIN_FEE.toString(),
      MIN_FEE.toString(),
      0
    );
    const hash = transactionHash(tx);

    await apiPost(baseUrl, "/api/transactions", tx);

    const pending = await apiGet(baseUrl, `/api/transactions/${hash}`);
    assert.equal(pending.response.status, 200);
    assert.equal(pending.body.data?.status, "pending");

    blockchain.mineBlock(sender.address);

    const confirmed = await apiGet(baseUrl, `/api/transactions/${hash}`);
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.data?.status, "confirmed");
    assert.equal(typeof confirmed.body.data?.blockHeight, "number");
  });
});

test("rejects invalid signatures, nonce, balance, and fee", async () => {
  await withApiServer(async (baseUrl, blockchain) => {
    const sender = new NoshWallet();
    const recipient = new NoshWallet();
    blockchain.mineBlock(sender.address);

    const valid = sender.sign(
      sender.address,
      recipient.address,
      MIN_FEE.toString(),
      MIN_FEE.toString(),
      0
    );

    const badSignature = { ...valid, signature: "invalid" };
    const sigResult = await apiPost(baseUrl, "/api/transactions", badSignature);
    assert.equal(sigResult.response.status, 400);

    const badNonce = sender.sign(
      sender.address,
      recipient.address,
      MIN_FEE.toString(),
      MIN_FEE.toString(),
      1
    );
    const nonceResult = await apiPost(baseUrl, "/api/transactions", badNonce);
    assert.equal(nonceResult.response.status, 400);

    const poor = new NoshWallet();
    const insufficient = poor.sign(
      poor.address,
      recipient.address,
      WEI_PER_NOSH.toString(),
      MIN_FEE.toString(),
      0
    );
    const balanceResult = await apiPost(
      baseUrl,
      "/api/transactions",
      insufficient
    );
    assert.equal(balanceResult.response.status, 400);

    const lowFee = sender.sign(
      sender.address,
      recipient.address,
      MIN_FEE.toString(),
      "1",
      0
    );
    const feeResult = await apiPost(baseUrl, "/api/transactions", lowFee);
    assert.equal(feeResult.response.status, 400);
  });
});

test("rejects malformed transaction payloads", async () => {
  await withApiServer(async (baseUrl) => {
    const malformed = await apiPost(baseUrl, "/api/transactions", {
      from: "bad",
    });
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.body.error?.code, "INVALID_TRANSACTION");

    const invalidJson = await fetch(`${baseUrl}/api/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
  });
});

test("returns 404 for nonexistent transaction", async () => {
  await withApiServer(async (baseUrl) => {
    const hash = "a".repeat(64);
    const { response, body } = await apiGet(baseUrl, `/api/transactions/${hash}`);
    assert.equal(response.status, 404);
    assert.equal(body.error?.code, "TRANSACTION_NOT_FOUND");
  });
});

test("API responses never expose private keys", async () => {
  await withApiServer(async (baseUrl, blockchain) => {
    const wallet = new NoshWallet();
    blockchain.mineBlock(wallet.address);

    const endpoints = [
      "/api/status",
      "/api/network",
      "/api/stats",
      "/api/peers",
      "/api/blocks",
      "/api/blocks/latest",
      "/api/chain",
      "/api/mempool",
      "/api/mempool/stats",
      `/api/address/${wallet.address}`,
      `/api/address/${wallet.address}/balance`,
      `/api/address/${wallet.address}/transactions`,
    ];

    for (const path of endpoints) {
      const { body } = await apiGet(baseUrl, path);
      assert.equal(
        containsPrivateKeyMaterial(body),
        false,
        `private key leaked in ${path}`
      );
    }

    const recipient = new NoshWallet();
    const tx = wallet.sign(
      wallet.address,
      recipient.address,
      MIN_FEE.toString(),
      MIN_FEE.toString(),
      0
    );
    const posted = await apiPost(baseUrl, "/api/transactions", tx);
    assert.equal(containsPrivateKeyMaterial(posted.body), false);
  });
});

test("POST /api/wallet/create generates valid secp256k1 keypair", async () => {
  await withApiServer(async (baseUrl) => {
    const { response, body } = await apiPost(baseUrl, "/api/wallet/create", {
      name: "testwallet",
    });
    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    const wallet = body.data?.wallet as { address: string; publicKey: string; privateKey: string };
    assert.ok(wallet.address && wallet.address.length === 40);
    assert.ok(wallet.publicKey.includes("BEGIN PUBLIC KEY"));
    assert.ok(wallet.privateKey.includes("BEGIN PRIVATE KEY"));
  });
});
