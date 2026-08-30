#!/usr/bin/env node
import { NoshWallet } from "./wallet.js";
import { tokenIdFromCreation, validateTokenMetadata } from "./tokens.js";
import { MIN_FEE } from "./types.js";

const NODE = process.env.NODE_URL ?? process.env.API_URL ?? "http://localhost:3001";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 5) {
    console.log(`Usage: npx tsx src/create-token.ts <walletName> <name> <symbol> <decimals> <supply>`);
    process.exit(1);
  }

  const walletName = args[0]!;
  const name = args[1]!;
  const symbol = args[2]!;
  const decimals = Number(args[3]!);
  const supply = args[4]!;

  const wallet = NoshWallet.loadFromFile(`data/wallets/${walletName}.json`);

  const metaErr = validateTokenMetadata({
    name,
    symbol: symbol.toUpperCase(),
    decimals,
    totalSupply: supply,
    creator: wallet.address,
  });
  if (metaErr) {
    console.error("Invalid token:", metaErr);
    process.exit(1);
  }

  const nonceRes = await fetch(`${NODE}/nonce/${wallet.address}`);
  const { nonce } = (await nonceRes.json()) as { nonce: number };

  const tokenId = tokenIdFromCreation(
    wallet.address,
    name,
    symbol.toUpperCase(),
    supply,
    decimals,
    nonce
  );

  // Sign WITH the token fields so the signature matches transactionMessage
  const signed = wallet.sign(
    wallet.address,
    wallet.address,
    "0",
    MIN_FEE.toString(),
    nonce,
    {
      tokenAction: "create",
      tokenId,
      tokenName: name,
      tokenSymbol: symbol.toUpperCase(),
      tokenDecimals: decimals,
      tokenSupply: supply,
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

  console.log("Token creation transaction accepted!");
  console.log("Token ID :", tokenId);
  console.log("Name     :", name);
  console.log("Symbol   :", symbol.toUpperCase());
  console.log("Decimals :", decimals);
  console.log("Supply   :", supply);
  console.log("\nMine a block to confirm it:");
  console.log(`  curl -X POST ${NODE}/mine -H 'Content-Type: application/json' -d '{"miner":"${wallet.address}"}'`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
