import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, unlinkSync, existsSync, rmSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { GENESIS_ALLOCATION } from "../types.js";
import { NoshWallet } from "../wallet.js";
import { MIN_FEE, WEI_PER_NOSH } from "../types.js";
import { calculateBlockReward, CANONICAL_MAX_SUPPLY_NOSH } from "../crypto.js";

const BLOCK_REWARD = calculateBlockReward(1);

let node1: ChildProcess | undefined;
let node2: ChildProcess | undefined;

const DATA_FILES = [
  "data/e2e-node1.json",
  "data/e2e-node2.json",
  "data/wallets/alice.json",
  "data/wallets/bob.json",
];

async function cleanup() {
  if (node1) node1.kill();
  if (node2) node2.kill();
  node1 = undefined;
  node2 = undefined;

  for (const file of DATA_FILES) {
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }

  await delay(500);
}

async function startNode(
  port: number,
  peer: string,
  dataFile: string
): Promise<ChildProcess> {
  const env = {
    ...process.env,
    PORT: port.toString(),
    PEER: peer,
    DATA_FILE: dataFile,
    DIFFICULTY: "1",
  };

  const node = spawn("node", ["--import", "tsx/esm", "src/node.ts"], {
    env,
    stdio: "pipe",
  });

  await delay(1500);
  return node;
}

async function fetchJSON(url: string) {
  const response = await fetch(url);
  return response.json();
}

async function createWallet(name: string) {
  const wallet = new NoshWallet();
  wallet.save(name);
  return JSON.parse(
    readFileSync(`data/wallets/${name}.json`, "utf8")
  ) as { address: string; publicKey: string; privateKey: string };
}

async function sendTransaction(
  fromWallet: string,
  toAddress: string,
  amount: string,
  fee: string,
  nodeUrl: string
) {
  const wallet = NoshWallet.loadFromFile(
    `data/wallets/${fromWallet}.json`
  );

  const nonceData = (await fetchJSON(
    `${nodeUrl}/nonce/${wallet.address}`
  )) as { nonce: number };

  const signed = wallet.sign(
    wallet.address,
    toAddress,
    amount,
    fee,
    nonceData.nonce
  );

  const response = await fetch(`${nodeUrl}/transaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signed),
  });

  return { response, data: await response.json() };
}

test("end-to-end two-node network", async () => {
  await cleanup();

  try {
    node1 = await startNode(
      3001,
      "http://localhost:3002",
      "data/e2e-node1.json"
    );
    node2 = await startNode(
      3002,
      "http://localhost:3001",
      "data/e2e-node2.json"
    );

    const node1Info = (await fetchJSON("http://localhost:3001/")) as {
      chainId: string;
      decimals: number;
      coin: string;
      consensus: string;
    };

    assert.equal(node1Info.chainId, "13371337");
    assert.equal(node1Info.decimals, 18);
    assert.equal(node1Info.coin, "NOSH");
    assert.equal(node1Info.consensus, "proof-of-work");

    const aliceWallet = await createWallet("alice");
    const bobWallet = await createWallet("bob");

    const genesisBalance = BigInt(
      ((await fetchJSON(
        `http://localhost:3001/balance/${GENESIS_ALLOCATION.address}`
      )) as { balance: string }).balance
    );
    assert.equal(genesisBalance, 21_000_000n * WEI_PER_NOSH);

    const mine1 = await fetch("http://localhost:3001/mine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ miner: aliceWallet.address }),
    });
    const mine1Data = await mine1.json();
    assert.equal(mine1Data.message, "Block mined");
    assert.equal(BigInt(mine1Data.reward), BLOCK_REWARD);

    const aliceBalance = BigInt(
      ((await fetchJSON(
        `http://localhost:3001/balance/${aliceWallet.address}`
      )) as { balance: string }).balance
    );
    assert.equal(aliceBalance, BLOCK_REWARD);

    const transferAmount = WEI_PER_NOSH.toString();
    const fee = MIN_FEE.toString();

    const { response: txResponse, data: txData } = await sendTransaction(
      "alice",
      bobWallet.address,
      transferAmount,
      fee,
      "http://localhost:3001"
    );
    assert.equal(txResponse.status, 201);
    assert.equal(txData.message, "Transaction accepted");

    // Transaction is in mempool until mined
    const bobBeforeMine = BigInt(
      ((await fetchJSON(
        `http://localhost:3001/balance/${bobWallet.address}`
      )) as { balance: string }).balance
    );
    assert.equal(bobBeforeMine, 0n);

    const mine2 = await fetch("http://localhost:3001/mine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ miner: bobWallet.address }),
    });
    assert.equal((await mine2.json()).message, "Block mined");

    const aliceAfter = BigInt(
      ((await fetchJSON(
        `http://localhost:3001/balance/${aliceWallet.address}`
      )) as { balance: string }).balance
    );
    const bobAfter = BigInt(
      ((await fetchJSON(
        `http://localhost:3001/balance/${bobWallet.address}`
      )) as { balance: string }).balance
    );

    assert.equal(
      aliceAfter,
      BLOCK_REWARD - WEI_PER_NOSH - MIN_FEE
    );
    assert.equal(bobAfter, WEI_PER_NOSH + calculateBlockReward(2) + MIN_FEE);

    const syncResult = (await fetchJSON(
      "http://localhost:3002/sync"
    )) as { message: string; blocks: number };

    assert.equal(syncResult.message, "Chain synchronized");
    assert.equal(syncResult.blocks, 3);

    const chain1 = ((await fetchJSON("http://localhost:3001/chain")) as {
      chain: { hash: string }[];
    }).chain;
    const chain2 = ((await fetchJSON("http://localhost:3002/chain")) as {
      chain: { hash: string }[];
    }).chain;

    assert.equal(chain1.length, chain2.length);
    assert.equal(
      chain1[chain1.length - 1]!.hash,
      chain2[chain2.length - 1]!.hash
    );

    const invalidSend = await sendTransaction(
      "alice",
      bobWallet.address,
      (100_000_000n * WEI_PER_NOSH).toString(),
      fee,
      "http://localhost:3001"
    );
    assert.equal(invalidSend.response.status, 400);

    const lowFeeWallet = NoshWallet.loadFromFile(
      "data/wallets/alice.json"
    );
    const lowFeeTx = lowFeeWallet.sign(
      lowFeeWallet.address,
      bobWallet.address,
      transferAmount,
      "1",
      1
    );
    const lowFeeResponse = await fetch(
      "http://localhost:3001/transaction",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lowFeeTx),
      }
    );
    assert.equal(lowFeeResponse.status, 400);

    const networkInfo = (await fetchJSON(
      "http://localhost:3001/network"
    )) as { maxSupply: string; genesisAllocation: string };
    assert.ok(BigInt(networkInfo.maxSupply) > BigInt(networkInfo.genesisAllocation));
    assert.equal(BigInt(networkInfo.maxSupply) / WEI_PER_NOSH, CANONICAL_MAX_SUPPLY_NOSH);

    // Persistence: restart node1
    node1.kill();
    await delay(500);
    node1 = await startNode(
      3001,
      "http://localhost:3002",
      "data/e2e-node1.json"
    );

    const restartedChain = ((await fetchJSON(
      "http://localhost:3001/chain"
    )) as { blocks: number }).blocks;
    assert.equal(restartedChain, 3);
  } finally {
    await cleanup();
  }
});
