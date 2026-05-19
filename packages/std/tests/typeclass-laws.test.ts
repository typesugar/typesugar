/**
 * Algebraic law tests for standard typeclass instances.
 *
 * PEP-039 Wave 5 — verifies that the bundled instances of Eq, Ord, Semigroup,
 * and Monoid satisfy their documented laws for primitive types.
 */

import { describe, it, expect } from "vitest";
import {
  // Eq
  eqNumber,
  eqString,
  eqBoolean,
  eqArray,
  // Ord
  ordNumber,
  ordString,
  ordBoolean,
  ordArray,
  // Semigroup
  semigroupNumber,
  semigroupString,
  semigroupBigInt,
  semigroupArray,
  // Monoid
  monoidNumber,
  monoidString,
  monoidBigInt,
  monoidArray,
} from "../src/typeclasses/index.js";

describe("Eq laws", () => {
  describe("eqNumber", () => {
    it("reflexivity: equals(x, x) === true", () => {
      for (const x of [0, 1, -1, 42, 3.14, Number.MAX_SAFE_INTEGER]) {
        expect(eqNumber.equals(x, x)).toBe(true);
      }
    });

    it("symmetry: equals(x, y) === equals(y, x)", () => {
      const pairs: [number, number][] = [
        [1, 1],
        [1, 2],
        [3.14, 2.71],
        [0, -0],
      ];
      for (const [x, y] of pairs) {
        expect(eqNumber.equals(x, y)).toBe(eqNumber.equals(y, x));
      }
    });

    it("transitivity: equals(x, y) && equals(y, z) => equals(x, z)", () => {
      const x = 42;
      const y = 42;
      const z = 42;
      expect(eqNumber.equals(x, y)).toBe(true);
      expect(eqNumber.equals(y, z)).toBe(true);
      expect(eqNumber.equals(x, z)).toBe(true);
    });

    it("notEquals is the negation of equals", () => {
      expect(eqNumber.notEquals(1, 1)).toBe(false);
      expect(eqNumber.notEquals(1, 2)).toBe(true);
    });
  });

  describe("eqString", () => {
    it("reflexivity", () => {
      for (const x of ["", "hello", "world", "a"]) {
        expect(eqString.equals(x, x)).toBe(true);
      }
    });

    it("symmetry", () => {
      const pairs: [string, string][] = [
        ["a", "a"],
        ["a", "b"],
        ["hello", "hello"],
        ["", "x"],
      ];
      for (const [x, y] of pairs) {
        expect(eqString.equals(x, y)).toBe(eqString.equals(y, x));
      }
    });

    it("transitivity", () => {
      const x = "hello";
      const y = "hello";
      const z = "hello";
      expect(eqString.equals(x, y) && eqString.equals(y, z)).toBe(true);
      expect(eqString.equals(x, z)).toBe(true);
    });
  });

  describe("eqBoolean", () => {
    it("reflexivity", () => {
      expect(eqBoolean.equals(true, true)).toBe(true);
      expect(eqBoolean.equals(false, false)).toBe(true);
    });

    it("symmetry", () => {
      expect(eqBoolean.equals(true, false)).toBe(eqBoolean.equals(false, true));
      expect(eqBoolean.equals(true, true)).toBe(eqBoolean.equals(true, true));
    });

    it("transitivity", () => {
      expect(eqBoolean.equals(true, true) && eqBoolean.equals(true, true)).toBe(true);
      expect(eqBoolean.equals(true, true)).toBe(true);
    });
  });

  describe("eqArray<number>", () => {
    const eqArrNum = eqArray(eqNumber);

    it("reflexivity", () => {
      for (const xs of [[], [1], [1, 2, 3], [-1, 0, 1]]) {
        expect(eqArrNum.equals(xs, xs)).toBe(true);
      }
    });

    it("symmetry", () => {
      const cases: [number[], number[]][] = [
        [
          [1, 2, 3],
          [1, 2, 3],
        ],
        [
          [1, 2],
          [1, 2, 3],
        ],
        [[], []],
        [[1], [2]],
      ];
      for (const [x, y] of cases) {
        expect(eqArrNum.equals(x, y)).toBe(eqArrNum.equals(y, x));
      }
    });

    it("transitivity", () => {
      const x = [1, 2, 3];
      const y = [1, 2, 3];
      const z = [1, 2, 3];
      expect(eqArrNum.equals(x, y) && eqArrNum.equals(y, z)).toBe(true);
      expect(eqArrNum.equals(x, z)).toBe(true);
    });

    it("differing length is unequal", () => {
      expect(eqArrNum.equals([1, 2], [1, 2, 3])).toBe(false);
      expect(eqArrNum.notEquals([1, 2], [1, 2, 3])).toBe(true);
    });
  });
});

describe("Ord laws", () => {
  describe("ordNumber", () => {
    it("reflexivity: compare(x, x) === 0", () => {
      for (const x of [0, 1, -1, 42, 3.14]) {
        expect(ordNumber.compare(x, x)).toBe(0);
      }
    });

    it("antisymmetry: compare(x, y) <= 0 && compare(y, x) <= 0 => equals", () => {
      const x = 5;
      const y = 5;
      expect(ordNumber.compare(x, y) <= 0).toBe(true);
      expect(ordNumber.compare(y, x) <= 0).toBe(true);
      expect(ordNumber.equals(x, y)).toBe(true);
    });

    it("transitivity: a < b && b < c => a < c", () => {
      const a = 1,
        b = 2,
        c = 3;
      expect(ordNumber.compare(a, b)).toBeLessThanOrEqual(0);
      expect(ordNumber.compare(b, c)).toBeLessThanOrEqual(0);
      expect(ordNumber.compare(a, c)).toBeLessThanOrEqual(0);
    });

    it("compatibility with Eq: compare(x, y) === 0 <=> equals(x, y)", () => {
      const pairs: [number, number][] = [
        [1, 1],
        [1, 2],
        [3.14, 3.14],
        [0, -0],
      ];
      for (const [x, y] of pairs) {
        expect(ordNumber.compare(x, y) === 0).toBe(ordNumber.equals(x, y));
      }
    });

    it("comparison operators are consistent with compare", () => {
      expect(ordNumber.lessThan(1, 2)).toBe(true);
      expect(ordNumber.lessThanOrEqual(1, 1)).toBe(true);
      expect(ordNumber.greaterThan(2, 1)).toBe(true);
      expect(ordNumber.greaterThanOrEqual(2, 2)).toBe(true);
    });
  });

  describe("ordString", () => {
    it("reflexivity", () => {
      for (const x of ["", "a", "hello"]) {
        expect(ordString.compare(x, x)).toBe(0);
      }
    });

    it("antisymmetry", () => {
      const x = "hello";
      const y = "hello";
      expect(ordString.compare(x, y) <= 0 && ordString.compare(y, x) <= 0).toBe(true);
      expect(ordString.equals(x, y)).toBe(true);
    });

    it("transitivity", () => {
      const a = "apple",
        b = "banana",
        c = "cherry";
      expect(ordString.compare(a, b)).toBeLessThan(0);
      expect(ordString.compare(b, c)).toBeLessThan(0);
      expect(ordString.compare(a, c)).toBeLessThan(0);
    });
  });

  describe("ordBoolean", () => {
    it("reflexivity", () => {
      expect(ordBoolean.compare(true, true)).toBe(0);
      expect(ordBoolean.compare(false, false)).toBe(0);
    });

    it("false < true (Haskell convention)", () => {
      expect(ordBoolean.compare(false, true)).toBeLessThan(0);
      expect(ordBoolean.compare(true, false)).toBeGreaterThan(0);
    });
  });

  describe("ordArray<number>", () => {
    const o = ordArray(ordNumber);

    it("reflexivity", () => {
      for (const xs of [[], [1], [1, 2, 3]]) {
        expect(o.compare(xs, xs)).toBe(0);
      }
    });

    it("lexicographic ordering: shorter prefix < longer", () => {
      expect(o.compare([1, 2], [1, 2, 3])).toBeLessThan(0);
      expect(o.compare([1, 2, 3], [1, 2])).toBeGreaterThan(0);
    });

    it("first differing element determines order", () => {
      expect(o.compare([1, 2, 3], [1, 3, 0])).toBeLessThan(0);
      expect(o.compare([2], [1, 9])).toBeGreaterThan(0);
    });
  });
});

describe("Semigroup laws (associativity)", () => {
  it("semigroupNumber: (a + b) + c === a + (b + c)", () => {
    const cases: [number, number, number][] = [
      [1, 2, 3],
      [-1, 5, 10],
      [0, 0, 0],
      [100, 200, 300],
    ];
    for (const [a, b, c] of cases) {
      const left = semigroupNumber.combine(semigroupNumber.combine(a, b), c);
      const right = semigroupNumber.combine(a, semigroupNumber.combine(b, c));
      expect(left).toBe(right);
    }
  });

  it("semigroupString: concatenation is associative", () => {
    const cases: [string, string, string][] = [
      ["a", "b", "c"],
      ["hello", " ", "world"],
      ["", "x", ""],
    ];
    for (const [a, b, c] of cases) {
      const left = semigroupString.combine(semigroupString.combine(a, b), c);
      const right = semigroupString.combine(a, semigroupString.combine(b, c));
      expect(left).toBe(right);
    }
  });

  it("semigroupBigInt: addition is associative", () => {
    const cases: [bigint, bigint, bigint][] = [
      [1n, 2n, 3n],
      [-100n, 50n, 25n],
      [0n, 0n, 0n],
    ];
    for (const [a, b, c] of cases) {
      const left = semigroupBigInt.combine(semigroupBigInt.combine(a, b), c);
      const right = semigroupBigInt.combine(a, semigroupBigInt.combine(b, c));
      expect(left).toBe(right);
    }
  });

  it("semigroupArray<number>: concat is associative", () => {
    const s = semigroupArray<number>();
    const a = [1, 2];
    const b = [3];
    const c = [4, 5];
    expect(s.combine(s.combine(a, b), c)).toEqual(s.combine(a, s.combine(b, c)));
    expect(s.combine(a, b)).toEqual([1, 2, 3]);
  });
});

describe("Monoid laws", () => {
  describe("monoidNumber (additive, empty = 0)", () => {
    it("left identity: combine(empty, x) === x", () => {
      for (const x of [0, 1, -1, 42, 3.14]) {
        expect(monoidNumber.combine(monoidNumber.empty(), x)).toBe(x);
      }
    });

    it("right identity: combine(x, empty) === x", () => {
      for (const x of [0, 1, -1, 42, 3.14]) {
        expect(monoidNumber.combine(x, monoidNumber.empty())).toBe(x);
      }
    });

    it("associativity (inherited from Semigroup)", () => {
      const a = 1,
        b = 2,
        c = 3;
      expect(monoidNumber.combine(monoidNumber.combine(a, b), c)).toBe(
        monoidNumber.combine(a, monoidNumber.combine(b, c))
      );
    });
  });

  describe("monoidString (empty = '')", () => {
    it("left identity", () => {
      for (const x of ["", "hello", "world"]) {
        expect(monoidString.combine(monoidString.empty(), x)).toBe(x);
      }
    });

    it("right identity", () => {
      for (const x of ["", "hello", "world"]) {
        expect(monoidString.combine(x, monoidString.empty())).toBe(x);
      }
    });

    it("associativity", () => {
      const a = "foo",
        b = "bar",
        c = "baz";
      expect(monoidString.combine(monoidString.combine(a, b), c)).toBe(
        monoidString.combine(a, monoidString.combine(b, c))
      );
    });
  });

  describe("monoidBigInt (empty = 0n)", () => {
    it("left identity", () => {
      for (const x of [0n, 1n, -1n, 42n]) {
        expect(monoidBigInt.combine(monoidBigInt.empty(), x)).toBe(x);
      }
    });

    it("right identity", () => {
      for (const x of [0n, 1n, -1n, 42n]) {
        expect(monoidBigInt.combine(x, monoidBigInt.empty())).toBe(x);
      }
    });
  });

  describe("monoidArray<number> (empty = [])", () => {
    const m = monoidArray<number>();

    it("left identity", () => {
      for (const xs of [[], [1], [1, 2, 3]]) {
        expect(m.combine(m.empty(), xs)).toEqual(xs);
      }
    });

    it("right identity", () => {
      for (const xs of [[], [1], [1, 2, 3]]) {
        expect(m.combine(xs, m.empty())).toEqual(xs);
      }
    });

    it("associativity", () => {
      const a = [1, 2];
      const b = [3];
      const c = [4, 5];
      expect(m.combine(m.combine(a, b), c)).toEqual(m.combine(a, m.combine(b, c)));
    });

    it("empty() returns a fresh array each call", () => {
      const e1 = m.empty();
      const e2 = m.empty();
      expect(e1).not.toBe(e2);
      expect(e1).toEqual([]);
    });
  });
});
