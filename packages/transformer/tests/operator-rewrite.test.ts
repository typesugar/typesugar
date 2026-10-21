/**
 * Integration tests for typeclass operator rewriting.
 *
 * Tests the source-based approach: @op JSDoc annotations on typeclass method signatures.
 *
 * Verifies that binary expressions like `a + b` get rewritten to
 * typeclass method calls (e.g., `numericPoint.add(a, b)`) when the
 * left operand's type has a matching instance.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import { config } from "@typesugar/core";

beforeEach(() => {
  config.set({ resolution: { mode: "automatic" } });
});

afterEach(() => {
  config.reset();
});

// ============================================================================
// Source-Based Approach: @op JSDoc annotations
// ============================================================================

describe("Source-based operator rewriting with @op annotations", () => {
  it("rewrites a + b using @op annotation on typeclass method", () => {
    const code = `
/** @typeclass */
interface Numeric<A> {
  /** @op + */ add(a: A, b: A): A;
  /** @op - */ sub(a: A, b: A): A;
  /** @op * */ mul(a: A, b: A): A;
}

interface Point { x: number; y: number; }

/** @impl Numeric<Point> */
const numericPoint: Numeric<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  mul: (a, b) => ({ x: a.x * b.x, y: a.y * b.y }),
};

declare const a: Point;
declare const b: Point;
const c = a + b;
    `.trim();

    const result = transformCode(code, { fileName: "op-source-add.ts" });
    // After operator rewrite + auto-inlining, the expression is fully expanded
    expect(result.code).not.toContain("a + b");
    // Should contain either inlined body or the instance call
    expect(result.code.includes("numericPoint.add") || result.code.includes("a.x + b.x")).toBe(
      true
    );
  });

  it("rewrites a === b using @op annotation for Eq", () => {
    const code = `
/** @typeclass */
interface Eq<A> {
  /** @op === */ equals(a: A, b: A): boolean;
  /** @op !== */ notEquals(a: A, b: A): boolean;
}

interface Point { x: number; y: number; }

/** @impl Eq<Point> */
const eqPoint: Eq<Point> = {
  equals: (a, b) => a.x === b.x && a.y === b.y,
  notEquals: (a, b) => a.x !== b.x || a.y !== b.y,
};

declare const a: Point;
declare const b: Point;
const c = a === b;
    `.trim();

    const result = transformCode(code, { fileName: "op-source-eq.ts" });
    expect(result.code).not.toContain("a === b");
    // Should contain either inlined body or the instance call
    expect(result.code.includes("eqPoint.equals") || result.code.includes("a.x === b.x")).toBe(
      true
    );
  });

  it("rewrites comparison operators using @op annotation for Ord", () => {
    const code = `
/** @typeclass */
interface Ord<A> {
  /** @op < */ lt(a: A, b: A): boolean;
  /** @op <= */ lte(a: A, b: A): boolean;
  /** @op > */ gt(a: A, b: A): boolean;
  /** @op >= */ gte(a: A, b: A): boolean;
}

interface Point { x: number; y: number; }

/** @impl Ord<Point> */
const ordPoint: Ord<Point> = {
  lt: (a, b) => a.x < b.x || (a.x === b.x && a.y < b.y),
  lte: (a, b) => a.x < b.x || (a.x === b.x && a.y <= b.y),
  gt: (a, b) => a.x > b.x || (a.x === b.x && a.y > b.y),
  gte: (a, b) => a.x > b.x || (a.x === b.x && a.y >= b.y),
};

declare const a: Point;
declare const b: Point;
const c = a < b;
    `.trim();

    const result = transformCode(code, { fileName: "op-source-ord.ts" });
    expect(result.code).not.toContain("a < b");
    // Should contain either inlined body or the instance call
    expect(result.code.includes("ordPoint.lt") || result.code.includes("a.x < b.x")).toBe(true);
  });

  it("leaves plain number + number alone (primitives are skipped)", () => {
    const code = `
/** @typeclass */
interface Numeric<A> {
  /** @op + */ add(a: A, b: A): A;
}

const a = 1;
const b = 2;
const c = a + b;
    `.trim();

    const result = transformCode(code, { fileName: "op-source-plain.ts" });
    // The expression "a + b" should be preserved (not rewritten to method call)
    expect(result.code).toContain("const c = a + b;");
  });

  it("does not rewrite operators for types without instances", () => {
    const code = `
/** @typeclass */
interface Numeric<A> {
  /** @op + */ add(a: A, b: A): A;
}

interface Vec3 { x: number; y: number; z: number; }
declare const a: Vec3;
declare const b: Vec3;
const c = a + b;
    `.trim();

    const result = transformCode(code, { fileName: "op-source-no-instance.ts" });
    // The expression "a + b" should be preserved (not rewritten to method call)
    expect(result.code).toContain("const c = a + b;");
  });

  it("reports ambiguity when two typeclasses provide same operator for a type", () => {
    const code = `
/** @typeclass */
interface Numeric<A> {
  /** @op + */ add(a: A, b: A): A;
}

/** @typeclass */
interface Semigroup<A> {
  /** @op + */ concat(a: A, b: A): A;
}

interface Point { x: number; y: number; }

/** @impl Numeric<Point> */
const numericPoint: Numeric<Point> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};

/** @impl Semigroup<Point> */
const semigroupPoint: Semigroup<Point> = {
  concat: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};

declare const a: Point;
declare const b: Point;
const c = a + b;
    `.trim();

    const result = transformCode(code, { fileName: "op-ambig.ts" });
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const ambiguityDiag = result.diagnostics.find(
      (d) => d.message.includes("Ambiguous") || d.message.includes("ambiguous")
    );
    expect(ambiguityDiag).toBeDefined();
  });
});

// ============================================================================
// Chained operators: an operand that is itself a rewritten operator
// ============================================================================

describe("Chained typeclass operators (a + b + c)", () => {
  // `a + b + c` parses as `(a + b) + c`. TypeScript types `a + b` on objects
  // as an error (any), so the outer `+` saw no instance and stayed native:
  // `numericV.add(a, b) + c`, string concatenation ("[object Object]...").
  // A method whose result is the typeclass's own type parameter
  // (`add(a: A, b: A): A`) gives its operator expression that type, so the
  // outer operator dispatches on it too (PEP-052 deferred item 6).
  const prelude = `
/** @typeclass */
export interface Num<A> {
  /** @op + */ add(a: A, b: A): A;
  /** @op * */ scale(a: A, k: number): A;
  /** @op < */ lt(a: A, b: A): boolean;
  /** @op === */ same(a: A, b: A): boolean;
}
export interface V { x: number }
/** @impl Num<V> */
export const numV: Num<V> = {
  add: (a, b) => ({ x: a.x + b.x }),
  scale: (a, k) => ({ x: a.x * k }),
  lt: (a, b) => a.x < b.x,
  same: (a, b) => a.x === b.x,
};
const a: V = { x: 1 }, b: V = { x: 2 }, c: V = { x: 3 };
`;

  function evaluate(code: string): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ts = require("typescript") as typeof import("typescript");
    const js = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    new Function("module", "exports", "require", js)(mod, mod.exports, () => ({}));
    return mod.exports;
  }

  it("rewrites every operator of a left-nested chain", () => {
    const code = `${prelude}
export const s = a + b + c;
export const four = a + b + c + a;
export const t = a + b < c;
export const u = a * 2 + b;
export const eq = a + b === c;
export const paren = (a + b) + c;
export const n = 1 + 2 + 3;
`;
    const result = transformCode(code, { fileName: "op-chain.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).not.toMatch(/\) \+ c|\) \+ a|\) < c|\) === c/);
    expect(result.code).toContain("n = 1 + 2 + 3");
    expect(evaluate(result.code)).toMatchObject({
      s: { x: 6 },
      four: { x: 7 },
      t: false,
      u: { x: 4 },
      eq: true,
      paren: { x: 6 },
      n: 6,
    });
  });

  it("rewrites a chain whose right operand is a rewritten operator (precedence, parentheses)", () => {
    // review 5, item 5: only the left spine used the rewritten type, so the
    // right operand `b * 2` was typed number and `a + b * 2` was a bogus
    // "right operand must also be 'V'" error.
    const prelude2 = prelude
      .replace("/** @op < */", "/** @op - */ sub(a: A, b: A): A;\n  /** @op < */")
      .replace(
        "same: (a, b) => a.x === b.x,",
        "same: (a, b) => a.x === b.x,\n  sub: (a, b) => ({ x: a.x - b.x }),"
      );
    const code = `${prelude2}
export const p1 = a + b * 2;
export const p2 = a * 2 + b * 3;
export const p3 = a - (b - c);
export const p4 = a + (b + c) * 2;
export const p5 = a < b * 2;
export const p6 = (a + b) * 2 + (c - a);
`;
    const result = transformCode(code, { fileName: "op-chain-right.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(evaluate(result.code)).toMatchObject({
      p1: { x: 5 },
      p2: { x: 8 },
      p3: { x: 2 },
      p4: { x: 11 },
      p5: true,
      p6: { x: 8 },
    });
  });

  it("a const bound to a rewritten operator is an operand of its type (TypeScript types it number)", () => {
    const code = `${prelude}
const twice = a * 2;
const alias = twice;
export const l = twice + b;
export const r = b + alias;
export const t = twice < c;
`;
    const result = transformCode(code, { fileName: "op-chain-const.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(evaluate(result.code)).toMatchObject({ l: { x: 4 }, r: { x: 4 }, t: true });
  });

  it("a right operand that is a primitive expression is still reported", () => {
    const code = `${prelude}
export const bad = a + (1 + 2);
`;
    const result = transformCode(code, { fileName: "op-chain-right-bad.ts" });
    const errs = result.diagnostics.filter((d) => d.severity === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/right operand must also be/);
  });

  it("a comparison result (boolean) is not taken as the instance type", () => {
    const code = `${prelude}
declare const flag: boolean;
export const r = (a === b) === flag;
`;
    const result = transformCode(code, { fileName: "op-chain-bool.ts" });
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.code).toMatch(/\) === flag/);
  });
});
