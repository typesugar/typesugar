/**
 * Integration tests for the React macro use-case
 *
 * Tests full transformation pipelines and complex usage patterns.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroTestContext } from "../../../test-utils/macro-context.js";
import { stateMacro, getStateMetadata } from "../macros/state.js";
import { derivedMacro } from "../macros/derived.js";
import { effectMacro } from "../macros/effect.js";
import { componentMacro } from "../macros/component.js";
import { eachMacro, matchMacro } from "../macros/jsx.js";
import { checkConditionalPrimitives, checkDirectMutation } from "../analysis/safety.js";

describe("React macro integration", () => {
  describe("Counter example", () => {
    it("should transform a complete Counter component", () => {
      const source = `
        function Counter() {
          const count = state(0);
          const doubled = derived(() => count * 2);
          
          effect(() => {
            document.title = \`Count: \${count}\`;
          });
          
          return (
            <div>
              <p>Count: {count}, Doubled: {doubled}</p>
              <button onClick={() => count.set(c => c + 1)}>+</button>
            </div>
          );
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "Counter");
      
      // Process all macros
      processAllMacros(ctx);
      
      // Verify state metadata was created
      const metadata = getStateMetadata(ctx.sourceFile);
      expect(metadata.has("count")).toBe(true);
      
      // Verify no errors
      expect(ctx.errors.length).toBe(0);
    });
  });

  describe("Todo list example", () => {
    it("should transform a TodoApp with embedded components", () => {
      const source = `
        function TodoApp() {
          const todos = state<Todo[]>([]);
          const filter = state<"all" | "active" | "done">("all");
          const filtered = derived(() =>
            filter === "all" ? todos : todos.filter(t =>
              filter === "done" ? t.done : !t.done
            )
          );
          
          const TodoItem = component<{ todo: Todo; onToggle: () => void }>(
            ({ todo, onToggle }) => {
              const editing = state(false);
              return <li>{todo.text}</li>;
            }
          );
          
          return (
            <ul>
              {each(filtered, todo => 
                <TodoItem key={todo.id} todo={todo} onToggle={() => {}} />,
                todo => todo.id
              )}
            </ul>
          );
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Process all macros
      processAllMacros(ctx);
      
      // Verify state metadata
      const metadata = getStateMetadata(ctx.sourceFile);
      expect(metadata.has("todos")).toBe(true);
      expect(metadata.has("filter")).toBe(true);
      
      // Should not have errors
      expect(ctx.errors.length).toBe(0);
    });
  });

  describe("Safety checks integration", () => {
    it("should catch all rule violations", () => {
      const source = `
        function BadComponent() {
          if (condition) {
            const x = state(0); // Conditional state
          }
          
          for (const item of items) {
            effect(() => console.log(item)); // Effect in loop
          }
          
          const count = state(0);
          count = 5; // Direct mutation
          
          return <div>{count}</div>;
        }
      `;
      
      const ctx = createMacroTestContext(source);
      const fn = findFunction(ctx.sourceFile, "BadComponent");
      
      if (fn && ts.isBlock(fn.body!)) {
        // Check for conditional primitives
        const conditionalResult = checkConditionalPrimitives(ctx, fn.body);
        expect(conditionalResult.violations.length).toBeGreaterThan(0);
        
        // Check for direct mutation
        const stateVars = new Set(["count", "x"]);
        const mutationResult = checkDirectMutation(ctx, fn.body, stateVars);
        expect(mutationResult.violations.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Pattern matching", () => {
    it("should transform match() for status states", () => {
      const source = `
        function StatusDisplay({ status }: { status: Status }) {
          return (
            <div>
              {match(status, {
                loading: () => <Spinner />,
                error: (e) => <Error message={e.message} />,
                success: (data) => <Data rows={data} />,
              })}
            </div>
          );
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Find the match() call
      const matchCalls = findAllCalls(ctx.sourceFile, "match");
      expect(matchCalls.length).toBe(1);
      
      // Transform it
      const result = matchMacro.expand(ctx, matchCalls[0], [...matchCalls[0].arguments]);
      
      // Should produce a conditional expression
      expect(ts.isConditionalExpression(result)).toBe(true);
    });
  });

  describe("Keyed iteration", () => {
    it("should transform each() to map with keys", () => {
      const source = `
        function List({ items }) {
          return (
            <ul>
              {each(items, item => <li>{item.name}</li>, item => item.id)}
            </ul>
          );
        }
      `;
      
      const ctx = createMacroTestContext(source);
      
      // Find the each() call
      const eachCalls = findAllCalls(ctx.sourceFile, "each");
      expect(eachCalls.length).toBe(1);
      
      // Transform it
      const result = eachMacro.expand(ctx, eachCalls[0], [...eachCalls[0].arguments]);
      
      // Should produce items.map(...)
      expect(ts.isCallExpression(result)).toBe(true);
      if (ts.isCallExpression(result)) {
        expect(ts.isPropertyAccessExpression(result.expression)).toBe(true);
        const propAccess = result.expression as ts.PropertyAccessExpression;
        expect(propAccess.name.text).toBe("map");
      }
    });
  });
});

// Helpers

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

function processAllMacros(ctx: ReturnType<typeof createMacroTestContext>): void {
  // Process state() calls
  const stateCalls = findAllCalls(ctx.sourceFile, "state");
  for (const call of stateCalls) {
    stateMacro.expand(ctx, call, [...call.arguments]);
  }
  
  // Process derived() calls
  const derivedCalls = findAllCalls(ctx.sourceFile, "derived");
  for (const call of derivedCalls) {
    derivedMacro.expand(ctx, call, [...call.arguments]);
  }
  
  // Process effect() calls
  const effectCalls = findAllCalls(ctx.sourceFile, "effect");
  for (const call of effectCalls) {
    effectMacro.expand(ctx, call, [...call.arguments]);
  }
  
  // Process component() calls
  const componentCalls = findAllCalls(ctx.sourceFile, "component");
  for (const call of componentCalls) {
    componentMacro.expand(ctx, call, [...call.arguments]);
  }
  
  // Process each() calls
  const eachCalls = findAllCalls(ctx.sourceFile, "each");
  for (const call of eachCalls) {
    eachMacro.expand(ctx, call, [...call.arguments]);
  }
  
  // Process match() calls
  const matchCalls = findAllCalls(ctx.sourceFile, "match");
  for (const call of matchCalls) {
    matchMacro.expand(ctx, call, [...call.arguments]);
  }
}
