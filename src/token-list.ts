const NODE = process.env.NODE_URL ?? process.env.API_URL ?? "http://localhost:3001";

async function main() {
  const res = await fetch(`${NODE}/api/tokens`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}
main().catch(console.error);
