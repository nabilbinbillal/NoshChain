import { WEI_PER_NOSH } from "./types.js";

/** Format wei as a decimal NOSH string without floating-point conversion. */
export function formatNosh(wei: bigint): string {
  const whole = wei / WEI_PER_NOSH;
  const fraction = wei % WEI_PER_NOSH;

  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionStr = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole}.${fractionStr}`;
}
