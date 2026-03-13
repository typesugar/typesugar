/**
 * Integration tests for typeclass operator rewriting.
 *
 * Tests both:
 * 1. Source-based approach: @op JSDoc annotations on typeclass method signatures (preferred)
 * 2. Legacy approach: registerTypeclassSyntax() calls (deprecated)
 *
 * Verifies that binary expressions like `a + b` get rewritten to
 * typeclass method calls (e.g., `numericPoint.add(a, b)`) when the
 * left operand's type has a matching instance.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import {
  registerTypeclassSyntax,
  clearSyntaxRegistry,
  clearRegistries,
  registerInstanceWithMeta,
} from "@typesugar/macros";
import { config } from "@typesugar/core";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
  config.set({ resolution: { mode: "automatic" } });
});

afterEach(() => {
  config.reset();
});

// ============================================================================
// Source-Based Approach (preferred): @op JSDoc annotations
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
    expect(result.code).toContain("numericPoint.add");
    expect(result.code).not.toContain("a + b");
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
    expect(result.code).toContain("eqPoint.equals");
    expect(result.code).not.toContain("a === b");
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
    expect(result.code).toContain("ordPoint.lt");
    expect(result.code).not.toContain("a < b");
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
});

// ============================================================================
// Legacy Approach (deprecated): registerTypeclassSyntax()
// These tests verify backwards compatibility.
// ============================================================================

function setupNumericInstance(typeName: string, instanceName: string) {
  registerTypeclassSyntax("Numeric", [
    ["+", "add"],
    ["-", "sub"],
    ["*", "mul"],
  ]);
  registerInstanceWithMeta({
    typeclassName: "Numeric",
    forType: typeName,
    instanceName,
    derived: false,
  });
}

function setupEqInstance(typeName: string, instanceName: string) {
  registerTypeclassSyntax("Eq", [
    ["===", "equals"],
    ["!==", "notEquals"],
  ]);
  registerInstanceWithMeta({
    typeclassName: "Eq",
    forType: typeName,
    instanceName,
    derived: false,
  });
}

function setupOrdInstance(typeName: string, instanceName: string) {
  registerTypeclassSyntax("Ord", [
    ["<", "compare"],
    ["<=", "compare"],
    [">", "compare"],
    [">=", "compare"],
  ]);
  registerInstanceWithMeta({
    typeclassName: "Ord",
    forType: typeName,
    instanceName,
    derived: false,
  });
}

describe("Legacy operator rewriting with registerTypeclassSyntax() [deprecated]", () => {
  it("rewrites a + b to Numeric.add(a, b) for typed operands", () => {
    setupNumericInstance("Point", "numericPoint");

    const code = `
interface Point { x: number; y: number; }
declare const a: Point;
declare const b: Point;
const c = a + b;
    `.trim();

    const result = transformCode(code, { fileName: "op-add.ts" });
    expect(result.code).toContain("numericPoint.add");
  });

  it("rewrites a === b to Eq.equals(a, b) for typed operands", () => {
    setupEqInstance("Point", "eqPoint");

    const code = `
interface Point { x: number; y: number; }
declare const a: Point;
declare const b: Point;
const c = a === b;
    `.trim();

    const result = transformCode(code, { fileName: "op-eq.ts" });
    expect(result.code).toContain("eqPoint.equals");
  });

  it("rewrites a < b to Ord.compare(a, b) for typed operands", () => {
    setupOrdInstance("Point", "ordPoint");

    const code = `
interface Point { x: number; y: number; }
declare const a: Point;
declare const b: Point;
const c = a < b;
    `.trim();

    const result = transformCode(code, { fileName: "op-lt.ts" });
    expect(result.code).toContain("ordPoint.compare");
  });

  it("leaves plain number + number alone when no typeclass registered", () => {
    const code = `
const a = 1;
const b = 2;
const c = a + b;
    `.trim();

    const result = transformCode(code, { fileName: "op-plain.ts" });
    expect(result.code).toContain("a + b");
    expect(result.code).not.toContain(".add");
  });

  it("reports ambiguity when two typeclasses provide same operator", () => {
    registerTypeclassSyntax("Numeric", [["+", "add"]]);
    registerTypeclassSyntax("Semigroup", [["+", "concat"]]);
    registerInstanceWithMeta({
      typeclassName: "Numeric",
      forType: "Point",
      instanceName: "numericPoint",
      derived: false,
    });
    registerInstanceWithMeta({
      typeclassName: "Semigroup",
      forType: "Point",
      instanceName: "semigroupPoint",
      derived: false,
    });

    const code = `
interface Point { x: number; y: number; }
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

  it("does not rewrite operators for types without instances", () => {
    registerTypeclassSyntax("Numeric", [["+", "add"]]);

    const code = `
interface Vec3 { x: number; y: number; z: number; }
declare const a: Vec3;
declare const b: Vec3;
const c = a + b;
    `.trim();

    const result = transformCode(code, { fileName: "op-no-instance.ts" });
    expect(result.code).toContain("a + b");
    expect(result.code).not.toContain(".add");
  });
});
