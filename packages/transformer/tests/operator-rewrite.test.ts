/**
 * Integration tests for typeclass operator rewriting.
 *
 * Verifies that binary expressions like `a + b` get rewritten to
 * typeclass method calls (e.g., `numericPoint.add(a, b)`) when the
 * left operand's type has a matching instance with Op<> annotation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import {
  registerTypeclassSyntax,
  clearSyntaxRegistry,
  clearRegistries,
  registerInstanceWithMeta,
} from "@typesugar/macros";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
});

function setupNumericInstance(typeName: string, instanceName: string) {
  registerTypeclassSyntax("Numeric", [["+", "add"], ["-", "sub"], ["*", "mul"]]);
  registerInstanceWithMeta({
    typeclassName: "Numeric",
    forType: typeName,
    instanceName,
    derived: false,
  });
}

function setupEqInstance(typeName: string, instanceName: string) {
  registerTypeclassSyntax("Eq", [["===", "equals"], ["!==", "notEquals"]]);
  registerInstanceWithMeta({
    typeclassName: "Eq",
    forType: typeName,
    instanceName,
    derived: false,
  });
}

function setupOrdInstance(typeName: string, instanceName: string) {
  registerTypeclassSyntax("Ord", [["<", "compare"], ["<=", "compare"], [">", "compare"], [">=", "compare"]]);
  registerInstanceWithMeta({
    typeclassName: "Ord",
    forType: typeName,
    instanceName,
    derived: false,
  });
}

describe("Typeclass operator rewriting", () => {
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
