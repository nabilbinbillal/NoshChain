import { formatNosh } from "./format.js";

const NODE = process.env.API_URL ?? "http://localhost:3001";

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: npm run balance <address|wallet-name>");
    console.log("Example: npm run balance alice");
    console.log("Example: npm run balance 27982254690517c92abd56fd0f4871f60aee92f6");
    process.exit(1);
  }

  let address = args[0]!;

  if (!/^[0-9a-f]{40}$/.test(address)) {
    const { NoshWallet } = await import("./wallet.js");
    const wallet = NoshWallet.loadFromFile(`data/wallets/${address}.json`);
    address = wallet.address;
  }

  const response = await fetch(`${NODE}/api/address/${address}/balance`);
  const body = (await response.json()) as {
    success?: boolean;
    data?: { address: string; balance: string; decimals: number };
    error?: { message: string };
  };

  if (!response.ok || !body.success || !body.data) {
    console.error(body.error?.message ?? "Failed to fetch balance");
    process.exit(1);
  }

  const balance = BigInt(body.data.balance);

  console.log("=== NOSH BALANCE ===");
  console.log("Address:", body.data.address);
  console.log("Balance (wei):", balance.toString());
  console.log("Balance (NOSH):", formatNosh(balance));
  console.log("Decimals:", body.data.decimals);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
