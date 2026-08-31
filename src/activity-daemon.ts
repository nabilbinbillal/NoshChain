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
  logger.info("Starting NoshChain Realtime Randomized Activity Daemon", { nodeUrl: NODE_URL });

  // Initialize diverse actor wallets & miners
  const alice = new NoshWallet();
  const bob = new NoshWallet();
  const charlie = new NoshWallet();
  const diana = new NoshWallet();
  const eric = new NoshWallet();
  const fiona = new NoshWallet();

  const wallets = [alice, bob, charlie, diana, eric, fiona];
  
  // Diverse miner addresses
  const miners = [
    new NoshWallet().address,
    new NoshWallet().address,
    new NoshWallet().address,
    alice.address,
    bob.address
  ];

  logger.info("Randomized activity actors initialized", {
    actorsCount: wallets.length,
    minersCount: miners.length
  });

  // Helper for random int
  const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

  const scheduleNextTx = () => {
    const delay = randInt(10000, 20000);
    setTimeout(async () => {
      await generateRandomTx();
      scheduleNextTx();
    }, delay);
  };

  const generateRandomTx = async () => {
    try {
      const senderIdx = randInt(0, wallets.length - 1);
      let recipientIdx = randInt(0, wallets.length - 1);
      while (recipientIdx === senderIdx) {
        recipientIdx = randInt(0, wallets.length - 1);
      }

      const sender = wallets[senderIdx]!;
      const recipient = wallets[recipientIdx]!;

      // Check sender balance and nonce
      const accRes = await fetchJson(`/api/address/${sender.address}`);
      const balance = BigInt(accRes?.data?.balance || "0");
      const nonce = accRes?.data?.nonce || 0;

      if (balance < WEI_PER_NOSH / 2n) {
        logger.info("Funding actor wallet...", { miner: sender.address.slice(0, 10) });
        const res = await fetchJson("/api/mine", {
          method: "POST",
          body: JSON.stringify({ miner: sender.address }),
        });
        if (res && res.error && res.error.message && res.error.message.includes("Operation in progress")) {
          await new Promise((r) => setTimeout(r, 5000));
          await fetchJson("/api/mine", {
            method: "POST",
            body: JSON.stringify({ miner: sender.address }),
          });
        }
        return;
      }

      // Generate natural, randomized amounts (e.g. 0.0125 NOSH to 2.8500 NOSH)
      const randomFrac = (Math.random() * 2.5 + 0.01).toFixed(4);
      const amountWei = BigInt(Math.floor(parseFloat(randomFrac) * 1e18));
      
      // Randomized fee (0.0010 to 0.0018 NOSH)
      const feeWei = MIN_FEE + BigInt(randInt(10_000, 800_000)) * (10n ** 9n);

      const tx = sender.sign(
        sender.address,
        recipient.address,
        amountWei.toString(),
        feeWei.toString(),
        nonce
      );

      const res = await fetchJson("/api/transactions", {
        method: "POST",
        body: JSON.stringify(tx),
      });

      if (res && res.success) {
        logger.info("Realtime transaction submitted", {
          hash: res.data?.hash?.slice(0, 16),
          from: sender.address.slice(0, 8),
          to: recipient.address.slice(0, 8),
          amount: `${randomFrac} NOSH`,
        });
      }
    } catch (err) {
      logger.error("Error generating random transaction", { error: err });
    }
  };

  const scheduleNextMining = () => {
    const delay = randInt(60000, 120000);
    setTimeout(async () => {
      await executeMining();
      scheduleNextMining();
    }, delay);
  };

  const executeMining = async () => {
    try {
      const status = await fetchJson("/api/status");
      const mempoolSize = status?.data?.mempoolSize || 0;

      // Select random miner pool / address
      const minerAddress = miners[randInt(0, miners.length - 1)]!;

      logger.info(`Mining block with ${mempoolSize} pending transactions...`, {
        miner: minerAddress.slice(0, 10),
      });

      const mineRes = await fetchJson("/api/mine", {
        method: "POST",
        body: JSON.stringify({ miner: minerAddress }),
      });

      if (mineRes && mineRes.block) {
        logger.info("✓ New Block Mined!", {
          height: mineRes.block.index,
          hash: mineRes.block.hash.slice(0, 16),
          difficulty: mineRes.block.difficulty,
          txCount: mineRes.block.transactions.length,
        });
      } else if (mineRes && mineRes.error) {
        if (mineRes.error.message && mineRes.error.message.includes("Operation in progress")) {
          logger.info("Mining busy, retrying in 8s...");
          setTimeout(executeMining, 8000);
          return;
        }
        logger.warn("Mining attempt failed", { error: mineRes.error });
      } else {
        logger.error("Unexpected mining response", { response: mineRes });
      }
    } catch (err) {
      logger.error("Error in mining cycle", { error: err });
    }
  };

  // Initial funding - fund all actors sequentially with retry
  for (const w of wallets) {
    let retries = 3;
    while (retries-- > 0) {
        const res = await fetchJson("/api/mine", {
          method: "POST",
          body: JSON.stringify({ miner: w.address }),
        });
      if (res && res.block) break;
      if (res && res.error && res.error.message && res.error.message.includes("Operation in progress")) {
        await new Promise((r) => setTimeout(r, 8000));
        continue;
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Start randomized transaction and mining loops
  setTimeout(scheduleNextTx, 2000);
  setTimeout(scheduleNextMining, 18000);
}

startDaemon();
