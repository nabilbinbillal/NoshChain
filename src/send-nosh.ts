import { NoshWallet } from "./wallet.js";
import { MIN_FEE } from "./types.js";
import { formatNosh } from "./format.js";

const NODE = process.env.API_URL ?? "http://localhost:3001";

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log(
      "Usage: npm run send <from-wallet> <to-address> <amount> [fee]"
    );
    console.log(
      "Example: npm run send alice 3dba8afd6a48c6df0510a48abca749cd4bd49fdb 1000000000000000000"
    );
    console.log("Amounts are in wei (18 decimals). 1 NOSH = 10^18 wei");
    process.exit(1);
  }

  const fromWalletName = args[0]!;
  const toAddress = args[1]!;
  const amount = args[2]!;
  const fee = args[3] ?? MIN_FEE.toString();

  if (!/^[0-9a-f]{40}$/.test(toAddress)) {
    console.log("Invalid recipient address format");
    process.exit(1);
  }

  try {
    const amountValue = BigInt(amount);
    if (amountValue <= 0n) {
      console.log("Amount must be greater than 0");
      process.exit(1);
    }
  } catch {
    console.log("Invalid amount format");
    process.exit(1);
  }

  try {
    const feeValue = BigInt(fee);
    if (feeValue < MIN_FEE) {
      console.log(
        `Fee must be at least ${MIN_FEE.toString()} wei (0.001 NOSH)`
      );
      process.exit(1);
    }
  } catch {
    console.log("Invalid fee format");
    process.exit(1);
  }

  const wallet = NoshWallet.loadFromFile(
    `data/wallets/${fromWalletName}.json`
  );

  const balanceResponse = await fetch(
    `${NODE}/balance/${wallet.address}`
  );
  const balance = (await balanceResponse.json()) as { balance: string };

  const nonceResponse = await fetch(
    `${NODE}/nonce/${wallet.address}`
  );
  const nonceData = (await nonceResponse.json()) as { nonce: number };

  const signedTransaction = wallet.sign(
    wallet.address,
    toAddress,
    amount,
    fee,
    nonceData.nonce
  );

  console.log("=== NOSH TRANSFER ===");
  console.log("From:", wallet.address);
  console.log("To:  ", toAddress);
  console.log("Before:", formatNosh(BigInt(balance.balance)), "NOSH");
  console.log("Sending:", formatNosh(BigInt(amount)), "NOSH");
  console.log("Fee:", formatNosh(BigInt(fee)), "NOSH");

  const response = await fetch(`${NODE}/transaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signedTransaction),
  });

  const data = await response.json();

  console.log("\nNode response:");
  console.log(JSON.stringify(data, null, 2));

  if (!response.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
