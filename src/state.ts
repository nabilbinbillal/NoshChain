import type { Chain, Transaction } from "./types.js";
import {
  GENESIS_SENDER,
  MINING_REWARD_SENDER,
  INITIAL_SUPPLY,
} from "./types.js";
import { calculateIssuedMiningSupply } from "./crypto.js";
import { isTokenTransaction, validateTokenTransfers } from "./tokens.js";

export type BalanceMap = Record<string, bigint>;
export type NonceMap = Record<string, number>;

export function calculateBalances(chain: Chain): BalanceMap {
  const result: BalanceMap = {};

  for (const block of chain) {
    let totalFees = 0n;
    let minerAddress: string | null = block.miner;

    for (const tx of block.transactions) {
      const amount = BigInt(tx.amount);
      const fee = BigInt(tx.fee);

      if (tx.from === MINING_REWARD_SENDER) {
        minerAddress = tx.to;
        result[tx.to] = (result[tx.to] ?? 0n) + amount;
        continue;
      }

      if (tx.from === GENESIS_SENDER) {
        result[tx.to] = (result[tx.to] ?? 0n) + amount;
        continue;
      }

      const fromBalance = result[tx.from] ?? 0n;

      /*
       * Token transfers use `amount` for the token quantity.
       * Only the native NOSH fee is deducted from the native balance.
       */
      const nativeCost = isTokenTransaction(tx) ? fee : amount + fee;

      if (fromBalance < nativeCost) {
        throw new Error(
          `Negative balance for ${tx.from} at block ${block.index}`
        );
      }

      result[tx.from] = fromBalance - nativeCost;

      if (!isTokenTransaction(tx)) {
        result[tx.to] = (result[tx.to] ?? 0n) + amount;
      }

      totalFees += fee;
    }

    if (minerAddress && totalFees > 0n) {
      result[minerAddress] = (result[minerAddress] ?? 0n) + totalFees;
    }
  }

  return result;
}

export function calculateNonces(chain: Chain): NonceMap {
  const result: NonceMap = {};

  for (const block of chain) {
    for (const tx of block.transactions) {
      if (
        tx.from === GENESIS_SENDER ||
        tx.from === MINING_REWARD_SENDER
      ) {
        continue;
      }

      const expected = result[tx.from] ?? 0;
      if (tx.nonce !== expected) {
        throw new Error(
          `Invalid nonce for ${tx.from} at block ${block.index}: expected ${expected}, got ${tx.nonce}`
        );
      }
      result[tx.from] = expected + 1;
    }
  }

  return result;
}

export function getBalance(chain: Chain, address: string): bigint {
  return calculateBalances(chain)[address] ?? 0n;
}

export function getNonce(chain: Chain, address: string): number {
  return calculateNonces(chain)[address] ?? 0;
}

export function calculateTotalSupply(chain: Chain): bigint {
  const balances = calculateBalances(chain);
  let total = 0n;
  for (const balance of Object.values(balances)) {
    total += balance;
  }
  return total;
}

export function calculateIssuedSupply(chain: Chain): bigint {
  return INITIAL_SUPPLY + calculateIssuedMiningSupply(chain.length);
}

export function validateChainState(chain: Chain): boolean {
  try {
    calculateBalances(chain);
    calculateNonces(chain);

    if (!validateTokenTransfers(chain)) {
      return false;
    }

    return calculateTotalSupply(chain) === calculateIssuedSupply(chain);
  } catch {
    return false;
  }
}

export function formatBalances(
  balances: BalanceMap
): Record<string, string> {
  const formatted: Record<string, string> = {};
  for (const [address, balance] of Object.entries(balances)) {
    formatted[address] = balance.toString();
  }
  return formatted;
}

export function transactionCost(tx: Transaction): bigint {
  // Native transaction:
  //   native balance cost = amount + fee
  //
  // Token transaction:
  //   amount is denominated in the token itself,
  //   so only the native NOSH fee is charged here.
  return isTokenTransaction(tx)
    ? BigInt(tx.fee)
    : BigInt(tx.amount) + BigInt(tx.fee);
}

export function transactionKey(tx: Transaction): string {
  return `${tx.from}:${tx.nonce}`;
}
