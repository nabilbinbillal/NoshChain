const NODE = process.env.NODE_URL ?? process.env.API_URL ?? "http://localhost:3001";

async function main() {
  const [tokenId, address] = process.argv.slice(2);
  if (!tokenId || !address) {
    console.log("Usage: npx tsx src/token-balance.ts <tokenId> <address>");
    process.exit(1);
  }
  const res = await fetch(`${NODE}/api/tokens/${tokenId}/balance/${address}`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
main().catch(console.error);
