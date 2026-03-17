/**
 * Integration tests for `= implicit()` automatic parameter resolution.
 *
 * Verifies:
 * - Calls to functions with `= implicit()` params auto-fill missing typeclass instances
 * - Nested calls propagate enclosing scope
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
} from "@typesugar/macros";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
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
// 1. Basic = implicit() — auto-fill instance parameter
// ============================================================================

describe("= implicit() basic resolution", () => {
  it("fills missing Ord<T> parameter when calling sort(numbers)", () => {
    setupOrdTypeclass();
    registerOrdInstance("number", "ordNumber");

    const code = [
      "declare function implicit<T>(): T;",
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "declare const ordNumber: Ord<number>;",
      "",
      "function sort<T>(items: T[], ord: Ord<T> = implicit()): T[] {",
      "  return items;",
      "}",
      "",
      "const numbers: number[] = [3, 1, 2];",
      "const result = sort(numbers);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-basic.ts", verbose: true });

    // Zero-cost: instance is inlined directly, not via Ord.summon()
    expect(r.code).toContain("ordNumber");
    expect(r.code).not.toContain("Ord.summon");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("does not modify call when all arguments are already provided", () => {
    setupOrdTypeclass();
    registerOrdInstance("number", "ordNumber");

    const code = [
      "declare function implicit<T>(): T;",
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "declare const ordNumber: Ord<number>;",
      "declare const customOrd: Ord<number>;",
      "",
      "function sort<T>(items: T[], ord: Ord<T> = implicit()): T[] {",
      "  return items;",
      "}",
      "",
      "const numbers: number[] = [3, 1, 2];",
      "const result = sort(numbers, customOrd);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-all-provided.ts" });

    expect(r.code).not.toContain("Ord.summon");
    expect(r.code).toContain("customOrd");
  });
});

// ============================================================================
// 2. Nested propagation
// ============================================================================

describe("= implicit() nested propagation", () => {
  it("propagates implicit scope from outer to inner call", () => {
    setupShowTypeclass();
    registerShowInstance("number", "showNumber");

    const code = [
      "declare function implicit<T>(): T;",
      "declare interface Show<T> { show(a: T): string; }",
      "",
      "function inner<T>(a: T, S: Show<T> = implicit()): string {",
      "  return S.show(a);",
      "}",
      "",
      "function outer<T>(a: T, S: Show<T> = implicit()): string {",
      "  return inner(a);",
      "}",
      "",
      "const x = outer(42);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-nested.ts" });

    // Zero-cost: instance is inlined directly, not via Show.summon()
    expect(r.code).toContain("showNumber");
    expect(r.code).not.toContain("Show.summon");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });
});

// ============================================================================
// 3. Scope shadowing
// ============================================================================

describe("= implicit() scope shadowing", () => {
  it("inner scope shadows outer scope for same typeclass+type", () => {
    setupOrdTypeclass();
    setupShowTypeclass();
    registerOrdInstance("number", "ordNumber");
    registerShowInstance("number", "showNumber");

    const code = [
      "declare function implicit<T>(): T;",
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "declare interface Show<T> { show(a: T): string; }",
      "",
      "function innerFn<T>(a: T, O: Ord<T> = implicit()): number {",
      "  return O.compare(a, a);",
      "}",
      "",
      "function outerFn<T>(a: T, O: Ord<T> = implicit(), S: Show<T> = implicit()): number {",
      "  return innerFn(a);",
      "}",
      "",
      "const x = outerFn(42);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-shadow.ts" });

    // Zero-cost: instances are inlined directly, not via summon()
    expect(r.code).toContain("ordNumber");
    expect(r.code).toContain("showNumber");
    expect(r.code).not.toContain("Ord.summon");
    expect(r.code).not.toContain("Show.summon");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });
});

// ============================================================================
// 4. Missing instance — compile error
// ============================================================================

describe("= implicit() error reporting", () => {
  it("reports error when no instance is available for implicit param", () => {
    setupOrdTypeclass();

    const code = [
      "declare function implicit<T>(): T;",
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "",
      "function sortImplicit<T>(items: T[], ord: Ord<T> = implicit()): T[] {",
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
// 5. Opt-out — "use no typesugar" skips implicit resolution
// ============================================================================

describe("= implicit() opt-out", () => {
  it("use no typesugar skips implicit resolution", () => {
    setupOrdTypeclass();
    registerOrdInstance("number", "ordNumber");

    const code = [
      '"use no typesugar";',
      "declare function implicit<T>(): T;",
      "declare interface Ord<T> { compare(a: T, b: T): number; }",
      "",
      "function sortImplicit<T>(items: T[], ord: Ord<T> = implicit()): T[] {",
      "  return items;",
      "}",
      "",
      "const result = sortImplicit([3, 1, 2]);",
    ].join("\n");

    const r = transformCode(code, { fileName: "implicits-optout.ts" });

    expect(r.code).not.toContain("Ord.summon");
  });
});
