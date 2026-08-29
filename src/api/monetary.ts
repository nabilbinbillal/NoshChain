import type { Chain } from "../types.js";
import {
  HALVING_INTERVAL,
  INITIAL_SUPPLY,
  MIN_FEE,
  WEI_PER_NOSH,
} from "../types.js";
import {
  calculateBlockReward,
  calculateMaxSupply,
  calculateTotalMiningSupply,
  getChainWork,
} from "../crypto.js";
import {
  calculateIssuedSupply,
  calculateTotalSupply,
} from "../state.js";
import type { NodeConfig } from "../config.js";

export function blocksUntilNextHalving(nextBlockHeight: number): number {
  const nextHalvingHeight =
    (Math.floor(nextBlockHeight / HALVING_INTERVAL) + 1) * HALVING_INTERVAL;
  return nextHalvingHeight - nextBlockHeight;
}

export function getMonetaryInfo(chain: Chain, config: NodeConfig) {
  const nextBlockHeight = chain.length;
  const latest = chain[chain.length - 1];
  const halvingEra = Math.floor(nextBlockHeight / HALVING_INTERVAL);

  return {
    name: "Nosh",
    symbol: "NOSH",
    decimals: 18,
    smallestUnit: "wei",
    weiPerNosh: WEI_PER_NOSH.toString(),
    minFee: MIN_FEE.toString(),
    blockReward: calculateBlockReward(nextBlockHeight).toString(),
    halvingEra,
    blocksUntilNextHalving: blocksUntilNextHalving(nextBlockHeight),
    halvingInterval: HALVING_INTERVAL,
    currentDifficulty: latest?.difficulty ?? 0,
    genesisSupply: INITIAL_SUPPLY.toString(),
    issuedSupply: calculateIssuedSupply(chain).toString(),
    circulatingSupply: calculateTotalSupply(chain).toString(),
    totalMiningSupply: calculateTotalMiningSupply().toString(),
    maxSupply: calculateMaxSupply().toString(),
    targetBlockTimeSeconds: config.targetBlockTimeMs / 1000,
    initialDifficulty: config.initialDifficulty,
  };
}

export function getNetworkStats(chain: Chain) {
  const latest = chain[chain.length - 1];

  return {
    blocks: chain.length,
    chainWork: getChainWork(chain).toString(),
    latestBlockHeight: latest?.index ?? 0,
    latestBlockHash: latest?.hash ?? "",
    latestBlockTimestamp: latest?.timestamp ?? 0,
    averageBlockTimeSeconds: null as number | null,
  };
}
