/**
 * Tests for the derived() macro
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroTestContext } from "../../../test-utils/macro-context.js";
import { derivedMacro } from "../macros/derived.js";
import { stateMacro, getStateMetadata } from "../macros/state.js";

describe("derived() macro", () => {
  describe("basic transformation", () => {
    it("should transform derived() into useMemo", () => {
      const source = `
        function Counter() {
          const count = state(0);
          const doubled = derived(() => count * 2);
          return <div>{doubled}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // First process state() calls to populate metadata
      const stateCalls = findAllCalls(ctx.sourceFile, "state");
      for (const call of stateCalls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      // Now process derived() calls
      const derivedCalls = findAllCalls(ctx.sourceFile, "derived");
      expect(derivedCalls.length).toBe(1);
      
      const result = derivedMacro.expand(ctx, derivedCalls[0], [...derivedCalls[0].arguments]);
      
      // Should be a useMemo call
      expect(ts.isCallExpression(result)).toBe(true);
      if (ts.isCallExpression(result)) {
        expect(ts.isIdentifier(result.expression)).toBe(true);
        expect((result.expression as ts.Identifier).text).toBe("useMemo");
        expect(result.arguments.length).toBe(2); // computation + deps array
      }
    });

    it("should auto-extract dependencies", () => {
      const source = `
        function Counter() {
          const a = state(1);
          const b = state(2);
          const sum = derived(() => a + b);
          return <div>{sum}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Process state() calls
      const stateCalls = findAllCalls(ctx.sourceFile, "state");
      for (const call of stateCalls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      // Process derived() call
      const derivedCalls = findAllCalls(ctx.sourceFile, "derived");
      const result = derivedMacro.expand(ctx, derivedCalls[0], [...derivedCalls[0].arguments]);
      
      // Check dependency array
      if (ts.isCallExpression(result)) {
        const depsArg = result.arguments[1];
        expect(ts.isArrayLiteralExpression(depsArg)).toBe(true);
        if (ts.isArrayLiteralExpression(depsArg)) {
          // Should have 2 dependencies (a and b)
          expect(depsArg.elements.length).toBe(2);
        }
      }
    });
  });

  describe("purity checking", () => {
    it("should report error for state mutation in derived", () => {
      const source = `
        function Counter() {
          const count = state(0);
          const bad = derived(() => {
            count.set(1); // Error! Not pure
            return count * 2;
          });
          return <div>{bad}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Process state() calls
      const stateCalls = findAllCalls(ctx.sourceFile, "state");
      for (const call of stateCalls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      // Process derived() call
      const derivedCalls = findAllCalls(ctx.sourceFile, "derived");
      derivedMacro.expand(ctx, derivedCalls[0], [...derivedCalls[0].arguments]);
      
      // Should have purity error
      expect(ctx.errors.length).toBeGreaterThan(0);
      expect(ctx.errors.some(e => e.includes("pure") || e.includes("mutation"))).toBe(true);
    });

    it("should report error for console.log in derived", () => {
      const source = `
        function Counter() {
          const count = state(0);
          const bad = derived(() => {
            console.log(count); // Error! Not pure
            return count * 2;
          });
          return <div>{bad}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Process state() calls
      const stateCalls = findAllCalls(ctx.sourceFile, "state");
      for (const call of stateCalls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      // Process derived() call
      const derivedCalls = findAllCalls(ctx.sourceFile, "derived");
      derivedMacro.expand(ctx, derivedCalls[0], [...derivedCalls[0].arguments]);
      
      // Should have purity error
      expect(ctx.errors.length).toBeGreaterThan(0);
      expect(ctx.errors.some(e => e.includes("pure") || e.includes("console"))).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should error when derived() has no arguments", () => {
      const source = `
        function Counter() {
          const bad = derived();
          return <div>{bad}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const derivedCalls = findAllCalls(ctx.sourceFile, "derived");
      
      derivedMacro.expand(ctx, derivedCalls[0], []);
      
      expect(ctx.errors.length).toBeGreaterThan(0);
      expect(ctx.errors[0]).toContain("exactly one argument");
    });

    it("should error when argument is not a function", () => {
      const source = `
        function Counter() {
          const bad = derived(5);
          return <div>{bad}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const derivedCalls = findAllCalls(ctx.sourceFile, "derived");
      
      derivedMacro.expand(ctx, derivedCalls[0], [...derivedCalls[0].arguments]);
      
      expect(ctx.errors.length).toBeGreaterThan(0);
      expect(ctx.errors[0]).toContain("function");
    });
  });
});

// Helper to find calls by function name
function findAllCalls(sourceFile: ts.SourceFile, fnName: string): ts.CallExpression[] {
  const results: ts.CallExpression[] = [];
  
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === fnName
    ) {
      results.push(node);
    }
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return results;
}
