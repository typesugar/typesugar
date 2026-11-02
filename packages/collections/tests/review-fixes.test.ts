/**
 * Deep review 1.0, finding #18: HashSet/HashMap iteration while deleting,
 * and NaN keys.
 */
import { describe, it, expect } from "vitest";
import { HashSet } from "../src/hash-set.js";
import { HashMap } from "../src/hash-map.js";
import { eqNumber, hashNumber, type Eq, type Hash } from "@typesugar/std";

// Everything collides into one bucket, so iteration and delete share it.
const eqN: Eq<number> = { equals: (a, b) => a === b, notEquals: (a, b) => a !== b };
const oneBucket: Hash<number> = { hash: () => 0 };

describe("HashSet: delete during iteration (#18)", () => {
  it("visits every remaining entry when the current one is deleted", () => {
    const s = new HashSet(eqN, oneBucket);
    for (const n of [1, 2, 3, 4]) s.add(n);
    const seen: number[] = [];
    for (const k of s) {
      seen.push(k);
      s.delete(k);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(s.size).toBe(0);
  });

  it("does not visit an entry deleted before it is reached", () => {
    const s = new HashSet(eqN, oneBucket);
    for (const n of [1, 2, 3]) s.add(n);
    const seen: number[] = [];
    for (const k of s) {
      seen.push(k);
      if (k === 1) s.delete(2);
    }
    expect(seen).toEqual([1, 3]);
  });
});

describe("HashMap: delete during iteration (#18)", () => {
  it("visits every remaining entry when the current one is deleted", () => {
    const m = new HashMap<number, string>(eqN, oneBucket);
    for (const n of [1, 2, 3, 4]) m.set(n, String(n));
    const seen: number[] = [];
    for (const [k] of m) {
      seen.push(k);
      m.delete(k);
    }
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(m.size).toBe(0);
  });

  it("keys()/values() also survive deletion", () => {
    const m = new HashMap<number, string>(eqN, oneBucket);
    for (const n of [1, 2, 3]) m.set(n, String(n));
    const keys: number[] = [];
    for (const k of m.keys()) {
      keys.push(k);
      m.delete(k);
    }
    expect(keys).toEqual([1, 2, 3]);
  });
});

describe("NaN keys behave like native Set/Map (SameValueZero) (#18)", () => {
  it("HashSet<number>: NaN added twice is one element and is found", () => {
    const s = new HashSet(eqNumber, hashNumber);
    s.add(NaN).add(NaN);
    expect(s.size).toBe(1);
    expect(s.has(NaN)).toBe(true);
    expect(s.delete(NaN)).toBe(true);
    expect(s.size).toBe(0);
  });

  it("HashMap<number>: NaN key can be set, read and overwritten", () => {
    const m = new HashMap<number, string>(eqNumber, hashNumber);
    m.set(NaN, "a").set(NaN, "b");
    expect(m.size).toBe(1);
    expect(m.get(NaN)).toBe("b");
  });

  it("0 and -0 are the same key", () => {
    const s = new HashSet(eqNumber, hashNumber);
    s.add(0).add(-0);
    expect(s.size).toBe(1);
  });
});

describe("std hashNumber spreads values (#18)", () => {
  it("does not collapse fractions, NaN and infinities to one hash", () => {
    const hs = new Set([0.1, 0.2, 0.5, -0.5, NaN, Infinity, -Infinity, 0].map(hashNumber.hash));
    expect(hs.size).toBe(8);
  });

  it("is consistent with eqNumber for 0/-0", () => {
    expect(hashNumber.hash(0)).toBe(hashNumber.hash(-0));
  });
});
