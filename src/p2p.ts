import type { Blockchain } from "./blockchain.js";
import type { Block, Chain, Transaction } from "./types.js";
import { getChainWork } from "./crypto.js";
import { validChain, compareChains } from "./validation.js";

export type PeerChainResponse = {
  chain?: Chain;
  chainWork?: string;
  genesisHash?: string;
};

export type PeerInfo = {
  url: string;
  blocks: number;
  chainWork: string;
  genesisHash: string;
};

export class P2PNetwork {
  constructor(private readonly blockchain: Blockchain) {}

  getPeerUrls(): string[] {
    return this.blockchain.getPeers();
  }

  addPeer(url: string): void {
    this.blockchain.addPeer(url);
  }

  async fetchPeerChain(peerUrl: string): Promise<Chain> {
    const response = await fetch(`${peerUrl}/chain`);
    if (!response.ok) {
      throw new Error(`Peer ${peerUrl} returned ${response.status}`);
    }

    const data = (await response.json()) as PeerChainResponse;
    if (!data.chain || !Array.isArray(data.chain)) {
      throw new Error(`Invalid chain response from ${peerUrl}`);
    }

    return data.chain;
  }

  async fetchPeerInfo(peerUrl: string): Promise<PeerInfo> {
    const response = await fetch(`${peerUrl}/`);
    if (!response.ok) {
      throw new Error(`Peer ${peerUrl} returned ${response.status}`);
    }

    const data = (await response.json()) as {
      blocks?: number;
      chainWork?: string;
      genesisHash?: string;
    };

    return {
      url: peerUrl,
      blocks: data.blocks ?? 0,
      chainWork: data.chainWork ?? "0",
      genesisHash: data.genesisHash ?? "",
    };
  }

  async broadcastTransaction(tx: Transaction): Promise<void> {
    const peers = this.getPeerUrls();
    await Promise.allSettled(
      peers.map(async (peerUrl) => {
        await fetch(`${peerUrl}/transaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tx),
        });
      })
    );
  }

  async broadcastBlock(block: Block): Promise<void> {
    const peers = this.getPeerUrls();
    await Promise.allSettled(
      peers.map(async (peerUrl) => {
        await fetch(`${peerUrl}/blocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(block),
        });
      })
    );
  }

  async syncWithPeers(): Promise<{
    replaced: boolean;
    blocks: number;
    chainWork: string;
  }> {
    const peers = this.getPeerUrls();
    const localGenesis = this.blockchain.getGenesisHash();
    let bestChain: Chain | null = null;

    for (const peerUrl of peers) {
      try {
        const peerChain = await this.fetchPeerChain(peerUrl);

        if (peerChain[0]?.hash !== localGenesis) {
          continue;
        }

        if (
          !validChain(
            peerChain,
            Date.now(),
            this.blockchain.getInitialDifficulty()
          )
        ) {
          continue;
        }

        if (
          !bestChain ||
          compareChains(peerChain, bestChain) > 0
        ) {
          bestChain = peerChain;
        }
      } catch {
        continue;
      }
    }

    let replaced = false;
    if (bestChain) {
      replaced = this.blockchain.replaceChain(bestChain);
    }

    return {
      replaced,
      blocks: this.blockchain.getChain().length,
      chainWork: getChainWork(this.blockchain.getChain()).toString(),
    };
  }
}
