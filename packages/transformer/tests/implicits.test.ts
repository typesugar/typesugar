/**
 * Integration tests for @implicits automatic parameter resolution.
 *
 * Verifies:
 * - @implicits attribute macro strips decorator and registers function info
 * - Calls to @implicits functions auto-fill missing typeclass instance params
 * - Nested @implicits calls propagate enclosing scope
 * - Inner scope shadows outer scope
 * - Missing instance produces a diagnostic error
 * - "use no typesugar" opt-out skips implicit resolution
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import {
  clearRegistries,
  clearSyntaxRegistry,
  registerTypeclassDef,
  registerInstanceWithMeta,
  registerImplicitsFunction,
  implicitsFunctions,
  implicitsAttribute,
} from "@typesugar/macros";
import { globalRegistry } from "@typesugar/core";

import { getImplicitsFunction } from "@typesugar/macros";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
  implicitsFunctions.clear();
  globalRegistry.clear();

  globalRegistry.register(implicitsAttribute);
});

describe("@implicits registry sanity", () => {
  it("registerImplicitsFunction and getImplicitsFunction share the same map", () => {
    registerImplicitsFunction({
      functionName: "testFn",
      sourceFile: "test.ts",
      implicitParams: [],
      totalParams: 1,
      typeParams: [],
    });
    const info = getImplicitsFunction("testFn");
    expect(info).toBeDefined();
    expect(info!.functionName).toBe("testFn");
    expect(implicitsFunctions.size).toBe(1);
  });
});

function setupOrdTypeclass() {
  registerTypeclassDef({
    name: "Ord",
    typeParams: ["T"],
    methods: [{ name: "compare", params: ["a", "b"], returnType: "number" }],
    syntax: new Map(),
  });
}

function setupShowTypeclass() {
  registerTypeclassDef({
    name: "Show",
    typeParams: ["T"],
    methods: [{ name: "show", params: ["a"], returnType: "string" }],
    syntax: new Map(),
  });
}

function registerOrdInstance(forType: string, instanceName: string) {
  registerInstanceWithMeta({
    typeclassName: "Ord",
    forType,
    instanceName,
    derived: false,
  });
}

function registerShowInstance(forType: string, instanceName: string) {
  registerInstanceWithMeta({
    typeclassName: "Show",
    forType,
    instanceName,
    derived: false,
  });
}

// ============================================================================
// 1. Basic @implicits - auto-fill instance parameter
// ============================================================================

describe("@implicits basic resolution", () => {
  it("fills missing Ord<T> parameter when calling sortImplicit(numbers)", () => {
    setupOrdTypeclass();
    registerOrdInstance("number", "ordNumber");

    const code = [
      "declare function sort<T>(items: T[], ord: Ord<T>): T[];",
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "declare const ordNumber: Ord<number>;",
      "",
      "@implicits",
      "function sortImplicit<T>(items: T[], ord: Ord<T>): T[] {",
      "  return sort(items, ord);",
      "}",
      "",
      "const numbers: number[] = [3, 1, 2];",
      "const result = sortImplicit(numbers);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-basic.ts", verbose: true });

    console.log("=== OUTPUT CODE ===");
    console.log(r.code);
    console.log("=== DIAGNOSTICS ===");
    console.log(JSON.stringify(r.diagnostics, null, 2));

    expect(r.code).toContain("Ord.summon");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("does not modify call when all arguments are already provided", () => {
    setupOrdTypeclass();
    registerOrdInstance("number", "ordNumber");

    const code = [
      "declare function sort<T>(items: T[], ord: Ord<T>): T[];",
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "declare const ordNumber: Ord<number>;",
      "declare const customOrd: Ord<number>;",
      "",
      "@implicits",
      "function sortImplicit<T>(items: T[], ord: Ord<T>): T[] {",
      "  return sort(items, ord);",
      "}",
      "",
      "const numbers: number[] = [3, 1, 2];",
      "const result = sortImplicit(numbers, customOrd);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-all-provided.ts" });

    expect(r.code).not.toContain("Ord.summon");
    expect(r.code).toContain("customOrd");
  });
});

// ============================================================================
// 2. Nested propagation
// ============================================================================

describe("@implicits nested propagation", () => {
  it("propagates implicit scope from outer to inner @implicits call", () => {
    setupShowTypeclass();
    registerShowInstance("number", "showNumber");

    registerImplicitsFunction({
      functionName: "inner",
      sourceFile: "",
      implicitParams: [
        {
          paramIndex: 1,
          paramName: "S",
          typeclassName: "Show",
          typeParamName: "T",
          typeString: "Show<T>",
        },
      ],
      totalParams: 2,
      typeParams: ["T"],
    });

    const code = [
      "declare function inner<T>(a: T, S: Show<T>): string;",
      "declare interface Show<T> { show(a: T): string; }",
      "",
      "@implicits",
      "function outer<T>(a: T, S: Show<T>): string {",
      "  return inner(a);",
      "}",
      "",
      "const x = outer(42);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-nested.ts" });

    expect(r.code).toContain("Show.summon");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });
});

// ============================================================================
// 3. Scope shadowing
// ============================================================================

describe("@implicits scope shadowing", () => {
  it("inner scope shadows outer scope for same typeclass+type", () => {
    setupOrdTypeclass();
    setupShowTypeclass();
    registerOrdInstance("number", "ordNumber");
    registerShowInstance("number", "showNumber");

    registerImplicitsFunction({
      functionName: "innerFn",
      sourceFile: "",
      implicitParams: [
        {
          paramIndex: 1,
          paramName: "O",
          typeclassName: "Ord",
          typeParamName: "T",
          typeString: "Ord<T>",
        },
      ],
      totalParams: 2,
      typeParams: ["T"],
    });

    const code = [
      "declare function innerFn<T>(a: T, O: Ord<T>): number;",
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "declare interface Show<T> { show(a: T): string; }",
      "",
      "@implicits",
      "function outerFn<T>(a: T, O: Ord<T>, S: Show<T>): number {",
      "  return innerFn(a);",
      "}",
      "",
      "const x = outerFn(42);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-shadow.ts" });

    expect(r.code).toContain("Ord.summon");
    expect(r.code).toContain("Show.summon");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });
});

// ============================================================================
// 4. Missing instance - compile error
// ============================================================================

describe("@implicits error reporting", () => {
  it("reports error when no instance is available for implicit param", () => {
    setupOrdTypeclass();

    const code = [
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "",
      "@implicits",
      "function sortImplicit<T>(items: T[], ord: Ord<T>): T[] {",
      "  return items;",
      "}",
      "",
      'const strings: string[] = ["b", "a"];',
      "const result = sortImplicit(strings);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-missing.ts" });

    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain("No instance found");
    expect(errors[0].message).toContain("Ord");
  });
});

// ============================================================================
// 5. Opt-out - "use no typesugar" skips implicit resolution
// ============================================================================

describe("@implicits opt-out", () => {
  it("use no typesugar skips @implicits decorator processing", () => {
    setupOrdTypeclass();
    registerOrdInstance("number", "ordNumber");

    const code = [
      '"use no typesugar";',
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "",
      "@implicits",
      "function sortImplicit<T>(items: T[], ord: Ord<T>): T[] {",
      "  return items;",
      "}",
      "",
      "const result = sortImplicit([3, 1, 2]);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-optout.ts" });

    expect(r.code).not.toContain("Ord.summon");
  });
});

// ============================================================================
// 6. @implicits strips the decorator from output
// ============================================================================

describe("@implicits decorator stripping", () => {
  it("removes @implicits decorator from the output function", () => {
    setupOrdTypeclass();

    const code = [
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "",
      "@implicits",
      "function sortImplicit<T>(items: T[], ord: Ord<T>): T[] {",
      "  return items;",
      "}",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-strip.ts" });

    expect(r.code).not.toContain("@implicits");
  });
});
