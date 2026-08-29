import type { Block, Chain, Transaction } from "../types.js";
import {
  GENESIS_SENDER,
  MINING_REWARD_SENDER,
} from "../types.js";
import { transactionHash } from "./transaction-id.js";

export type TransactionStatus = "confirmed" | "pending";

export type IndexedTransaction = {
  hash: string;
  status: TransactionStatus;
  transaction: Transaction;
  blockHeight?: number;
  blockHash?: string;
  transactionIndex?: number;
  timestamp?: number;
};

export function findBlockByHash(chain: Chain, hash: string): Block | undefined {
  return chain.find((block) => block.hash === hash);
}

export function findTransaction(
  chain: Chain,
  mempool: Transaction[],
  hash: string
): IndexedTransaction | undefined {
  for (const tx of mempool) {
    if (transactionHash(tx) === hash) {
      return {
        hash,
        status: "pending",
        transaction: tx,
      };
    }
  }

  for (const block of chain) {
    for (let index = 0; index < block.transactions.length; index++) {
      const tx = block.transactions[index];
      if (!tx || transactionHash(tx) !== hash) {
        continue;
      }

      return {
        hash,
        status: "confirmed",
        transaction: tx,
        blockHeight: block.index,
        blockHash: block.hash,
        transactionIndex: index,
        timestamp: block.timestamp,
      };
    }
  }

  return undefined;
}

export function getAddressTransactions(
  chain: Chain,
  mempool: Transaction[],
  address: string
): IndexedTransaction[] {
  const results: IndexedTransaction[] = [];

  for (const block of chain) {
    for (let index = 0; index < block.transactions.length; index++) {
      const tx = block.transactions[index];
      if (!tx) {
        continue;
      }

      const involvesAddress =
        tx.from === address ||
        tx.to === address ||
        (tx.from === MINING_REWARD_SENDER && tx.to === address);

      if (!involvesAddress) {
        continue;
      }

      if (tx.from === GENESIS_SENDER && tx.to !== address) {
        continue;
      }

      results.push({
        hash: transactionHash(tx),
        status: "confirmed",
        transaction: tx,
        blockHeight: block.index,
        blockHash: block.hash,
        transactionIndex: index,
        timestamp: block.timestamp,
      });
    }
  }

  for (const tx of mempool) {
    if (tx.from !== address && tx.to !== address) {
      continue;
    }

    results.push({
      hash: transactionHash(tx),
      status: "pending",
      transaction: tx,
    });
  }

  return results.sort((a, b) => {
    const aTime = a.timestamp ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.timestamp ?? Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return (b.blockHeight ?? -1) - (a.blockHeight ?? -1);
  });
}

export function countAddressTransactions(
  chain: Chain,
  mempool: Transaction[],
  address: string
): number {
  return getAddressTransactions(chain, mempool, address).length;
}
