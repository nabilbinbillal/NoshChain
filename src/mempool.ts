import type { Transaction } from "./types.js";
import { verifyTransaction } from "./validation.js";
import { isTokenTransaction } from "./tokens.js";
import {
  calculateBalances,
  calculateNonces,
  transactionCost,
  transactionKey,
  type BalanceMap,
  type NonceMap,
} from "./state.js";
import type { Chain } from "./types.js";

export class Mempool {
  private transactions: Transaction[] = [];

  list(): Transaction[] {
    return [...this.transactions];
  }

  clear(): void {
    this.transactions = [];
  }

  removeMany(txs: Transaction[]): void {
    const keys = new Set(txs.map(transactionKey));
    this.transactions = this.transactions.filter(
      (tx) => !keys.has(transactionKey(tx))
    );
  }

  add(tx: Transaction, chain: Chain): void {
    if (!verifyTransaction(tx)) {
      throw new Error("Invalid transaction signature");
    }

    const key = transactionKey(tx);
    if (
      this.transactions.some(
        (existing) => transactionKey(existing) === key
      )
    ) {
      throw new Error("Transaction already in mempool");
    }

    const expectedNonce = this.projectedNonce(chain, tx.from);
    if (tx.nonce !== expectedNonce) {
      throw new Error(`Invalid nonce. Expected ${expectedNonce}`);
    }

    const cost = transactionCost(tx);
    if (this.projectedBalance(chain, tx.from) < cost) {
      throw new Error("Insufficient NOSH balance (including fee)");
    }

    this.transactions.push(tx);
  }

  selectForBlock(chain: Chain, maxTransactions = 100): Transaction[] {
    const selected: Transaction[] = [];
    const balances: BalanceMap = { ...calculateBalances(chain) };
    const nonces: NonceMap = { ...calculateNonces(chain) };
    const usedKeys = new Set<string>();

    const sorted = [...this.transactions].sort((a, b) => {
      const feeDiff = BigInt(b.fee) - BigInt(a.fee);
      if (feeDiff > 0n) return 1;
      if (feeDiff < 0n) return -1;
      return a.nonce - b.nonce;
    });

    for (const tx of sorted) {
      const key = transactionKey(tx);
      if (usedKeys.has(key)) {
        continue;
      }

      const expectedNonce = nonces[tx.from] ?? 0;
      if (tx.nonce !== expectedNonce) {
        continue;
      }

      const cost = transactionCost(tx);
      if ((balances[tx.from] ?? 0n) < cost) {
        continue;
      }

      selected.push(tx);
      usedKeys.add(key);

      // Only native NOSH transfers change the native balance of the
      // recipient. Token amounts belong to token state, not NOSH state.
      balances[tx.from] = (balances[tx.from] ?? 0n) - cost;

      if (!isTokenTransaction(tx)) {
        balances[tx.to] =
          (balances[tx.to] ?? 0n) + BigInt(tx.amount);
      }

      nonces[tx.from] = expectedNonce + 1;

      if (selected.length >= maxTransactions) {
        break;
      }
    }

    return selected;
  }

  load(transactions: Transaction[]): void {
    this.transactions = transactions;
  }

  sanitize(chain: Chain): void {
    const pending = [...this.transactions];
    this.transactions = [];

    for (const tx of pending) {
      try {
        this.add(tx, chain);
      } catch {
        // Drop transactions that are no longer valid after restart/reorg.
      }
    }
  }

  private pendingFrom(address: string): Transaction[] {
    return this.transactions.filter((tx) => tx.from === address);
  }

  private projectedNonce(chain: Chain, address: string): number {
    const chainNonce = calculateNonces(chain)[address] ?? 0;
    return chainNonce + this.pendingFrom(address).length;
  }

  private projectedBalance(chain: Chain, address: string): bigint {
    const balance = calculateBalances(chain)[address] ?? 0n;
    const reserved = this.pendingFrom(address).reduce(
      (sum, tx) => sum + transactionCost(tx),
      0n
    );
    return balance - reserved;
  }
}
