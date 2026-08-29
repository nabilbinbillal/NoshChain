# NoshChain

A native proof-of-work blockchain in TypeScript with secp256k1 wallets, SHA-256 hashing, JSON persistence, and HTTP-based peer synchronization.

## Security Warning

**This is educational/development blockchain software, not production-grade cryptocurrency infrastructure.**

- PoW is real but lightweight (designed for local development)
- P2P uses HTTP polling/broadcast, not a production P2P protocol
- Single-process mutex only (not safe across multiple processes on the same data file)
- No encryption or peer authentication
- Intended for local testing and learning

## Architecture

```
src/
  node.ts           # Node entry point
  server.ts         # HTTP API (legacy + /api routes)
  api/              # Explorer/wallet REST API layer
  blockchain.ts     # Chain + mining logic
  mempool.ts        # Pending transactions
  p2p.ts            # Peer sync and propagation
  validation.ts     # Block/transaction/chain validation
  state.ts          # Balances and nonces
  crypto.ts         # Hashing, PoW, rewards, supply math
  wallet.ts         # secp256k1 wallet
  storage.ts        # Atomic JSON persistence
  config.ts         # Environment configuration
  types.ts          # Types and constants
  create-wallet.ts  # Wallet CLI
  mine.ts           # Mining CLI
  send-nosh.ts      # Send CLI
  tests/            # Test suite (node:test)
```

### Components

- **Nodes**: HTTP servers maintaining chain state, mempool, and peer list
- **Wallets**: secp256k1 key pairs; address = last 40 hex chars of SHA-256(public-key-DER)
- **Transactions**: Signed native NOSH transfers with fees and chain ID
- **Blocks**: PoW-sealed containers with miner, difficulty, and transactions
- **Mempool**: Valid pending transactions included when a block is mined
- **Consensus**: Proof-of-work with difficulty adjustment targeting 60-second blocks

## NOSH Currency

| Property | Value |
|----------|-------|
| Name | Nosh |
| Symbol | NOSH |
| Decimals | 18 |
| Smallest unit | 1 wei = 10⁻¹⁸ NOSH |
| Min fee | 0.001 NOSH |

Amounts are stored as strings and calculated with `BigInt`.

## Monetary Policy

| Parameter | Value |
|-----------|-------|
| Genesis supply | 21,000,000 NOSH |
| Genesis address | `27982254690517c92abd56fd0f4871f60aee92f6` |
| Initial block reward | 50 NOSH |
| Halving interval | 2,102,400 blocks |
| Target block time | 60 seconds |

### Actual Maximum Supply

Calculated from the implementation (not an approximation):

| Component | Amount (NOSH) | Exact wei |
|-----------|---------------|-----------|
| Genesis allocation | 21,000,000 | `21000000000000000000000000` |
| Total mining rewards | 210,239,949 | `210239949999999999939030400` |
| **Maximum supply** | **231,239,949** | **`231239949999999999939030400`** |

Mining rewards follow `50 → 25 → 12.5 → ...` NOSH per block, halving every 2,102,400 blocks until the reward reaches zero. Rewards are computed in wei as `BLOCK_REWARD >> halving` (integer right-shift). Because halving operates on the smallest unit, the total maximum supply in wei is **not** exactly `231,239,949 × 10¹⁸`; the canonical value is the wei string above. Displaying in whole NOSH uses integer division (`wei / 10¹⁸`), which yields 231,239,949.

Query live values via `GET /api/network` or `GET /network`.

## Network Identification

| Parameter | Testnet Value |
|-----------|---------------|
| Network name | `noshchain-testnet` |
| Chain ID | `13371337` |
| Genesis hash | Deterministic (fixed genesis timestamp) |

Transactions and blocks include `chainId` to prevent cross-network replay.

## Transaction Format

```json
{
  "chainId": "13371337",
  "from": "40-char-hex-address",
  "to": "40-char-hex-address",
  "amount": "1000000000000000000",
  "fee": "1000000000000000000",
  "nonce": 0,
  "signature": "base64-signature",
  "publicKey": "PEM-format-public-key"
}
```

## Block Format

```json
{
  "index": 1,
  "timestamp": 1704067200000,
  "transactions": [],
  "previousHash": "...",
  "hash": "...",
  "miner": "40-char-hex-address",
  "difficulty": 2,
  "powNonce": 12345,
  "chainId": "13371337"
}
```

## Proof-of-Work

- Block hash must start with `difficulty` leading hex zeros
- `powNonce` is incremented until the hash satisfies the target
- Difficulty adjusts every 10 blocks based on actual vs. 60-second target
- Chain selection uses accumulated work (not just block count)

## REST API

All `/api/*` endpoints return a consistent JSON envelope:

```json
{
  "success": true,
  "data": {}
}
```

Errors use HTTP status codes and:

```json
{
  "success": false,
  "error": {
    "code": "BLOCK_NOT_FOUND",
    "message": "Block not found"
  }
}
```

Amounts are always returned as integer strings in the smallest unit (wei). Never send private keys to the API.

### Network

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Node status summary |
| GET | `/api/network` | Network identity and monetary policy |
| GET | `/api/stats` | Chain statistics and monetary snapshot |
| GET | `/api/peers` | Configured peer URLs |

```bash
curl http://localhost:3001/api/status
curl http://localhost:3001/api/network
curl http://localhost:3001/api/stats
curl http://localhost:3001/api/peers
```

### Blockchain

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/blocks` | Paginated block summaries (`?limit=20&offset=0`) |
| GET | `/api/blocks/latest` | Latest block |
| GET | `/api/blocks/:height` | Block by height |
| GET | `/api/blocks/hash/:hash` | Block by hash |
| GET | `/api/chain` | Full chain with metadata |

```bash
curl http://localhost:3001/api/blocks?limit=10&offset=0
curl http://localhost:3001/api/blocks/latest
curl http://localhost:3001/api/blocks/0
curl http://localhost:3001/api/blocks/hash/<block-hash>
curl http://localhost:3001/api/chain
```

### Transactions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/transactions` | Submit signed transaction to mempool |
| GET | `/api/transactions/:hash` | Lookup confirmed or pending transaction |
| GET | `/api/mempool` | Pending transactions (`?limit=50&offset=0`) |
| GET | `/api/mempool/stats` | Mempool fee and count summary |

```bash
curl -X POST http://localhost:3001/api/transactions \
  -H "Content-Type: application/json" \
  -d @signed-transaction.json

curl http://localhost:3001/api/transactions/<tx-hash>
curl http://localhost:3001/api/mempool
curl http://localhost:3001/api/mempool/stats
```

### Addresses

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/address/:address` | Address summary (balance, nonce, tx count) |
| GET | `/api/address/:address/balance` | Address balance |
| GET | `/api/address/:address/transactions` | Address transaction history |

```bash
curl http://localhost:3001/api/address/<address>
curl http://localhost:3001/api/address/<address>/balance
curl http://localhost:3001/api/address/<address>/transactions
```

### Monetary fields (`GET /api/network`)

| Field | Description |
|-------|-------------|
| `name` / `symbol` | Nosh / NOSH |
| `decimals` | 18 |
| `minFee` | Minimum transaction fee (wei) |
| `blockReward` | Next block mining reward (wei) |
| `halvingEra` | Current halving era |
| `blocksUntilNextHalving` | Blocks until next halving |
| `currentDifficulty` | Latest block difficulty |
| `genesisSupply` | Genesis allocation (wei) |
| `issuedSupply` | Total issued supply at chain tip (wei) |
| `circulatingSupply` | Sum of all balances (wei) |
| `maxSupply` | Protocol maximum supply: `231239949999999999939030400` wei (231,239,949 NOSH display) |

## Legacy Node Endpoints

These endpoints remain available for node operation and P2P sync:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Node info |
| GET | `/chain` | Full blockchain |
| GET | `/blockchain` | Alias for `/chain` |
| GET | `/blocks/:height` | Block by height |
| GET | `/balances` | All balances |
| GET | `/balance/:address` | Address balance |
| GET | `/nonce/:address` | Next nonce |
| GET | `/network` | Network and supply info |
| GET | `/peers` | Configured peers |
| POST | `/transaction` | Submit transaction to mempool |
| POST | `/mine` | Mine block (`{"miner":"address"}`) |
| POST | `/peers` | Add peer (`{"peer":"http://..."}`) |
| POST | `/blocks` | Submit mined block (P2P propagation) |
| GET | `/sync` | Sync with peers (most-work valid chain) |

## Installation

```bash
npm install
cp .env.example .env
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `PEER` | — | Comma-separated peer URLs |
| `DATA_FILE` | `data/blockchain.json` | Chain persistence file |
| `DIFFICULTY` | `2` | Initial PoW difficulty (must match across all peers on the same network) |
| `NODE_ENV` | `development` | `production` hides internal errors |

## Running a Two-Node Local Network

**Terminal 1 — Node 1:**
```bash
npm run node
```

**Terminal 2 — Node 2:**
```bash
npm run node2
```

Node 2 uses `PORT=3002`, `PEER=http://localhost:3001`, and `DATA_FILE=data/node2-chain.json`.

**Sync node 2:**
```bash
curl http://localhost:3002/sync
```

## Create a Wallet

```bash
npm run wallet alice
```

Creates `data/wallets/alice.json` with address, public key, and private key. **Never share the private key.**

## Send NOSH

Transactions go to the mempool and must be mined to confirm.

```bash
# Start node first
npm run node

# Send 1 NOSH (amount in wei)
npm run send alice <recipient-address> 1000000000000000000
```

## Check Balance

```bash
# By wallet name (loads data/wallets/alice.json)
npm run balance alice

# By address
npm run balance 27982254690517c92abd56fd0f4871f60aee92f6
```

## Mine a Block

```bash
npm run mine <your-address>
```

Mining includes pending mempool transactions plus the block reward. The miner receives the reward and all transaction fees in the block.

## Inspect the Chain

```bash
curl http://localhost:3001/
curl http://localhost:3001/chain
curl http://localhost:3001/blocks/0
curl http://localhost:3001/balance/<address>
curl http://localhost:3001/network
```

## Development

```bash
npm run check        # TypeScript validation
npm test             # All tests (67 tests)
npm run test:unit    # Unit tests only
npm run test:e2e     # Two-node integration test
```

## Limitations

- **HTTP P2P only**: Peers communicate via REST, not a binary P2P protocol
- **No peer authentication**: Any peer URL can be added
- **Single-process safety**: Do not run two processes on the same `DATA_FILE`
- **Lightweight PoW**: Low difficulty for dev; increase `DIFFICULTY` for slower mining
- **No light clients**: Full chain required for validation
- **JSON persistence**: Not optimized for very large chains
- **Mempool not persisted across invalid chain replacement**: Mempool clears on chain reorg
- **Difficulty adjustment interval**: 10 blocks (dev-friendly; not mainnet-calibrated)
- **No transaction index database**: Transaction and address history are computed on demand from chain state
- **No WebSocket streaming**: Poll REST endpoints for updates

## License

ISC
