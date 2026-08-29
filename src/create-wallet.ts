import { NoshWallet } from "./wallet.js";

function createWallet(name: string) {
  const wallet = new NoshWallet();
  const file = wallet.save(name);

  console.log(`${name} wallet created.`);
  console.log(`Address: ${wallet.address}`);
  console.log(`File: ${file}\n`);
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Usage: npm run wallet <name>");
  process.exit(1);
}

const name = args[0];
if (!name) {
  console.log("Usage: npm run wallet <name>");
  process.exit(1);
}
createWallet(name);

console.log("IMPORTANT: Never share your private key.");
