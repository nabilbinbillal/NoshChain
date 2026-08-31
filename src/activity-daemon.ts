import { NoshWallet } from "./wallet.js";
import { MIN_FEE, WEI_PER_NOSH } from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("ActivityDaemon");

const NODE_URL = process.env.NODE_URL || "http://localhost:3001";

async function fetchJson(path: string, options: RequestInit = {}) {
  try {
    const res = await fetch(`${NODE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    return await res.json();
  } catch (err) {
    logger.error(`API request failed: ${path}`, { error: err });
    return null;
  }
}

async function startDaemon() {
  logger.info("Starting NoshChain Activity Daemon", { nodeUrl: NODE_URL });

  // Initialize 3 active test wallets
  const alice = new NoshWallet();
  const bob = new NoshWallet();
  const charlie = new NoshWallet();

  const wallets = [alice, bob, charlie];
  logger.info("Active daemon wallets initialized", {
    alice: alice.address,
    bob: bob.address,
    charlie: charlie.address,
  });

  let txCounter = 0;

  // 1. Transaction Generation Cycle (runs every 10 seconds)
  const generateTxCycle = async () => {
    try {
      txCounter++;
      const senderIdx = txCounter % wallets.length;
      const recipientIdx = (txCounter + 1) % wallets.length;
      const sender = wallets[senderIdx]!;
      const recipient = wallets[recipientIdx]!;

      // Check sender balance and nonce
      const accRes = await fetchJson(`/api/address/${sender.address}`);
      const balance = BigInt(accRes?.data?.balance || "0");
      const nonce = accRes?.data?.nonce || 0;

      // If sender has low balance, fund sender by mining a block
      if (balance < WEI_PER_NOSH) {
        logger.info("Funding wallet...", { miner: sender.address });
        await fetchJson("/mine", {
          method: "POST",
          body: JSON.stringify({ miner: sender.address }),
        });
        return;
      }

      // Varying transaction amounts from 0.05 to 0.5 NOSH
      const amount = (WEI_PER_NOSH / 20n) * BigInt((txCounter % 10) + 1);
      const tx = sender.sign(
        sender.address,
        recipient.address,
        amount.toString(),
        MIN_FEE.toString(),
        nonce
      );

      const res = await fetchJson("/api/transactions", {
        method: "POST",
        body: JSON.stringify(tx),
      });

      if (res && res.success) {
        logger.info("Realtime transaction queued in mempool", {
          hash: res.data?.hash?.slice(0, 16),
          from: sender.address.slice(0, 8),
          to: recipient.address.slice(0, 8),
          amount: `${(amount / (10n ** 15n)).toString()} mNOSH`,
        });
      }
    } catch (err) {
      logger.error("Error generating transaction", { error: err });
    }
  };

  // 2. Block Mining Cycle (runs every 38 seconds)
  const miningCycle = async () => {
    try {
      const status = await fetchJson("/api/status");
      const mempoolSize = status?.data?.mempoolSize || 0;

      // Select random miner
      const miner = wallets[Math.floor(Math.random() * wallets.length)]!;
      logger.info(`Mining block with ${mempoolSize} pending mempool transactions...`, {
        miner: miner.address.slice(0, 10),
      });

      const mineRes = await fetchJson("/mine", {
        method: "POST",
        body: JSON.stringify({ miner: miner.address }),
      });

      if (mineRes && mineRes.block) {
        logger.info("✓ New Block Mined!", {
          height: mineRes.block.index,
          hash: mineRes.block.hash.slice(0, 16),
          txCount: mineRes.block.transactions.length,
          difficulty: mineRes.block.difficulty,
        });
      }
    } catch (err) {
      logger.error("Error in mining cycle", { error: err });
    }
  };

  // Fund initial wallet
  await fetchJson("/mine", {
    method: "POST",
    body: JSON.stringify({ miner: alice.address }),
  });

  // Run first tx after 3s
  setTimeout(generateTxCycle, 3000);

  // Interval for transaction generation (every 10s)
  setInterval(generateTxCycle, 10_000);

  // Interval for block mining (every 38s)
  setInterval(miningCycle, 38_000);
}

startDaemon();
