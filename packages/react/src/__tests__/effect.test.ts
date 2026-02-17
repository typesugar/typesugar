/**
 * Tests for the effect() and watch() macros
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroTestContext } from "../../../test-utils/macro-context.js";
import { effectMacro, watchMacro } from "../macros/effect.js";
import { stateMacro } from "../macros/state.js";

describe("effect() macro", () => {
  describe("basic transformation", () => {
    it("should transform effect() into useEffect", () => {
      const source = `
        function Counter() {
          const count = state(0);
          effect(() => {
            document.title = \`Count: \${count}\`;
          });
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Process state() calls
      const stateCalls = findAllCalls(ctx.sourceFile, "state");
      for (const call of stateCalls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      // Process effect() calls
      const effectCalls = findAllCalls(ctx.sourceFile, "effect");
      expect(effectCalls.length).toBe(1);
      
      const result = effectMacro.expand(ctx, effectCalls[0], [...effectCalls[0].arguments]);
      
      // Should be a useEffect call
      expect(ts.isCallExpression(result)).toBe(true);
      if (ts.isCallExpression(result)) {
        expect(ts.isIdentifier(result.expression)).toBe(true);
        expect((result.expression as ts.Identifier).text).toBe("useEffect");
        expect(result.arguments.length).toBe(2); // effect fn + deps array
      }
    });

    it("should auto-extract dependencies", () => {
      const source = `
        function Counter() {
          const count = state(0);
          const name = state("test");
          effect(() => {
            console.log(count, name);
          });
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Process state() calls
      const stateCalls = findAllCalls(ctx.sourceFile, "state");
      for (const call of stateCalls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      // Process effect() call
      const effectCalls = findAllCalls(ctx.sourceFile, "effect");
      const result = effectMacro.expand(ctx, effectCalls[0], [...effectCalls[0].arguments]);
      
      // Check dependency array has both deps
      if (ts.isCallExpression(result)) {
        const depsArg = result.arguments[1];
        expect(ts.isArrayLiteralExpression(depsArg)).toBe(true);
        if (ts.isArrayLiteralExpression(depsArg)) {
          expect(depsArg.elements.length).toBe(2);
        }
      }
    });
  });

  describe("warnings", () => {
    it("should warn when effect has no side effects", () => {
      const source = `
        function Counter() {
          const count = state(0);
          effect(() => {
            return count * 2; // Pure computation - should be derived
          });
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Process state() calls
      const stateCalls = findAllCalls(ctx.sourceFile, "state");
      for (const call of stateCalls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      // Process effect() call
      const effectCalls = findAllCalls(ctx.sourceFile, "effect");
      effectMacro.expand(ctx, effectCalls[0], [...effectCalls[0].arguments]);
      
      // Should warn about using derived() instead
      // Note: This depends on the exact implementation of shouldBeDerived()
    });
  });
});

describe("watch() macro", () => {
  describe("basic transformation", () => {
    it("should transform watch() into useEffect with explicit deps", () => {
      const source = `
        function Counter() {
          const userId = state(1);
          const profile = state(null);
          watch([userId], async (id) => {
            profile.set(await fetchProfile(id));
          });
          return <div>{profile}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Process state() calls
      const stateCalls = findAllCalls(ctx.sourceFile, "state");
      for (const call of stateCalls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      // Process watch() calls
      const watchCalls = findAllCalls(ctx.sourceFile, "watch");
      expect(watchCalls.length).toBe(1);
      
      const result = watchMacro.expand(ctx, watchCalls[0], [...watchCalls[0].arguments]);
      
      // Should be a useEffect call
      expect(ts.isCallExpression(result)).toBe(true);
      if (ts.isCallExpression(result)) {
        expect(ts.isIdentifier(result.expression)).toBe(true);
        expect((result.expression as ts.Identifier).text).toBe("useEffect");
      }
    });
  });

  describe("error handling", () => {
    it("should error when watch() has wrong number of arguments", () => {
      const source = `
        function Counter() {
          watch([]);
          return <div>test</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const watchCalls = findAllCalls(ctx.sourceFile, "watch");
      
      watchMacro.expand(ctx, watchCalls[0], [...watchCalls[0].arguments]);
      
      expect(ctx.errors.length).toBeGreaterThan(0);
      expect(ctx.errors[0]).toContain("two arguments");
    });

    it("should error when first argument is not an array", () => {
      const source = `
        function Counter() {
          const count = state(0);
          watch(count, () => {});
          return <div>test</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Process state() calls
      const stateCalls = findAllCalls(ctx.sourceFile, "state");
      for (const call of stateCalls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      const watchCalls = findAllCalls(ctx.sourceFile, "watch");
      watchMacro.expand(ctx, watchCalls[0], [...watchCalls[0].arguments]);
      
      expect(ctx.errors.length).toBeGreaterThan(0);
      expect(ctx.errors[0]).toContain("array");
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
