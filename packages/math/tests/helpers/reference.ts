/**
 * Independent reference implementations for property-style tests.
 *
 * Written from the DEFINITION of each rounding mode on the exact rational
 * value n/d (floor/ceil + comparing the fractional part with 1/2), not from
 * truncating division like the code under test, so a shared mistake is
 * unlikely.
 */
import type { RoundingMode } from "../../src/types/rounding.js";

export const ALL_MODES: readonly RoundingMode[] = [
  "HALF_UP",
  "HALF_DOWN",
  "HALF_EVEN",
  "CEIL",
  "FLOOR",
  "TRUNC",
  "HALF_CEIL",
  "HALF_FLOOR",
];

function floorDiv(n: bigint, d: bigint): bigint {
  // d > 0
  const q = n / d;
  return n % d !== 0n && n < 0n ? q - 1n : q;
}

/** Round the exact rational n/d to an integer under `mode`. */
export function refRoundDiv(n: bigint, d: bigint, mode: RoundingMode): bigint {
  if (d === 0n) throw new Error("d = 0");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const lo = floorDiv(n, d);
  const frac2 = 2n * (n - lo * d); // 2 * fractional part * d, in [0, 2d)
  if (frac2 === 0n) return lo;
  const hi = lo + 1n;
  const positive = n > 0n;
  switch (mode) {
    case "FLOOR":
      return lo;
    case "CEIL":
      return hi;
    case "TRUNC":
      return positive ? lo : hi;
  }
  if (frac2 < d) return lo;
  if (frac2 > d) return hi;
  // exact tie
  switch (mode) {
    case "HALF_UP":
      return positive ? hi : lo;
    case "HALF_DOWN":
      return positive ? lo : hi;
    case "HALF_EVEN":
      return lo % 2n === 0n ? lo : hi;
    case "HALF_CEIL":
      return hi;
    case "HALF_FLOOR":
      return lo;
  }
  throw new Error(`unknown mode ${mode}`);
}

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random bigint in [-max, max]; biased toward small magnitudes to hit ties. */
export function randBig(rand: () => number, max: bigint): bigint {
  const small = rand() < 0.5;
  const span = small ? 40n : max;
  const digits = span.toString().length + 2;
  let s = "";
  for (let i = 0; i < digits; i++) s += Math.floor(rand() * 10);
  let v = BigInt(s) % (span + 1n);
  if (rand() < 0.5) v = -v;
  return v;
}
