/**
 * Tests for compile-time safety checks
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroTestContext, parseSource } from "../../../test-utils/macro-context.js";
import {
  checkConditionalPrimitives,
  checkDirectMutation,
  runAllSafetyChecks,
} from "../analysis/safety.js";

describe("Compile-time safety checks", () => {
  describe("checkConditionalPrimitives", () => {
    it("should detect state() in if statement", () => {
      const source = `
        function Counter() {
          if (someCondition) {
            const count = state(0); // Error!
          }
          return <div>test</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkConditionalPrimitives(ctx, fn.body);
        
        expect(result.valid).toBe(false);
        expect(result.violations.length).toBeGreaterThan(0);
        expect(result.violations[0].kind).toBe("conditional-state");
      }
    });

    it("should detect effect() in if statement", () => {
      const source = `
        function Counter() {
          if (someCondition) {
            effect(() => {}); // Error!
          }
          return <div>test</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkConditionalPrimitives(ctx, fn.body);
        
        expect(result.valid).toBe(false);
        expect(result.violations[0].kind).toBe("conditional-effect");
      }
    });

    it("should detect state() in for loop", () => {
      const source = `
        function Counter() {
          for (let i = 0; i < 10; i++) {
            const x = state(i); // Error!
          }
          return <div>test</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkConditionalPrimitives(ctx, fn.body);
        
        expect(result.valid).toBe(false);
        expect(result.violations[0].kind).toBe("state-in-loop");
      }
    });

    it("should detect state() in while loop", () => {
      const source = `
        function Counter() {
          while (true) {
            const x = state(0); // Error!
            break;
          }
          return <div>test</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkConditionalPrimitives(ctx, fn.body);
        
        expect(result.valid).toBe(false);
        expect(result.violations[0].kind).toBe("state-in-loop");
      }
    });

    it("should detect state() in ternary expression", () => {
      const source = `
        function Counter() {
          const x = condition ? state(1) : state(2); // Error!
          return <div>test</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkConditionalPrimitives(ctx, fn.body);
        
        expect(result.valid).toBe(false);
        expect(result.violations.length).toBe(2); // Both branches
      }
    });

    it("should allow state() at top level of function", () => {
      const source = `
        function Counter() {
          const count = state(0); // OK
          const name = state("test"); // OK
          return <div>{count}{name}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkConditionalPrimitives(ctx, fn.body);
        
        expect(result.valid).toBe(true);
        expect(result.violations.length).toBe(0);
      }
    });
  });

  describe("checkDirectMutation", () => {
    it("should detect direct assignment to state variable", () => {
      const source = `
        function Counter() {
          const count = state(0);
          count = 5; // Error! Should use count.set(5)
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      const stateVars = new Set(["count"]);
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkDirectMutation(ctx, fn.body, stateVars);
        
        expect(result.valid).toBe(false);
        expect(result.violations[0].kind).toBe("direct-mutation");
      }
    });

    it("should detect increment operator on state variable", () => {
      const source = `
        function Counter() {
          const count = state(0);
          count++; // Error! Should use count.set(v => v + 1)
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      const stateVars = new Set(["count"]);
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkDirectMutation(ctx, fn.body, stateVars);
        
        expect(result.valid).toBe(false);
        expect(result.violations[0].kind).toBe("direct-mutation");
      }
    });

    it("should detect += operator on state variable", () => {
      const source = `
        function Counter() {
          const count = state(0);
          count += 1; // Error!
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      const stateVars = new Set(["count"]);
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkDirectMutation(ctx, fn.body, stateVars);
        
        expect(result.valid).toBe(false);
        expect(result.violations[0].kind).toBe("direct-mutation");
      }
    });

    it("should allow .set() calls", () => {
      const source = `
        function Counter() {
          const count = state(0);
          count.set(5); // OK
          count.set(v => v + 1); // OK
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      const stateVars = new Set(["count"]);
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = checkDirectMutation(ctx, fn.body, stateVars);
        
        expect(result.valid).toBe(true);
        expect(result.violations.length).toBe(0);
      }
    });
  });

  describe("runAllSafetyChecks", () => {
    it("should combine multiple checks", () => {
      const source = `
        function Counter() {
          if (condition) {
            const x = state(0); // Conditional state
          }
          const count = state(0);
          count = 5; // Direct mutation
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      const stateVars = new Set(["count", "x"]);
      
      if (fn && ts.isBlock(fn.body!)) {
        const result = runAllSafetyChecks(ctx, fn.body, stateVars);
        
        expect(result.valid).toBe(false);
        expect(result.violations.length).toBe(2);
      }
    });
  });
});

// Helper to find a function by name
function findFunction(
  sourceFile: ts.SourceFile,
  name: string,
): ts.FunctionDeclaration | undefined {
  let result: ts.FunctionDeclaration | undefined;
  
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return result;
}
