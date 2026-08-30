#!/usr/bin/env node
import { NoshWallet } from "./wallet.js";
import { MIN_FEE } from "./types.js";

const NODE = process.env.NODE_URL ?? process.env.API_URL ?? "http://localhost:3001";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.log(`Usage: npx tsx src/send-token.ts <walletName> <tokenId> <toAddress> <amount>`);
    process.exit(1);
  }

  const [walletName, tokenId, to, amount] = args as [string, string, string, string];
  const wallet = NoshWallet.loadFromFile(`data/wallets/${walletName}.json`);

  const nonceRes = await fetch(`${NODE}/nonce/${wallet.address}`);
  const { nonce } = (await nonceRes.json()) as { nonce: number };

  const signed = wallet.sign(
    wallet.address,
    to,
    amount,
    MIN_FEE.toString(),
    nonce,
    {
      tokenAction: "transfer",
      tokenId,
    }
  );

  const res = await fetch(`${NODE}/transaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signed),
  });

  const body = await res.json();
  if (!res.ok) {
    console.error("Failed:", body);
    process.exit(1);
  }

  console.log("Token transfer accepted!");
  console.log("From   :", wallet.address);
  console.log("To     :", to);
  console.log("Token  :", tokenId);
  console.log("Amount :", amount);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
