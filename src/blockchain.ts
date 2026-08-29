import type { Block, Chain, Transaction } from "./types.js";
import {
  GENESIS_ALLOCATION,
  GENESIS_SENDER,
  GENESIS_TIMESTAMP,
  GENESIS_PREVIOUS_HASH,
  MINING_REWARD_SENDER,
  CHAIN_ID_STRING,
} from "./types.js";
import {
  blockHash,
  calculateBlockReward,
  calculateExpectedDifficulty,
  mineBlockHeader,
  getChainWork,
} from "./crypto.js";
import { validChain, compareChains } from "./validation.js";
import {
  getBalance,
  getNonce,
  calculateBalances,
  formatBalances,
} from "./state.js";
import { Mempool } from "./mempool.js";
import { loadState, saveState } from "./storage.js";
import type { NodeConfig } from "./config.js";

export function createGenesisBlock(): Block {
  const transactions: Transaction[] = [
    {
      from: GENESIS_SENDER,
      to: GENESIS_ALLOCATION.address,
      amount: GENESIS_ALLOCATION.amount,
      fee: "0",
      nonce: 0,
      signature: GENESIS_SENDER,
      publicKey: GENESIS_SENDER,
      chainId: CHAIN_ID_STRING,
    },
  ];

  const blockWithoutHash = {
    index: 0,
    timestamp: GENESIS_TIMESTAMP,
    transactions,
    previousHash: GENESIS_PREVIOUS_HASH,
    miner: GENESIS_ALLOCATION.address,
    difficulty: 0,
    powNonce: 0,
    chainId: CHAIN_ID_STRING,
  };

  return {
    ...blockWithoutHash,
    hash: blockHash(blockWithoutHash),
  };
}

export class Blockchain {
  private chain: Chain;
  readonly mempool: Mempool;
  private peers: Set<string>;
  private operationInProgress = false;
  private readonly config: NodeConfig;

  constructor(config: NodeConfig) {
    this.config = config;
    this.mempool = new Mempool();
    this.peers = new Set(config.peerUrls);

    const persisted = loadState(config.dataFile);
    if (persisted && persisted.chain.length > 0) {
      if (!validChain(persisted.chain, Date.now(), config.initialDifficulty)) {
        throw new Error("Stored blockchain failed validation");
      }
      this.chain = persisted.chain;
      this.mempool.load(persisted.mempool);
      this.mempool.sanitize(this.chain);
      for (const peer of persisted.peers) {
        this.peers.add(peer);
      }
    } else {
      this.chain = [createGenesisBlock()];
      this.persist();
    }
  }

  getChain(): Chain {
    return [...this.chain];
  }

  getLatestBlock(): Block {
    const block = this.chain[this.chain.length - 1];
    if (!block) {
      throw new Error("Blockchain is empty");
    }
    return block;
  }

  getGenesisHash(): string {
    return this.chain[0]?.hash ?? "";
  }

  getInitialDifficulty(): number {
    return this.config.initialDifficulty;
  }

  getBlock(height: number): Block | undefined {
    return this.chain[height];
  }

  getPeers(): string[] {
    return [...this.peers];
  }

  addPeer(peerUrl: string): void {
    if (!peerUrl.startsWith("http://") && !peerUrl.startsWith("https://")) {
      throw new Error("Peer URL must be http or https");
    }
    this.peers.add(peerUrl.replace(/\/$/, ""));
    this.persist();
  }

  getBalances(): Record<string, string> {
    return formatBalances(calculateBalances(this.chain));
  }

  getBalance(address: string): bigint {
    return getBalance(this.chain, address);
  }

  getNonce(address: string): number {
    return getNonce(this.chain, address);
  }

  getChainWork(): bigint {
    return getChainWork(this.chain);
  }

  addTransaction(tx: Transaction): void {
    return this.withLock(() => {
      this.mempool.add(tx, this.chain);
      this.persist();
    });
  }

  mineBlock(miner: string): Block {
    return this.withLock(() => {
      const previous = this.getLatestBlock();
      const blockHeight = previous.index + 1;
      const reward = calculateBlockReward(blockHeight);
      const difficulty = calculateExpectedDifficulty(
        this.chain,
        blockHeight,
        this.config.initialDifficulty,
        this.config.difficultyAdjustmentInterval,
        this.config.targetBlockTimeMs
      );

      const pendingTxs = this.mempool.selectForBlock(this.chain);

      const rewardTx: Transaction = {
        from: MINING_REWARD_SENDER,
        to: miner,
        amount: reward.toString(),
        fee: "0",
        nonce: 0,
        signature: MINING_REWARD_SENDER,
        publicKey: MINING_REWARD_SENDER,
        chainId: CHAIN_ID_STRING,
      };

      const blockWithoutHash: Omit<Block, "hash"> = {
        index: blockHeight,
        timestamp: Date.now(),
        transactions: [...pendingTxs, rewardTx],
        previousHash: previous.hash,
        miner,
        difficulty,
        powNonce: 0,
        chainId: CHAIN_ID_STRING,
      };

      const { hash, powNonce } = mineBlockHeader(blockWithoutHash);
      const block: Block = { ...blockWithoutHash, hash, powNonce };

      if (
        !validChain(
          [...this.chain, block],
          Date.now(),
          this.config.initialDifficulty
        )
      ) {
        throw new Error("Mined block failed validation");
      }

      this.chain.push(block);
      this.mempool.removeMany(pendingTxs);
      this.persist();

      return block;
    });
  }

  replaceChain(candidate: Chain): boolean {
    return this.withLock(() => {
      if (!validChain(candidate, Date.now(), this.config.initialDifficulty)) {
        throw new Error("Candidate chain failed validation");
      }

      if (compareChains(candidate, this.chain) <= 0) {
        return false;
      }

      this.chain = candidate;
      this.mempool.clear();
      this.persist();
      return true;
    });
  }

  tryAddBlock(block: Block): boolean {
    return this.withLock(() => {
      if (block.index !== this.chain.length) {
        return false;
      }

      const candidate = [...this.chain, block];
      if (!validChain(candidate, Date.now(), this.config.initialDifficulty)) {
        return false;
      }

      this.chain.push(block);
      this.mempool.removeMany(block.transactions);
      this.persist();
      return true;
    });
  }

  private persist(): void {
    saveState(this.config.dataFile, {
      chain: this.chain,
      mempool: this.mempool.list(),
      peers: this.getPeers(),
    });
  }

  private withLock<T>(fn: () => T): T {
    if (this.operationInProgress) {
      throw new Error("Operation in progress, please try again");
    }
    this.operationInProgress = true;
    try {
      return fn();
    } finally {
      this.operationInProgress = false;
    }
  }
}
