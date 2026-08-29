import { loadConfig } from "./config.js";
import { Blockchain } from "./blockchain.js";
import { validateAddress } from "./validation.js";
import { calculateBlockReward } from "./crypto.js";
import { formatNosh } from "./format.js";

const config = loadConfig();
const NODE = process.env.API_URL ?? `http://localhost:${config.port}`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: npm run mine <address>");
    process.exit(1);
  }

  const miner = args[0]!;

  if (!validateAddress(miner)) {
    console.log("Invalid address format");
    process.exit(1);
  }

  console.log("⛏️  NOSH Mining");
  console.log("Connecting to:", NODE);
  console.log("Miner address:", miner);

  const start = Date.now();
  const response = await fetch(`${NODE}/mine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ miner }),
  });

  const data = await response.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`\nMining completed in ${elapsed}s`);
  console.log(JSON.stringify(data, null, 2));

  if (!response.ok) {
    process.exit(1);
  }

  const block = data.block as { index: number };
  const reward = calculateBlockReward(block.index);
  console.log(`\nReward: ${formatNosh(reward)} NOSH`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
