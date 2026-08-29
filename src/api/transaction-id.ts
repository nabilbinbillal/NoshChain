import type { Transaction } from "../types.js";
import { sha256 } from "../crypto.js";

export function transactionHash(tx: Transaction): string {
  return sha256(
    JSON.stringify({
      chainId: tx.chainId,
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      fee: tx.fee,
      nonce: tx.nonce,
      signature: tx.signature,
      publicKey: tx.publicKey,
    })
  );
}
