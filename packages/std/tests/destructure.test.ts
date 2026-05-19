/**
 * Tests for the Destructure typeclass (pattern matching extraction protocol).
 *
 * PEP-039 Wave 5 — exercises the canonical destructure shapes (tuple, object,
 * nested, sum-variant) using hand-written Destructure instances that mirror
 * what auto-derivation produces. Verifies extraction returns the payload on
 * match and `undefined` on failure, and that a `construct` dual round-trips.
 */

import { describe, it, expect } from "vitest";
import type { Destructure } from "../src/typeclasses/destructure.js";

// ---------------------------------------------------------------------------
// Tuple (positional) destructure shape
// ---------------------------------------------------------------------------

describe("Destructure: tuple (positional)", () => {
  // Pattern: a 3-tuple [a, b, c]
  type Tuple3<A, B, C> = readonly [A, B, C];

  const destructureTuple3: Destructure<
    "Tuple3",
    Tuple3<unknown, unknown, unknown>,
    readonly [unknown, unknown, unknown]
  > = {
    extract: (input) => {
      if (!Array.isArray(input) || input.length !== 3) return undefined;
      return [input[0], input[1], input[2]] as const;
    },
  };

  const constructTuple3 = <A, B, C>(a: A, b: B, c: C): Tuple3<A, B, C> => [a, b, c] as const;

  it("extracts the positional fields", () => {
    const result = destructureTuple3.extract([1, "x", true] as const);
    expect(result).toEqual([1, "x", true]);
  });

  it("returns undefined for non-array input", () => {
    expect(
      destructureTuple3.extract("not a tuple" as unknown as Tuple3<unknown, unknown, unknown>)
    ).toBeUndefined();
  });

  it("returns undefined for wrong-arity tuples", () => {
    expect(
      destructureTuple3.extract([1, 2] as unknown as Tuple3<unknown, unknown, unknown>)
    ).toBeUndefined();
    expect(
      destructureTuple3.extract([1, 2, 3, 4] as unknown as Tuple3<unknown, unknown, unknown>)
    ).toBeUndefined();
  });

  it("round-trips with construct: extract(construct(...args)) === args", () => {
    const t = constructTuple3(7, "hello", false);
    const out = destructureTuple3.extract(t);
    expect(out).toEqual([7, "hello", false]);
  });

  it("handles primitive payload values", () => {
    expect(destructureTuple3.extract([0, "", null] as const)).toEqual([0, "", null]);
  });
});

// ---------------------------------------------------------------------------
// Object (named-field) destructure shape
// ---------------------------------------------------------------------------

describe("Destructure: object (named fields)", () => {
  interface Point {
    readonly x: number;
    readonly y: number;
  }

  const destructurePoint: Destructure<"Point", Point, { x: number; y: number }> = {
    extract: (input) => {
      if (
        input == null ||
        typeof input !== "object" ||
        typeof (input as Point).x !== "number" ||
        typeof (input as Point).y !== "number"
      ) {
        return undefined;
      }
      return { x: (input as Point).x, y: (input as Point).y };
    },
  };

  const constructPoint = (x: number, y: number): Point => ({ x, y });

  it("extracts named fields", () => {
    const result = destructurePoint.extract({ x: 3, y: 4 });
    expect(result).toEqual({ x: 3, y: 4 });
  });

  it("returns undefined when fields are missing or wrong type", () => {
    expect(destructurePoint.extract({ x: 1 } as unknown as Point)).toBeUndefined();
    expect(destructurePoint.extract({ x: "a", y: 2 } as unknown as Point)).toBeUndefined();
    expect(destructurePoint.extract(null as unknown as Point)).toBeUndefined();
  });

  it("round-trips with construct", () => {
    const p = constructPoint(10, 20);
    const out = destructurePoint.extract(p);
    expect(out).toEqual({ x: 10, y: 20 });
  });

  it("preserves extracted field values", () => {
    expect(destructurePoint.extract({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(destructurePoint.extract({ x: -1, y: -2 })).toEqual({ x: -1, y: -2 });
  });
});

// ---------------------------------------------------------------------------
// Nested destructure (sum-variant + payload)
// ---------------------------------------------------------------------------

describe("Destructure: sum-variant (Option-style)", () => {
  type Option<A> = { _tag: "Some"; value: A } | { _tag: "None" };

  const Some = <A>(value: A): Option<A> => ({ _tag: "Some", value });
  const None: Option<never> = { _tag: "None" };

  const destructureSome: Destructure<"Some", Option<unknown>, unknown> = {
    extract: (input) => (input._tag === "Some" ? input.value : undefined),
  };

  const destructureNone: Destructure<"None", Option<unknown>, null> = {
    // For nullary variants, return a sentinel (null) on match, undefined otherwise.
    extract: (input) => (input._tag === "None" ? null : undefined),
  };

  it("extracts Some payload", () => {
    expect(destructureSome.extract(Some(42))).toBe(42);
    expect(destructureSome.extract(Some("hello"))).toBe("hello");
  });

  it("returns undefined on None when looking for Some", () => {
    expect(destructureSome.extract(None)).toBeUndefined();
  });

  it("extracts None as the unit sentinel", () => {
    expect(destructureNone.extract(None)).toBe(null);
  });

  it("returns undefined on Some when looking for None", () => {
    expect(destructureNone.extract(Some(1))).toBeUndefined();
  });

  it("Some(undefined) — payload-undefined is a true bug surface; document behavior", () => {
    // Note: a Some carrying undefined is indistinguishable from a None under
    // this protocol (both extract() calls would return undefined for Some).
    // This is a known limitation of `T | undefined` over `Option<T>`.
    expect(destructureSome.extract(Some(undefined))).toBeUndefined();
  });
});

describe("Destructure: nested patterns", () => {
  // Pattern: Pair of (Point, label-string)
  interface Pair<A, B> {
    readonly first: A;
    readonly second: B;
  }

  interface Point {
    readonly x: number;
    readonly y: number;
  }

  const destructureNested: Destructure<
    "PointLabel",
    Pair<Point, string>,
    { x: number; y: number; label: string }
  > = {
    extract: (input) => {
      if (
        input == null ||
        typeof input !== "object" ||
        typeof input.first !== "object" ||
        typeof input.first.x !== "number" ||
        typeof input.first.y !== "number" ||
        typeof input.second !== "string"
      ) {
        return undefined;
      }
      return { x: input.first.x, y: input.first.y, label: input.second };
    },
  };

  it("extracts nested fields", () => {
    const r = destructureNested.extract({ first: { x: 1, y: 2 }, second: "origin" });
    expect(r).toEqual({ x: 1, y: 2, label: "origin" });
  });

  it("returns undefined if any nested level fails", () => {
    expect(
      destructureNested.extract({ first: { x: 1 }, second: "x" } as unknown as Pair<Point, string>)
    ).toBeUndefined();
    expect(
      destructureNested.extract({ first: { x: 1, y: 2 }, second: 99 } as unknown as Pair<
        Point,
        string
      >)
    ).toBeUndefined();
  });

  it("round-trips through reconstruction", () => {
    const input = { first: { x: 3, y: 4 }, second: "p" };
    const extracted = destructureNested.extract(input)!;
    const reconstructed: Pair<Point, string> = {
      first: { x: extracted.x, y: extracted.y },
      second: extracted.label,
    };
    expect(reconstructed).toEqual(input);
  });
});
