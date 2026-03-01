import { describe, it, expect } from "vitest";
import { HashMap } from "../src/hash-map.js";
import { eqString, hashString, type Eq, type Hash } from "@typesugar/std";

describe("HashMap", () => {
  describe("with string keys", () => {
    function mkMap(): HashMap<string, number> {
      return new HashMap(eqString, hashString);
    }

    it("starts empty", () => {
      const m = mkMap();
      expect(m.size).toBe(0);
      expect(m.has("a")).toBe(false);
      expect(m.get("a")).toBeUndefined();
    });

    it("set and get", () => {
      const m = mkMap();
      m.set("a", 1);
      m.set("b", 2);
      expect(m.get("a")).toBe(1);
      expect(m.get("b")).toBe(2);
      expect(m.get("c")).toBeUndefined();
      expect(m.size).toBe(2);
    });

    it("set overwrites existing key", () => {
      const m = mkMap();
      m.set("a", 1);
      m.set("a", 42);
      expect(m.get("a")).toBe(42);
      expect(m.size).toBe(1);
    });

    it("has", () => {
      const m = mkMap();
      m.set("a", 1);
      expect(m.has("a")).toBe(true);
      expect(m.has("b")).toBe(false);
    });

    it("delete", () => {
      const m = mkMap();
      m.set("a", 1);
      m.set("b", 2);
      expect(m.delete("a")).toBe(true);
      expect(m.delete("a")).toBe(false);
      expect(m.has("a")).toBe(false);
      expect(m.get("a")).toBeUndefined();
      expect(m.size).toBe(1);
    });

    it("clear", () => {
      const m = mkMap();
      m.set("a", 1);
      m.set("b", 2);
      m.clear();
      expect(m.size).toBe(0);
      expect(m.has("a")).toBe(false);
    });

    it("entries iteration", () => {
      const m = mkMap();
      m.set("a", 1);
      m.set("b", 2);
      const entries = new Map<string, number>();
      for (const [k, v] of m) entries.set(k, v);
      expect(entries.get("a")).toBe(1);
      expect(entries.get("b")).toBe(2);
    });

    it("keys and values", () => {
      const m = mkMap();
      m.set("x", 10);
      m.set("y", 20);
      const keys = [...m.keys()].sort();
      const values = [...m.values()].sort();
      expect(keys).toEqual(["x", "y"]);
      expect(values).toEqual([10, 20]);
    });

    it("getOrElse", () => {
      const m = mkMap();
      m.set("a", 1);
      expect(m.getOrElse("a", 99)).toBe(1);
      expect(m.getOrElse("missing", 99)).toBe(99);
    });
  });

  describe("with custom object keys (hash collisions)", () => {
    interface Pair {
      first: string;
      second: string;
    }

    const eqPair: Eq<Pair> = {
      equals: (a, b) => a.first === b.first && a.second === b.second,
      notEquals: (a, b) => a.first !== b.first || a.second !== b.second,
    };

    // Weak hash to force collisions
    const hashPair: Hash<Pair> = {
      hash: (p) => p.first.length + p.second.length,
    };

    it("handles collisions", () => {
      const m = new HashMap<Pair, string>(eqPair, hashPair);
      const k1 = { first: "ab", second: "cd" }; // hash = 4
      const k2 = { first: "ef", second: "gh" }; // hash = 4 (collision!)

      m.set(k1, "val1");
      m.set(k2, "val2");

      expect(m.size).toBe(2);
      expect(m.get({ first: "ab", second: "cd" })).toBe("val1");
      expect(m.get({ first: "ef", second: "gh" })).toBe("val2");
    });

    it("overwrites with collisions", () => {
      const m = new HashMap<Pair, string>(eqPair, hashPair);
      m.set({ first: "ab", second: "cd" }, "old");
      m.set({ first: "ab", second: "cd" }, "new");
      expect(m.size).toBe(1);
      expect(m.get({ first: "ab", second: "cd" })).toBe("new");
    });
  });
});
