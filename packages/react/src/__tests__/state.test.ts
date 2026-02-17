/**
 * Tests for the state() macro
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroTestContext } from "../../../test-utils/macro-context.js";
import { stateMacro, getStateMetadata, isStateMarker, extractStateFromMarker } from "../macros/state.js";

describe("state() macro", () => {
  describe("basic transformation", () => {
    it("should transform state(0) into marker object", () => {
      const source = `
        function Counter() {
          const count = state(0);
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const callExpr = findStateCall(ctx.sourceFile);
      expect(callExpr).toBeTruthy();
      
      if (callExpr) {
        const result = stateMacro.expand(ctx, callExpr, [...callExpr.arguments]);
        expect(ts.isObjectLiteralExpression(result)).toBe(true);
        expect(isStateMarker(result as ts.ObjectLiteralExpression)).toBe(true);
      }
    });

    it("should extract metadata from marker", () => {
      const source = `
        function Counter() {
          const count = state(0);
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const callExpr = findStateCall(ctx.sourceFile);
      
      if (callExpr) {
        const result = stateMacro.expand(ctx, callExpr, [...callExpr.arguments]);
        if (ts.isObjectLiteralExpression(result)) {
          const extracted = extractStateFromMarker(result);
          expect(extracted).toBeTruthy();
          expect(extracted?.name).toBe("count");
          expect(extracted?.valueIdent).toBe("__count_val");
          expect(extracted?.setterIdent).toBe("__count_set");
        }
      }
    });

    it("should store metadata in context", () => {
      const source = `
        function Counter() {
          const count = state(0);
          const name = state("hello");
          return <div>{count}{name}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const calls = findAllStateCalls(ctx.sourceFile);
      
      for (const call of calls) {
        stateMacro.expand(ctx, call, [...call.arguments]);
      }
      
      const metadata = getStateMetadata(ctx.sourceFile);
      expect(metadata.size).toBe(2);
      expect(metadata.has("count")).toBe(true);
      expect(metadata.has("name")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should error when state() has no arguments", () => {
      const source = `
        function Counter() {
          const count = state();
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const callExpr = findStateCall(ctx.sourceFile);
      
      if (callExpr) {
        const result = stateMacro.expand(ctx, callExpr, []);
        // Should return original call when there's an error
        expect(result).toBe(callExpr);
        expect(ctx.errors.length).toBeGreaterThan(0);
        expect(ctx.errors[0]).toContain("exactly one argument");
      }
    });

    it("should error when state() is not in variable declaration", () => {
      const source = `
        function Counter() {
          state(0); // Not assigned to variable
          return <div>test</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const callExpr = findStateCall(ctx.sourceFile);
      
      if (callExpr) {
        const result = stateMacro.expand(ctx, callExpr, [...callExpr.arguments]);
        expect(ctx.errors.length).toBeGreaterThan(0);
        expect(ctx.errors[0]).toContain("variable declaration");
      }
    });
  });
});

// Helper to find state() calls in source
function findStateCall(sourceFile: ts.SourceFile): ts.CallExpression | undefined {
  let result: ts.CallExpression | undefined;
  
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "state"
    ) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return result;
}

function findAllStateCalls(sourceFile: ts.SourceFile): ts.CallExpression[] {
  const results: ts.CallExpression[] = [];
  
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "state"
    ) {
      results.push(node);
    }
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return results;
}
