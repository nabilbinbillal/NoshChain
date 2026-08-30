import { createHash } from "node:crypto";
import type { Chain, Token, Transaction } from "./types.js";
import { MIN_FEE } from "./types.js";
import { validateAddress } from "./validation.js";

export const TOKEN_DECIMALS_MAX = 18;

type TokenTransaction = Transaction & {
  tokenAction?: "create" | "transfer";
  tokenId?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  tokenSupply?: string;
};

export function tokenIdFromCreation(
  creator: string,
  name: string,
  symbol: string,
  supply: string,
  decimals: number,
  nonce: number
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        creator,
        name,
        symbol,
        supply,
        decimals,
        nonce,
      })
    )
    .digest("hex");
}

export function isTokenTransaction(tx: Transaction): boolean {
  return (
    (tx.tokenAction === "transfer" || tx.tokenAction === "create") &&
    typeof tx.tokenId === "string" &&
    validateTokenId(tx.tokenId)
  );
}

export function isTokenCreationTransaction(tx: Transaction): boolean {
  return (
    tx.tokenAction === "create" &&
    typeof tx.tokenId === "string" &&
    typeof tx.tokenName === "string" &&
    typeof tx.tokenSymbol === "string" &&
    typeof tx.tokenDecimals === "number" &&
    typeof tx.tokenSupply === "string"
  );
}

export function validateTokenId(id: string): boolean {
  return /^[0-9a-f]{64}$/.test(id);
}

export function validateTokenAmount(amount: string): boolean {
  try {
    return BigInt(amount) > 0n;
  } catch {
    return false;
  }
}

export function validateTokenMetadata(input: {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  creator: string;
}): string | null {
  if (
    typeof input.name !== "string" ||
    input.name.length < 1 ||
    input.name.length > 64
  ) {
    return "Token name must contain 1-64 characters";
  }

  if (
    typeof input.symbol !== "string" ||
    !/^[A-Z0-9]{1,12}$/.test(input.symbol)
  ) {
    return "Token symbol must be 1-12 uppercase letters/numbers";
  }

  if (
    !Number.isInteger(input.decimals) ||
    input.decimals < 0 ||
    input.decimals > TOKEN_DECIMALS_MAX
  ) {
    return "Token decimals must be between 0 and 18";
  }

  if (!validateTokenAmount(input.totalSupply)) {
    return "Token supply must be a positive integer";
  }

  if (!validateAddress(input.creator)) {
    return "Invalid creator address";
  }

  return null;
}

export function tokenFeeIsValid(tx: Transaction, minFee: bigint = MIN_FEE): boolean {
  try {
    return BigInt(tx.fee) >= minFee;
  } catch {
    return false;
  }
}

export function calculateTokens(chain: Chain): Map<string, Token> {
  const tokens = new Map<string, Token>();

  for (const block of chain) {
    for (const rawTx of block.transactions) {
      const tx = rawTx as TokenTransaction;

      if (!isTokenCreationTransaction(tx)) continue;
      if (!tx.tokenId || tokens.has(tx.tokenId)) continue;

      tokens.set(tx.tokenId, {
        id: tx.tokenId,
        name: tx.tokenName!,
        symbol: tx.tokenSymbol!,
        decimals: tx.tokenDecimals!,
        totalSupply: tx.tokenSupply!,
        creator: tx.from,
        createdAt: block.index,
        creationTx: tx.signature || tx.tokenId, // unique id of the creation tx
      });
    }
  }

  return tokens;
}

export function getToken(chain: Chain, tokenId: string): Token | null {
  return calculateTokens(chain).get(tokenId) ?? null;
}

export function getAllTokens(chain: Chain): Token[] {
  return Array.from(calculateTokens(chain).values());
}

export function getTokenBalances(
  chain: Chain,
  tokenId: string
): Record<string, string> {
  const balances: Record<string, bigint> = {};

  for (const block of chain) {
    for (const rawTx of block.transactions) {
      const tx = rawTx as TokenTransaction;
      if (tx.tokenId !== tokenId) continue;

      if (tx.tokenAction === "create") {
        const supply = BigInt(tx.tokenSupply || "0");
        balances[tx.from] = (balances[tx.from] || 0n) + supply;
      } else if (tx.tokenAction === "transfer") {
        const amount = BigInt(tx.amount || "0");
        const fromBal = balances[tx.from] || 0n;
        if (fromBal < amount) continue;
        balances[tx.from] = fromBal - amount;
        balances[tx.to] = (balances[tx.to] || 0n) + amount;
      }
    }
  }

  const result: Record<string, string> = {};
  for (const [addr, bal] of Object.entries(balances)) {
    if (bal > 0n) result[addr] = bal.toString();
  }
  return result;
}

export function getTokenBalance(
  chain: Chain,
  tokenId: string,
  address: string
): bigint {
  const balances = getTokenBalances(chain, tokenId);
  return BigInt(balances[address] || "0");
}

/**
 * Validate the complete token state of a chain.
 *
 * Rules:
 * - Every token ID must be deterministic.
 * - A token may only be created once.
 * - Creation mints exactly tokenSupply to the creator.
 * - Token transfers require an existing token.
 * - Token transfers cannot overspend.
 * - Token creation cannot contain a non-zero native amount.
 */
export function validateTokenTransfers(chain: Chain): boolean {
  const tokenBalances = new Map<string, Map<string, bigint>>();
  const createdTokens = new Map<string, string>();

  for (const block of chain) {
    for (const rawTx of block.transactions) {
      const tx = rawTx as TokenTransaction;

      if (tx.tokenAction === undefined) {
        /*
         * Native transactions must not silently contain token IDs.
         */
        if (tx.tokenId !== undefined) {
          return false;
        }
        continue;
      }

      if (!isTokenTransaction(tx)) {
        return false;
      }

      if (!validateTokenId(tx.tokenId!)) {
        return false;
      }

      if (!tokenBalances.has(tx.tokenId!)) {
        tokenBalances.set(tx.tokenId!, new Map());
      }

      const balances = tokenBalances.get(tx.tokenId!)!;

      if (tx.tokenAction === "create") {
        if (!isTokenCreationTransaction(tx)) {
          return false;
        }

        if (tx.amount !== "0") {
          return false;
        }

        const metadataError = validateTokenMetadata({
          name: tx.tokenName!,
          symbol: tx.tokenSymbol!,
          decimals: tx.tokenDecimals!,
          totalSupply: tx.tokenSupply!,
          creator: tx.from,
        });

        if (metadataError) {
          return false;
        }

        const expectedId = tokenIdFromCreation(
          tx.from,
          tx.tokenName!,
          tx.tokenSymbol!,
          tx.tokenSupply!,
          tx.tokenDecimals!,
          tx.nonce
        );

        if (tx.tokenId !== expectedId) {
          return false;
        }

        /*
         * Token IDs are unique protocol objects. Re-creation is invalid.
         */
        if (createdTokens.has(tx.tokenId!)) {
          return false;
        }

        createdTokens.set(tx.tokenId!, tx.from);

        const supply = BigInt(tx.tokenSupply!);

        if (supply <= 0n) {
          return false;
        }

        /*
         * The creator receives the entire initial supply exactly once.
         */
        balances.set(
          tx.from,
          (balances.get(tx.from) || 0n) + supply
        );

        continue;
      }

      if (tx.tokenAction === "transfer") {
        /*
         * A transfer cannot happen before creation.
         */
        if (!createdTokens.has(tx.tokenId!)) {
          return false;
        }

        if (!validateTokenAmount(tx.amount)) {
          return false;
        }

        const amount = BigInt(tx.amount);
        const fromBal = balances.get(tx.from) || 0n;

        if (fromBal < amount) {
          return false;
        }

        balances.set(tx.from, fromBal - amount);
        balances.set(
          tx.to,
          (balances.get(tx.to) || 0n) + amount
        );

        continue;
      }

      return false;
    }
  }

  return true;
}
