import { loadConfig } from "./config.js";
import { Blockchain } from "./blockchain.js";
import { P2PNetwork } from "./p2p.js";
import { createNodeServer } from "./server.js";
import { calculateBlockReward } from "./crypto.js";
import { formatNosh } from "./format.js";

const config = loadConfig();
const blockchain = new Blockchain(config);
const p2p = new P2PNetwork(blockchain);
const server = createNodeServer(config, blockchain, p2p);

server.listen(config.port, () => {
  const latest = blockchain.getLatestBlock();
  console.log(`
╔══════════════════════════════════════╗
║          🪙 NOSHCHAIN NODE           ║
╚══════════════════════════════════════╝

Network: NoshChain (${config.networkName})
Chain ID: ${config.chainId}
Coin:    NOSH (18 decimals)
Node:    http://localhost:${config.port}
Peers:   ${p2p.getPeerUrls().join(", ") || "(none)"}
Blocks:  ${blockchain.getChain().length}
Reward:  ${formatNosh(calculateBlockReward(blockchain.getChain().length))} NOSH
Difficulty: ${latest.difficulty}
Consensus: proof-of-work

Endpoints:
GET  /
GET  /chain
GET  /blockchain
GET  /blocks/:height
GET  /balances
GET  /balance/:address
GET  /nonce/:address
GET  /network
GET  /peers
POST /transaction
POST /mine
POST /peers
POST /blocks
GET  /sync

Blockchain:
${config.dataFile}
`);
});
