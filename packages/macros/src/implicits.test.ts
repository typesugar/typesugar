/**
 * Tests for implicits.ts — Implicit parameter detection, scope building, and resolution
 *
 * Covers:
 * - isImplicitDefault detection
 * - hasImplicitParams checking
 * - getImplicitParamIndices extraction
 * - buildImplicitScopeFromDecl scope building
 */

import * as ts from "typescript";
import { describe, it, expect } from "vitest";
import {
  isImplicitDefault,
  hasImplicitParams,
  getImplicitParamIndices,
  buildImplicitScopeFromDecl,
} from "./implicits.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a minimal TypeScript program from source to get real AST nodes.
 */
function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile("test.ts", source, ts.ScriptTarget.Latest, true);
}

/**
 * Find first function declaration in source file.
 */
function findFunctionDecl(sf: ts.SourceFile): ts.FunctionDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) return stmt;
  }
  return undefined;
}

// ============================================================================
// isImplicitDefault
// ============================================================================

describe("isImplicitDefault", () => {
  it("returns true for implicit() call", () => {
    const sf = parseSource(`function f(eq: Eq<number> = implicit()) {}`);
    const fn = findFunctionDecl(sf)!;
    expect(fn).toBeDefined();
    expect(isImplicitDefault(fn.parameters[0].initializer)).toBe(true);
  });

  it("returns false for other default values", () => {
    const sf = parseSource(`function f(n: number = 0) {}`);
    const fn = findFunctionDecl(sf)!;
    expect(isImplicitDefault(fn.parameters[0].initializer)).toBe(false);
  });

  it("returns false for no initializer", () => {
    expect(isImplicitDefault(undefined)).toBe(false);
  });

  it("returns false for non-call expression initializer", () => {
    const sf = parseSource(`function f(n = 42) {}`);
    const fn = findFunctionDecl(sf)!;
    expect(isImplicitDefault(fn.parameters[0].initializer)).toBe(false);
  });

  it("returns false for call to different function", () => {
    const sf = parseSource(`function f(n = someOtherFn()) {}`);
    const fn = findFunctionDecl(sf)!;
    expect(isImplicitDefault(fn.parameters[0].initializer)).toBe(false);
  });
});

// ============================================================================
// hasImplicitParams
// ============================================================================

describe("hasImplicitParams", () => {
  it("returns true when function has implicit params", () => {
    const sf = parseSource(
      `function show<A>(a: A, S: Show<A> = implicit()): string { return ""; }`
    );
    const fn = findFunctionDecl(sf)!;
    expect(hasImplicitParams(fn)).toBe(true);
  });

  it("returns false when no implicit params", () => {
    const sf = parseSource(`function add(a: number, b: number): number { return a + b; }`);
    const fn = findFunctionDecl(sf)!;
    expect(hasImplicitParams(fn)).toBe(false);
  });

  it("returns true when first param is implicit", () => {
    const sf = parseSource(`function f(S: Show<number> = implicit()) {}`);
    const fn = findFunctionDecl(sf)!;
    expect(hasImplicitParams(fn)).toBe(true);
  });

  it("returns false for function with no params", () => {
    const sf = parseSource(`function f() {}`);
    const fn = findFunctionDecl(sf)!;
    expect(hasImplicitParams(fn)).toBe(false);
  });

  it("handles mixed implicit and non-implicit defaults", () => {
    const sf = parseSource(`function f(a: number = 0, eq: Eq<number> = implicit()) {}`);
    const fn = findFunctionDecl(sf)!;
    expect(hasImplicitParams(fn)).toBe(true);
  });
});

// ============================================================================
// getImplicitParamIndices
// ============================================================================

describe("getImplicitParamIndices", () => {
  it("returns indices of implicit params", () => {
    const sf = parseSource(
      `function f(a: number, eq: Eq<number> = implicit(), ord: Ord<number> = implicit()) {}`
    );
    const fn = findFunctionDecl(sf)!;
    expect(getImplicitParamIndices(fn)).toEqual([1, 2]);
  });

  it("returns empty array when no implicit params", () => {
    const sf = parseSource(`function f(a: number, b: string) {}`);
    const fn = findFunctionDecl(sf)!;
    expect(getImplicitParamIndices(fn)).toEqual([]);
  });

  it("handles non-contiguous implicit params", () => {
    const sf = parseSource(
      `function f(a: number, eq: Eq<number> = implicit(), n: number = 0, ord: Ord<number> = implicit()) {}`
    );
    const fn = findFunctionDecl(sf)!;
    expect(getImplicitParamIndices(fn)).toEqual([1, 3]);
  });

  it("handles single implicit param", () => {
    const sf = parseSource(`function f(eq: Eq<number> = implicit()) {}`);
    const fn = findFunctionDecl(sf)!;
    expect(getImplicitParamIndices(fn)).toEqual([0]);
  });
});

// ============================================================================
// buildImplicitScopeFromDecl
// ============================================================================

describe("buildImplicitScopeFromDecl", () => {
  it("builds scope from implicit params", () => {
    const sf = parseSource(
      `function f<A>(a: A, S: Show<A> = implicit(), E: Eq<A> = implicit()) {}`
    );
    const fn = findFunctionDecl(sf)!;
    const scope = buildImplicitScopeFromDecl(fn);
    expect(scope.available.size).toBe(2);
    expect(scope.available.get("Show<A>")).toBe("S");
    expect(scope.available.get("Eq<A>")).toBe("E");
  });

  it("ignores non-implicit params", () => {
    const sf = parseSource(`function f(a: number, b: string = "default") {}`);
    const fn = findFunctionDecl(sf)!;
    const scope = buildImplicitScopeFromDecl(fn);
    expect(scope.available.size).toBe(0);
  });

  it("ignores params without type reference", () => {
    const sf = parseSource(`function f(a = implicit()) {}`);
    const fn = findFunctionDecl(sf)!;
    const scope = buildImplicitScopeFromDecl(fn);
    expect(scope.available.size).toBe(0);
  });

  it("ignores type references without type arguments", () => {
    const sf = parseSource(`function f(S: Show = implicit()) {}`);
    const fn = findFunctionDecl(sf)!;
    const scope = buildImplicitScopeFromDecl(fn);
    expect(scope.available.size).toBe(0);
  });
});
