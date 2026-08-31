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

  // Initialize two active test wallets
  const alice = new NoshWallet();
  const bob = new NoshWallet();

  logger.info("Activity wallets initialized", {
    alice: alice.address,
    bob: bob.address,
  });

  let sender = alice;
  let recipient = bob;
  let step = 0;

  const runCycle = async () => {
    try {
      step++;
      // Check node status
      const status = await fetchJson("/api/status");
      if (!status || !status.success) {
        logger.warn("Node not ready, waiting...");
        return;
      }

      const chainHeight = status.data.blocks;
      const senderBalRes = await fetchJson(`/api/address/${sender.address}`);
      const senderBal = BigInt(senderBalRes?.data?.balance || "0");
      const senderNonce = senderBalRes?.data?.nonce || 0;

      // If sender needs funds, mine a block to reward sender
      if (senderBal < WEI_PER_NOSH * 2n) {
        logger.info("Funding wallet via mining...", { address: sender.address });
        await fetchJson("/mine", {
          method: "POST",
          body: JSON.stringify({ miner: sender.address }),
        });
        return;
      }

      // Generate & sign transaction
      const txAmount = (WEI_PER_NOSH / 10n) * BigInt(step % 5 + 1); // 0.1 to 0.5 NOSH
      const tx = sender.sign(
        sender.address,
        recipient.address,
        txAmount.toString(),
        MIN_FEE.toString(),
        senderNonce
      );

      // Submit transaction
      const txRes = await fetchJson("/api/transactions", {
        method: "POST",
        body: JSON.stringify(tx),
      });

      if (txRes && txRes.success) {
        logger.info("Activity transaction submitted to mempool", {
          hash: txRes.data.hash,
          from: sender.address.slice(0, 8),
          to: recipient.address.slice(0, 8),
          amount: `${(txAmount / WEI_PER_NOSH).toString()} NOSH`,
        });

        // Mine block to confirm transaction
        const mineRes = await fetchJson("/mine", {
          method: "POST",
          body: JSON.stringify({ miner: sender.address }),
        });

        if (mineRes && mineRes.block) {
          logger.info("Block mined with confirmed transaction", {
            height: mineRes.block.index,
            hash: mineRes.block.hash.slice(0, 16),
            txCount: mineRes.block.transactions.length,
          });
        }
      } else {
        logger.warn("Transaction submission failed", { response: txRes });
      }

      // Swap sender and recipient for next cycle
      [sender, recipient] = [recipient, sender];
    } catch (err) {
      logger.error("Activity daemon cycle error", { error: err });
    }
  };

  // Run initial cycle
  await runCycle();

  // Schedule regular interval every 35 seconds
  setInterval(runCycle, 35_000);
}

startDaemon();
