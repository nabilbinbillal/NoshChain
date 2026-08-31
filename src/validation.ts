import {
  createPublicKey,
  createVerify,
} from "node:crypto";
import type { Transaction, Block, Chain } from "./types.js";
import {
  GENESIS_ALLOCATION,
  GENESIS_SENDER,
  MINING_REWARD_SENDER,
  CHAIN_ID_STRING,
  MIN_FEE,
  GENESIS_PREVIOUS_HASH,
  GENESIS_TIMESTAMP,
  MAX_FUTURE_BLOCK_TIME_MS,
  MAX_BLOCK_DRIFT_MS,
} from "./types.js";
import { INITIAL_DIFFICULTY } from "./types.js";
import {
  sha256,
  transactionMessage,
  blockHash,
  calculateBlockReward,
  meetsDifficulty,
  calculateExpectedDifficulty,
  getChainWork,
} from "./crypto.js";
import { validateChainState } from "./state.js";
import { tokenIdFromCreation, isTokenTransaction, isTokenCreationTransaction, validateTokenId, validateTokenAmount, tokenFeeIsValid, validateTokenMetadata } from "./tokens.js";

export function validateAddress(address: string): boolean {
  return /^[0-9a-f]{40}$/.test(address);
}

export function validateAmount(amount: string): boolean {
  try {
    const value = BigInt(amount);
    return value > 0n;
  } catch {
    return false;
  }
}

export function validateFee(fee: string): boolean {
  try {
    const value = BigInt(fee);
    return value >= MIN_FEE;
  } catch {
    return false;
  }
}

export function validateNonce(nonce: number): boolean {
  // Nonces are part of the signed consensus message.
  // Unsafe JS integers can lose precision and create ambiguous values.
  return Number.isSafeInteger(nonce) && nonce >= 0;
}

export function isSystemTransaction(tx: Transaction): boolean {
  return (
    tx.from === GENESIS_SENDER || tx.from === MINING_REWARD_SENDER
  );
}

export function verifyTransaction(tx: Transaction): boolean {
  try {
    if (
      typeof tx.from !== "string" ||
      typeof tx.to !== "string" ||
      typeof tx.amount !== "string" ||
      typeof tx.fee !== "string" ||
      typeof tx.nonce !== "number" ||
      typeof tx.signature !== "string" ||
      typeof tx.publicKey !== "string" ||
      typeof tx.chainId !== "string"
    ) {
      return false;
    }

    if (tx.chainId !== CHAIN_ID_STRING) {
      return false;
    }

    if (!validateAddress(tx.from) || !validateAddress(tx.to)) {
      return false;
    }

    if (!validateFee(tx.fee) || !validateNonce(tx.nonce)) {
      return false;
    }

    const isCreation = isTokenCreationTransaction(tx);
    const isToken = isTokenTransaction(tx);

    /*
     * Native transfers require amount > 0.
     * Token creation is the sole valid transaction type with amount = 0.
     */
    if (isCreation) {
      if (tx.amount !== "0") {
        return false;
      }

      if (!validateTokenId(tx.tokenId!)) {
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

      /*
       * Token IDs are content-derived. This prevents a creator from
       * choosing arbitrary IDs and makes the protocol deterministic.
       */
      const expectedTokenId = tokenIdFromCreation(
        tx.from,
        tx.tokenName!,
        tx.tokenSymbol!,
        tx.tokenSupply!,
        tx.tokenDecimals!,
        tx.nonce
      );

      if (tx.tokenId !== expectedTokenId) {
        return false;
      }

      if (!tokenFeeIsValid(tx, MIN_FEE)) {
        return false;
      }
    } else if (isToken) {
      if (!validateTokenId(tx.tokenId!)) {
        return false;
      }

      if (tx.tokenAction !== "transfer") {
        return false;
      }

      if (!validateTokenAmount(tx.amount)) {
        return false;
      }

      if (!tokenFeeIsValid(tx, MIN_FEE)) {
        return false;
      }
    } else {
      if (!validateAmount(tx.amount)) {
        return false;
      }

      /*
       * Native transactions must not carry token fields.
       */
      if (
        tx.tokenId !== undefined ||
        tx.tokenAction !== undefined ||
        tx.tokenName !== undefined ||
        tx.tokenSymbol !== undefined ||
        tx.tokenDecimals !== undefined ||
        tx.tokenSupply !== undefined
      ) {
        return false;
      }
    }

    const publicKey = createPublicKey(tx.publicKey);
    const exported = publicKey.export({ type: "spki", format: "der" });
    const derivedAddress = sha256(exported.toString("hex")).slice(-40);

    if (derivedAddress !== tx.from) {
      return false;
    }

    const unsigned: Parameters<typeof transactionMessage>[0] = {
      chainId: tx.chainId,
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      fee: tx.fee,
      nonce: tx.nonce,
    };

    if (tx.tokenId !== undefined) unsigned.tokenId = tx.tokenId;
    if (tx.tokenAction !== undefined) unsigned.tokenAction = tx.tokenAction;
    if (tx.tokenName !== undefined) unsigned.tokenName = tx.tokenName;
    if (tx.tokenSymbol !== undefined) unsigned.tokenSymbol = tx.tokenSymbol;
    if (tx.tokenDecimals !== undefined) unsigned.tokenDecimals = tx.tokenDecimals;
    if (tx.tokenSupply !== undefined) unsigned.tokenSupply = tx.tokenSupply;

    const verifier = createVerify("SHA256");
    verifier.update(transactionMessage(unsigned));
    verifier.end();

    return verifier.verify(publicKey, tx.signature, "base64");
  } catch {
    return false;
  }
}

export function verifyGenesisBlock(block: Block): boolean {
  if (block.index !== 0) {
    return false;
  }

  if (block.previousHash !== GENESIS_PREVIOUS_HASH) {
    return false;
  }

  if (block.miner !== GENESIS_ALLOCATION.address) {
    return false;
  }

  if (block.difficulty !== 0) {
    return false;
  }

  if (block.powNonce !== 0) {
    return false;
  }

  if (block.chainId !== CHAIN_ID_STRING) {
    return false;
  }

  if (block.timestamp !== GENESIS_TIMESTAMP) {
    return false;
  }

  if (block.transactions.length !== 1) {
    return false;
  }

  const tx = block.transactions[0];
  if (
    !tx ||
    tx.from !== GENESIS_SENDER ||
    tx.to !== GENESIS_ALLOCATION.address ||
    tx.amount !== GENESIS_ALLOCATION.amount ||
    tx.fee !== "0" ||
    tx.nonce !== 0 ||
    tx.signature !== GENESIS_SENDER ||
    tx.publicKey !== GENESIS_SENDER ||
    tx.chainId !== CHAIN_ID_STRING
  ) {
    return false;
  }

  const expectedHash = blockHash({
    index: block.index,
    timestamp: block.timestamp,
    transactions: block.transactions,
    previousHash: block.previousHash,
    miner: block.miner,
    difficulty: block.difficulty,
    powNonce: block.powNonce,
    chainId: block.chainId,
  });

  return block.hash === expectedHash;
}

export function verifyBlock(
  block: Block,
  previous?: Block,
  now = Date.now()
): boolean {
  if (
    !Number.isInteger(block.index) ||
    block.index < 0 ||
    !Number.isFinite(block.timestamp) ||
    !Array.isArray(block.transactions) ||
    typeof block.previousHash !== "string" ||
    typeof block.hash !== "string" ||
    typeof block.miner !== "string" ||
    typeof block.difficulty !== "number" ||
    typeof block.powNonce !== "number" ||
    typeof block.chainId !== "string"
  ) {
    return false;
  }

  if (block.chainId !== CHAIN_ID_STRING) {
    return false;
  }

  if (!validateAddress(block.miner)) {
    return false;
  }

  if (block.index > 0) {
    if (
      !Number.isInteger(block.difficulty) ||
      block.difficulty < 1
    ) {
      return false;
    }

    if (
      !Number.isInteger(block.powNonce) ||
      block.powNonce < 0
    ) {
      return false;
    }
  }

  if (previous) {
    if (block.index !== previous.index + 1) {
      return false;
    }
    if (block.previousHash !== previous.hash) {
      return false;
    }
  }

  const expectedHash = blockHash({
    index: block.index,
    timestamp: block.timestamp,
    transactions: block.transactions,
    previousHash: block.previousHash,
    miner: block.miner,
    difficulty: block.difficulty,
    powNonce: block.powNonce,
    chainId: block.chainId,
  });

  if (block.hash !== expectedHash) {
    return false;
  }

  if (block.index === 0) {
    return verifyGenesisBlock(block);
  }

  if (block.timestamp > now + MAX_FUTURE_BLOCK_TIME_MS) {
    return false;
  }

  if (previous) {
    if (block.timestamp < previous.timestamp) {
      return false;
    }

    // Prevent miners from moving consensus time arbitrarily far into
    // the future relative to the previous block. This also limits
    // timestamp manipulation of difficulty-adjustment windows.
    // Genesis is a fixed historical timestamp. The first live block
    // may legitimately be mined years after genesis, so the normal
    // inter-block drift limit starts from block 1 -> block 2.
    if (
      previous.index > 0 &&
      block.timestamp - previous.timestamp >
      MAX_BLOCK_DRIFT_MS
    ) {
      return false;
    }
  }

  if (!meetsDifficulty(block.hash, block.difficulty)) {
    return false;
  }

  if (block.transactions.length === 0) {
    return false;
  }

  let rewardCount = 0;

  for (const tx of block.transactions) {
    if (tx.from === MINING_REWARD_SENDER) {
      rewardCount++;

      const expectedReward = calculateBlockReward(block.index);

      if (
        tx.to !== block.miner ||
        !validateAddress(tx.to) ||
        tx.amount !== expectedReward.toString() ||
        tx.fee !== "0" ||
        tx.nonce !== 0 ||
        tx.signature !== MINING_REWARD_SENDER ||
        tx.publicKey !== MINING_REWARD_SENDER ||
        tx.chainId !== CHAIN_ID_STRING
      ) {
        return false;
      }

      continue;
    }

    if (tx.from === GENESIS_SENDER) {
      return false;
    }

    if (!verifyTransaction(tx)) {
      return false;
    }

    if (isTokenTransaction(tx) && !validateTokenId(tx.tokenId!)) {
      return false;
    }
  }

  if (rewardCount !== 1) {
    return false;
  }

  return true;
}

export function verifyBlockInChain(
  block: Block,
  chain: Chain,
  now = Date.now(),
  initialDifficulty = INITIAL_DIFFICULTY
): boolean {
  const previous = chain[block.index - 1];

  if (!verifyBlock(block, previous, now)) {
    return false;
  }

  if (block.index > 0) {
    if (block.difficulty < 0 || !meetsDifficulty(block.hash, block.difficulty)) {
      return false;
    }
  }

  return true;
}

export type ChainValidationResult = {
  valid: boolean;
  reason?: string;
  errorBlockIndex?: number;
};

export function validateChainWithDetails(
  candidate: Chain,
  now = Date.now(),
  initialDifficulty = INITIAL_DIFFICULTY
): ChainValidationResult {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    return { valid: false, reason: "Candidate chain is empty or not an array" };
  }

  const genesis = candidate[0];
  if (!genesis || !verifyGenesisBlock(genesis)) {
    return { valid: false, reason: "Genesis block failed verification", errorBlockIndex: 0 };
  }

  for (let i = 1; i < candidate.length; i++) {
    const block = candidate[i];
    if (!block) {
      return { valid: false, reason: `Block at index ${i} is missing`, errorBlockIndex: i };
    }

    const previous = candidate[i - 1];
    if (!verifyBlock(block, previous, now)) {
      return {
        valid: false,
        reason: `Block at height ${block.index} (hash ${block.hash.slice(0, 10)}) failed verifyBlock check`,
        errorBlockIndex: i,
      };
    }

    if (block.difficulty < 0 || !meetsDifficulty(block.hash, block.difficulty)) {
      return {
        valid: false,
        reason: `Block at height ${block.index} failed difficulty proof-of-work check`,
        errorBlockIndex: i,
      };
    }
  }

  if (!validateChainState(candidate)) {
    return { valid: false, reason: "Chain state (balances/nonces/tokens) validation failed" };
  }

  return { valid: true };
}

export function validChain(
  candidate: Chain,
  now = Date.now(),
  initialDifficulty = INITIAL_DIFFICULTY
): boolean {
  return validateChainWithDetails(candidate, now, initialDifficulty).valid;
}

export function compareChains(a: Chain, b: Chain): number {
  const workA = getChainWork(a);
  const workB = getChainWork(b);

  if (workA > workB) return 1;
  if (workA < workB) return -1;
  if (a.length > b.length) return 1;
  if (a.length < b.length) return -1;
  return 0;
}
