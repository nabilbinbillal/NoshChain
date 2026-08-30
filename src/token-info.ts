const NODE = process.env.NODE_URL ?? "http://localhost:3001";

const tokenId = process.argv[2];

if (!tokenId) {
  console.error("Usage: npm run token:info <token-id>");
  process.exit(1);
}

const response = await fetch(`${NODE}/api/tokens/${tokenId}`);
const body = await response.json();

console.log(JSON.stringify(body, null, 2));
