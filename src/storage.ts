import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "node:fs";
import { dirname } from "node:path";
import type { PersistedState } from "./types.js";

export function loadState(dataFile: string): PersistedState | null {
  if (!existsSync(dataFile)) {
    return null;
  }

  const raw = readFileSync(dataFile, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Corrupted blockchain data in ${dataFile}: invalid JSON`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Corrupted blockchain data in ${dataFile}: not an object`);
  }

  const state = parsed as Partial<PersistedState>;

  if (!Array.isArray(state.chain)) {
    throw new Error(
      `Corrupted blockchain data in ${dataFile}: missing chain array`
    );
  }

  return {
    chain: state.chain,
    mempool: Array.isArray(state.mempool) ? state.mempool : [],
    peers: Array.isArray(state.peers) ? state.peers : [],
  };
}

export function saveState(dataFile: string, state: PersistedState): void {
  const tempFile = `${dataFile}.tmp`;
  const dir = dirname(dataFile);

  mkdirSync(dir, { recursive: true });
  writeFileSync(tempFile, JSON.stringify(state, null, 2));
  renameSync(tempFile, dataFile);
}
