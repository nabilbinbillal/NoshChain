import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Chain, Transaction } from "./types.js";
import { transactionHash } from "./api/transaction-id.js";

// Extend Database type for better-sqlite3
type BetterSqlite3 = Database.Database;

interface PersistedState {
  chain: Chain;
  mempool: Transaction[];
  peers: string[];
}

export class DatabaseStorage {
  private db: BetterSqlite3;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_index INTEGER UNIQUE NOT NULL,
        block_data TEXT NOT NULL,
        block_hash TEXT UNIQUE NOT NULL,
        timestamp INTEGER NOT NULL,
        miner TEXT NOT NULL,
        difficulty INTEGER NOT NULL,
        chain_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tx_hash TEXT UNIQUE NOT NULL,
        tx_data TEXT NOT NULL,
        block_index INTEGER,
        block_hash TEXT,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        amount TEXT NOT NULL,
        fee TEXT NOT NULL,
        nonce INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (block_index) REFERENCES blocks(block_index)
      );

      CREATE TABLE IF NOT EXISTS peers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        peer_url TEXT UNIQUE NOT NULL,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tx_from ON transactions(from_address);
      CREATE INDEX IF NOT EXISTS idx_tx_to ON transactions(to_address);
      CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_tx_block ON transactions(block_index);
      CREATE INDEX IF NOT EXISTS idx_blocks_height ON blocks(block_index);
    `);
  }

  loadState(): PersistedState | null {
    try {
      const blocks = this.db
        .prepare("SELECT block_data FROM blocks ORDER BY block_index ASC")
        .all() as Array<{ block_data: string }>;

      if (blocks.length === 0) {
        return null;
      }

      const chain = blocks.map((b) => JSON.parse(b.block_data));

      const mempool = this.db
        .prepare(
          "SELECT tx_data FROM transactions WHERE status = 'pending' ORDER BY created_at ASC"
        )
        .all() as Array<{ tx_data: string }>;

      const mempoolTxs = mempool.map((m) => JSON.parse(m.tx_data));

      const peers = this.db
        .prepare("SELECT peer_url FROM peers ORDER BY added_at ASC")
        .all() as Array<{ peer_url: string }>;

      const peerUrls = peers.map((p) => p.peer_url);

      return {
        chain,
        mempool: mempoolTxs,
        peers: peerUrls,
      };
    } catch (error) {
      console.error("Failed to load state from database:", error);
      return null;
    }
  }

  saveState(state: PersistedState): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM transactions").run();
      this.db.prepare("DELETE FROM blocks").run();
      this.db.prepare("DELETE FROM peers").run();

      const blockStmt = this.db.prepare(`
        INSERT INTO blocks (block_index, block_data, block_hash, timestamp, miner, difficulty, chain_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const txStmt = this.db.prepare(`
        INSERT INTO transactions (tx_hash, tx_data, block_index, block_hash, from_address, to_address, amount, fee, nonce, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const peerStmt = this.db.prepare(`
        INSERT INTO peers (peer_url, added_at)
        VALUES (?, ?)
      `);

      const insertedHashes = new Set<string>();

      for (const block of state.chain) {
        blockStmt.run(
          block.index,
          JSON.stringify(block),
          block.hash,
          block.timestamp,
          block.miner,
          block.difficulty,
          block.chainId
        );

        for (const tx of block.transactions) {
          const txHash = this.computeTxHash(tx);
          if (!insertedHashes.has(txHash)) {
            insertedHashes.add(txHash);
            txStmt.run(
              txHash,
              JSON.stringify(tx),
              block.index,
              block.hash,
              tx.from,
              tx.to,
              tx.amount,
              tx.fee,
              tx.nonce,
              "confirmed",
              block.timestamp
            );
          }
        }
      }

      for (const tx of state.mempool) {
        const txHash = this.computeTxHash(tx);
        if (!insertedHashes.has(txHash)) {
          insertedHashes.add(txHash);
          txStmt.run(
            txHash,
            JSON.stringify(tx),
            null,
            null,
            tx.from,
            tx.to,
            tx.amount,
            tx.fee,
            tx.nonce,
            "pending",
            Date.now()
          );
        }
      }

      for (const peer of state.peers) {
        peerStmt.run(peer, Date.now());
      }
    });

    transaction();
  }

  private computeTxHash(tx: Transaction): string {
    return transactionHash(tx);
  }

  addTransaction(tx: Transaction, status: "pending" | "confirmed" = "pending"): void {
    const txHash = this.computeTxHash(tx);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO transactions (tx_hash, tx_data, from_address, to_address, amount, fee, nonce, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      txHash,
      JSON.stringify(tx),
      tx.from,
      tx.to,
      tx.amount,
      tx.fee,
      tx.nonce,
      status,
      Date.now()
    );
  }

  confirmTransaction(txHash: string, blockIndex: number, blockHash: string): void {
    const stmt = this.db.prepare(`
      UPDATE transactions 
      SET status = 'confirmed', block_index = ?, block_hash = ?
      WHERE tx_hash = ?
    `);
    stmt.run(blockIndex, blockHash, txHash);
  }

  getTransactionsByAddress(address: string): Transaction[] {
    const stmt = this.db.prepare(`
      SELECT tx_data FROM transactions 
      WHERE from_address = ? OR to_address = ?
      ORDER BY created_at DESC
    `);
    const results = stmt.all(address, address) as Array<{ tx_data: string }>;
    return results.map((r) => JSON.parse(r.tx_data));
  }

  getTransactionByHash(txHash: string): Transaction | null {
    const stmt = this.db.prepare("SELECT tx_data FROM transactions WHERE tx_hash = ?");
    const result = stmt.get(txHash) as { tx_data: string } | undefined;
    return result ? JSON.parse(result.tx_data) : null;
  }

  getMempoolTransactions(): Transaction[] {
    const stmt = this.db.prepare(`
      SELECT tx_data FROM transactions 
      WHERE status = 'pending' 
      ORDER BY created_at ASC
    `);
    const results = stmt.all() as Array<{ tx_data: string }>;
    return results.map((r) => JSON.parse(r.tx_data));
  }

  close(): void {
    this.db.close();
  }

  async backup(backupPath: string): Promise<void> {
    await this.db.backup(backupPath);
  }
}

export function loadStateDb(dbPath: string): PersistedState | null {
  const storage = new DatabaseStorage(dbPath);
  const state = storage.loadState();
  storage.close();
  return state;
}

export function saveStateDb(dbPath: string, state: PersistedState): void {
  const storage = new DatabaseStorage(dbPath);
  storage.saveState(state);
  storage.close();
}