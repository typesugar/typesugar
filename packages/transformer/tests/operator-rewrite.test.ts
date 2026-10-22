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
    // No level left native (`numV.add(a, b) + c`); inlined reads `(...) + c.x` are fine.
    expect(result.code).not.toMatch(/\) (\+|<|===) [ac](?![.\w])/);
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

// ============================================================================
// Zero-cost chains: no IIFE, no intermediate object
// ============================================================================

describe("Chained operators inline to straight-line code", () => {
  // Every level of `a + b + c + d` used to be applied as an IIFE over the
  // previous level's object literal (`((a, b) => ({ ... }))(({ ... }), c)`):
  // the inliner can't substitute an object literal its body reads twice.
  // Each `p.x` now reads the literal's `x` initializer, and a value read more
  // than once (a rational's denominator) or an operand with an effect is
  // bound to a `const` before the statement.
  const prelude = `
/** @typeclass */
export interface Num<A> {
  /** @op + */ add(a: A, b: A): A;
}
export interface V { x: number; y: number }
/** @impl Num<V> */
export const numV: Num<V> = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
};
export interface Q { n: number; d: number }
/** @impl Num<Q> */
export const numQ: Num<Q> = {
  add: (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d }),
};
const a: V = { x: 1, y: 10 }, b: V = { x: 2, y: 20 }, c: V = { x: 3, y: 30 }, d: V = { x: 4, y: 40 };
const p: Q = { n: 1, d: 2 }, q: Q = { n: 1, d: 3 }, r: Q = { n: 1, d: 6 }, w: Q = { n: 1, d: 4 };
export const log: string[] = [];
function mk(tag: string): V { log.push(tag); return { x: 100, y: 1000 }; }
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

  const lineOf = (code: string, name: string): string =>
    code.split("\n").find((l) => l.includes(`const ${name} =`)) ?? "";

  it("a + b + c + d on a product type is one object literal (no IIFE)", () => {
    const code = `${prelude}
export const s4 = a + b + c + d;
export function f() { const t = a + b + c + d; return t; }
`;
    const result = transformCode(code, { fileName: "op-zero-cost-vec.ts" });
    expect(result.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    expect(lineOf(result.code, "s4")).toBe(
      "export const s4 = ({ x: ((a.x + b.x) + c.x) + d.x, y: ((a.y + b.y) + c.y) + d.y });"
    );
    expect(lineOf(result.code, "t")).not.toContain("=>");
    expect(evaluate(result.code)).toMatchObject({ s4: { x: 10, y: 100 } });
    expect((evaluate(result.code).f as () => unknown)()).toEqual({ x: 10, y: 100 });
  });

  it("a value read twice (a rational's denominator) is a const before the statement", () => {
    const code = `${prelude}
export const q4 = p + q + r + w;
`;
    const result = transformCode(code, { fileName: "op-zero-cost-rat.ts" });
    expect(result.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    const q4 = lineOf(result.code, "q4");
    expect(q4).toMatch(/^export const q4 = \(\{ n: .*, d: \w+ \* w\.d \}\);$/);
    expect(q4).not.toContain("=>");
    // Two denominators are shared (levels 2 and 3), each computed once.
    const consts = result.code.split("\n").filter((l) => /^const __typesugar_\w+ = /.test(l));
    expect(consts).toHaveLength(2);
    // 1/2 + 1/3 + 1/6 + 1/4 = 5/4 (unreduced: 360/288)
    const v = evaluate(result.code).q4 as { n: number; d: number };
    expect(v.n / v.d).toBeCloseTo(1.25);
  });

  it("an operand with an effect is evaluated once, in order", () => {
    const code = `${prelude}
export const m = mk("1") + mk("2") + a;
`;
    const result = transformCode(code, { fileName: "op-zero-cost-effect.ts" });
    expect(result.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    expect(lineOf(result.code, "m")).not.toContain("=>");
    const out = evaluate(result.code);
    expect(out.m).toEqual({ x: 201, y: 2010 });
    expect(out.log).toEqual(["1", "2"]);
  });

  it("outside statement position, or after an effect, it stays correct (IIFE where it must)", () => {
    const code = `${prelude}
export const g = (u: Q) => u + q + r;
declare const flag: boolean;
export const cond = !flag ? p + q + r : p;
export const after = (log.push("first"), p + q + r);
export const second = 0, third = mk("3") + mk("4") + a;
`;
    const result = transformCode(code, { fileName: "op-zero-cost-positions.ts" });
    expect(result.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    // No const is hoisted out of these positions.
    expect(result.code).not.toMatch(/^const __typesugar_/m);
    const out = evaluate(
      result.code.replace("declare const flag: boolean;", "const flag = false;")
    );
    const third = { n: 1 * 3 * 6 + 1 * 2 * 6 + 1 * 6, d: 36 };
    expect((out.g as (u: unknown) => { n: number; d: number })(p0()).n).toBe(third.n);
    expect(out.cond).toEqual(third);
    expect(out.after).toEqual(third);
    expect(out.third).toEqual({ x: 201, y: 2010 });
    expect(out.log).toEqual(["first", "3", "4"]);
    function p0() {
      return { n: 1, d: 2 };
    }
  });

  // Review 7: hoisting an effectful operand moved it in front of a read the
  // statement does first. `pv + (bump() + bump())` read pv AFTER both bumps.
  it("an effect is not hoisted in front of an earlier read of mutable state", () => {
    const code = `${prelude}
let pv: V = { x: 1, y: 10 };
function bump(): V { pv = { x: 1000, y: 1000 }; return { x: 0, y: 0 }; }
export const t1 = pv + (bump() + bump());
let pq: Q = { n: 1, d: 2 };
function bq(): Q { pq = { n: 7, d: 7 }; return { n: 1, d: 3 }; }
export const t2 = pq + (bq() + r);
class Walker {
  pos: V = { x: 1, y: 1 };
  step(): V { this.pos = { x: 50, y: 50 }; return { x: 0, y: 0 }; }
  walk(): V { return this.pos + (this.step() + this.step()); }
}
export const t3 = new Walker().walk();
`;
    const result = transformCode(code, { fileName: "op-hoist-order.ts" });
    expect(result.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    const out = evaluate(result.code);
    expect(out.t1).toEqual({ x: 1, y: 10 });
    // 1/2 + (1/3 + 1/6) = 1/2 + 9/18
    expect(out.t2).toEqual({ n: 1 * 18 + 9 * 2, d: 36 });
    expect(out.t3).toEqual({ x: 1, y: 1 });
  });

  it("an effect is still hoisted after a const or literal operand (nothing it can change)", () => {
    const code = `${prelude}
export const k = a + (mk("1") + mk("2"));
`;
    const result = transformCode(code, { fileName: "op-hoist-const-left.ts" });
    expect(result.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    expect(lineOf(result.code, "k")).not.toContain("=>");
    const out = evaluate(result.code);
    expect(out.k).toEqual({ x: 201, y: 2010 });
    expect(out.log).toEqual(["1", "2"]);
  });

  it("hoisted consts go after the statement's leading comment, and its JSDoc stays on it", () => {
    const code = `${prelude}
// Two made-up vectors.
/** The sum. */
export const m2 = mk("1") + mk("2");
`;
    const result = transformCode(code, { fileName: "op-hoist-comment.ts" });
    expect(result.diagnostics.filter((x) => x.severity === "error")).toEqual([]);
    const lines = result.code.split("\n");
    const comment = lines.findIndex((l) => l.includes("// Two made-up vectors."));
    const firstConst = lines.findIndex((l) => /^const __typesugar_/.test(l));
    const doc = lines.findIndex((l) => l.includes("/** The sum. */"));
    const stmt = lines.findIndex((l) => l.startsWith("export const m2 ="));
    expect(comment).toBeGreaterThanOrEqual(0);
    expect(firstConst).toBeGreaterThan(comment);
    expect(doc).toBeGreaterThan(firstConst);
    expect(stmt).toBe(doc + 1);
  });
});
