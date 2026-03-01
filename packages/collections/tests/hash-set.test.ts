import { describe, it, expect } from "vitest";
import { HashSet } from "../src/hash-set.js";
import { eqNumber, eqString, hashNumber, hashString, type Eq, type Hash } from "@typesugar/std";

describe("HashSet", () => {
  describe("with primitive keys (string)", () => {
    function mkSet(): HashSet<string> {
      return new HashSet(eqString, hashString);
    }

    it("starts empty", () => {
      const s = mkSet();
      expect(s.size).toBe(0);
      expect(s.has("a")).toBe(false);
    });

    it("add and has", () => {
      const s = mkSet();
      s.add("a");
      s.add("b");
      expect(s.has("a")).toBe(true);
      expect(s.has("b")).toBe(true);
      expect(s.has("c")).toBe(false);
      expect(s.size).toBe(2);
    });

    it("add is idempotent", () => {
      const s = mkSet();
      s.add("a");
      s.add("a");
      s.add("a");
      expect(s.size).toBe(1);
    });

    it("delete", () => {
      const s = mkSet();
      s.add("a");
      s.add("b");
      expect(s.delete("a")).toBe(true);
      expect(s.delete("a")).toBe(false);
      expect(s.has("a")).toBe(false);
      expect(s.has("b")).toBe(true);
      expect(s.size).toBe(1);
    });

    it("clear", () => {
      const s = mkSet();
      s.add("a");
      s.add("b");
      s.clear();
      expect(s.size).toBe(0);
      expect(s.has("a")).toBe(false);
    });

    it("iteration", () => {
      const s = mkSet();
      s.add("a");
      s.add("b");
      s.add("c");
      const collected = new Set<string>();
      for (const k of s) collected.add(k);
      expect(collected).toEqual(new Set(["a", "b", "c"]));
    });

    it("toArray", () => {
      const s = mkSet();
      s.add("x");
      s.add("y");
      const arr = s.toArray();
      expect(arr.sort()).toEqual(["x", "y"]);
    });
  });

  describe("with number keys", () => {
    function mkSet(): HashSet<number> {
      return new HashSet(eqNumber, hashNumber);
    }

    it("basic operations", () => {
      const s = mkSet();
      s.add(1);
      s.add(2);
      s.add(3);
      expect(s.size).toBe(3);
      expect(s.has(2)).toBe(true);
      expect(s.has(4)).toBe(false);
      s.delete(2);
      expect(s.has(2)).toBe(false);
      expect(s.size).toBe(2);
    });
  });

  describe("with custom object keys (hash collisions)", () => {
    interface Point {
      x: number;
      y: number;
    }

    const eqPoint: Eq<Point> = {
      equals: (a, b) => a.x === b.x && a.y === b.y,
      notEquals: (a, b) => a.x !== b.x || a.y !== b.y,
    };

    // Deliberately weak hash to force collisions
    const hashPoint: Hash<Point> = {
      hash: (p) => (p.x + p.y) | 0,
    };

    it("handles collisions correctly", () => {
      const s = new HashSet(eqPoint, hashPoint);
      const p1 = { x: 1, y: 2 }; // hash = 3
      const p2 = { x: 2, y: 1 }; // hash = 3 (collision!)
      const p3 = { x: 0, y: 3 }; // hash = 3 (collision!)

      s.add(p1);
      s.add(p2);
      s.add(p3);

      expect(s.size).toBe(3);
      expect(s.has({ x: 1, y: 2 })).toBe(true);
      expect(s.has({ x: 2, y: 1 })).toBe(true);
      expect(s.has({ x: 0, y: 3 })).toBe(true);
      expect(s.has({ x: 9, y: 9 })).toBe(false);
    });

    it("delete with collisions", () => {
      const s = new HashSet(eqPoint, hashPoint);
      s.add({ x: 1, y: 2 });
      s.add({ x: 2, y: 1 });

      expect(s.delete({ x: 1, y: 2 })).toBe(true);
      expect(s.size).toBe(1);
      expect(s.has({ x: 1, y: 2 })).toBe(false);
      expect(s.has({ x: 2, y: 1 })).toBe(true);
    });

    it("duplicate detection with collisions", () => {
      const s = new HashSet(eqPoint, hashPoint);
      s.add({ x: 1, y: 2 });
      s.add({ x: 1, y: 2 }); // same point again
      expect(s.size).toBe(1);
    });
  });
});
