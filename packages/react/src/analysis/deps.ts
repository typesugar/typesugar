/**
 * Dependency Extraction for React Macros
 *
 * Analyzes closures to extract reactive dependencies (state reads/writes).
 * Used by `derived()` and `effect()` macros to auto-generate dependency arrays.
 *
 * The analysis walks the AST looking for:
 * 1. State variable reads (identifiers that resolve to state())
 * 2. State variable writes (calls to .set() or .update())
 * 3. External function calls (potential side effects)
 */

import * as ts from "typescript";
import type { MacroContext } from "../../../core/types.js";
import type { DependencyInfo, SideEffect } from "../types.js";

/**
 * Set of known state variable names in the current scope.
 * Populated by the macro transformer as it processes state() calls.
 */
export type StateVariableSet = Set<string>;

/**
 * Extract dependency information from a closure (arrow function or function expression).
 *
 * @param ctx - Macro context with type checker
 * @param closure - The closure to analyze
 * @param knownStateVars - Set of variable names known to be state()
 * @returns Dependency information
 */
export function extractDependencies(
  ctx: MacroContext,
  closure: ts.ArrowFunction | ts.FunctionExpression,
  knownStateVars: StateVariableSet,
): DependencyInfo {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const captures = new Set<string>();
  const sideEffects: SideEffect[] = [];

  // Track local variables declared inside the closure
  const localVars = new Set<string>();

  function visit(node: ts.Node): void {
    // Track local variable declarations
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      localVars.add(node.name.text);
    }

    // Track function parameters as local
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      localVars.add(node.name.text);
    }

    // Check for state reads (identifier references)
    if (ts.isIdentifier(node)) {
      const name = node.text;

      // Skip if it's a local variable
      if (localVars.has(name)) {
        return;
      }

      // Skip property access names (the identifier after the dot)
      if (
        node.parent &&
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node
      ) {
        return;
      }

      // Skip if it's being declared
      if (
        node.parent &&
        ts.isVariableDeclaration(node.parent) &&
        node.parent.name === node
      ) {
        return;
      }

      // Check if this is a known state variable
      if (knownStateVars.has(name)) {
        reads.add(name);
      } else {
        // It's a captured variable from outer scope
        captures.add(name);
      }
    }

    // Check for state writes (.set() or .update() calls)
    if (ts.isCallExpression(node)) {
      const expr = node.expression;

      if (ts.isPropertyAccessExpression(expr)) {
        const methodName = expr.name.text;
        const object = expr.expression;

        // Check for stateVar.set() or stateVar.update()
        if (
          (methodName === "set" || methodName === "update") &&
          ts.isIdentifier(object) &&
          knownStateVars.has(object.text)
        ) {
          writes.add(object.text);
          sideEffects.push({
            kind: "state-mutation",
            description: `${object.text}.${methodName}()`,
            ...getLocation(node, ctx.sourceFile),
          });
        }

        // Check for DOM mutations
        if (
          ts.isIdentifier(object) &&
          (object.text === "document" || object.text === "window")
        ) {
          sideEffects.push({
            kind: "dom-mutation",
            description: `${object.text}.${methodName}()`,
            ...getLocation(node, ctx.sourceFile),
          });
        }

        // Check for console calls
        if (ts.isIdentifier(object) && object.text === "console") {
          sideEffects.push({
            kind: "console",
            description: `console.${methodName}()`,
            ...getLocation(node, ctx.sourceFile),
          });
        }
      }

      // Check for fetch calls
      if (ts.isIdentifier(expr) && expr.text === "fetch") {
        sideEffects.push({
          kind: "fetch",
          description: "fetch()",
          ...getLocation(node, ctx.sourceFile),
        });
      }

      // Check for timer calls
      if (
        ts.isIdentifier(expr) &&
        (expr.text === "setTimeout" || expr.text === "setInterval")
      ) {
        sideEffects.push({
          kind: "timer",
          description: `${expr.text}()`,
          ...getLocation(node, ctx.sourceFile),
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  // Visit the closure body
  visit(closure.body);

  // A closure is pure if it has no writes and no side effects
  const isPure = writes.size === 0 && sideEffects.length === 0;

  return {
    reads,
    writes,
    captures,
    isPure,
    sideEffects,
  };
}

/**
 * Get source location for a node
 */
function getLocation(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): { line?: number; column?: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { line: line + 1, column: character + 1 };
}

/**
 * Generate a dependency array expression from a set of state variable names.
 *
 * @param factory - TypeScript node factory
 * @param deps - Set of dependency names
 * @param stateValueMap - Map from state variable name to its value identifier (e.g., "count" -> "__count_val")
 * @returns Array literal expression for use in useMemo/useEffect
 */
export function generateDependencyArray(
  factory: ts.NodeFactory,
  deps: Set<string>,
  stateValueMap: Map<string, string>,
): ts.ArrayLiteralExpression {
  const elements: ts.Identifier[] = [];

  for (const dep of deps) {
    // Use the value identifier if we have a mapping, otherwise use the name directly
    const valueIdent = stateValueMap.get(dep) ?? dep;
    elements.push(factory.createIdentifier(valueIdent));
  }

  return factory.createArrayLiteralExpression(elements);
}

/**
 * Check if an expression is a state getter call (stateVar.get() or just stateVar in JSX).
 */
export function isStateGetter(
  node: ts.Node,
  knownStateVars: StateVariableSet,
): { varName: string } | null {
  // Direct identifier reference (in JSX expressions)
  if (ts.isIdentifier(node) && knownStateVars.has(node.text)) {
    return { varName: node.text };
  }

  // Explicit .get() call
  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    if (
      ts.isPropertyAccessExpression(expr) &&
      expr.name.text === "get" &&
      ts.isIdentifier(expr.expression) &&
      knownStateVars.has(expr.expression.text)
    ) {
      return { varName: expr.expression.text };
    }
  }

  return null;
}

/**
 * Check if an expression is a state setter call (stateVar.set() or stateVar.update()).
 */
export function isStateSetter(
  node: ts.Node,
  knownStateVars: StateVariableSet,
): { varName: string; method: "set" | "update" } | null {
  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) {
      const methodName = expr.name.text;
      const object = expr.expression;

      if (
        (methodName === "set" || methodName === "update") &&
        ts.isIdentifier(object) &&
        knownStateVars.has(object.text)
      ) {
        return { varName: object.text, method: methodName };
      }
    }
  }

  return null;
}

/**
 * Find all state variable declarations in a function body.
 * Looks for patterns like: `const x = state(initialValue)`
 *
 * @param body - Function body to search
 * @returns Set of state variable names
 */
export function findStateDeclarations(
  body: ts.Block | ts.ConciseBody,
): StateVariableSet {
  const stateVars = new Set<string>();

  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callExpr = node.initializer;
      if (ts.isIdentifier(callExpr.expression)) {
        const fnName = callExpr.expression.text;
        if (fnName === "state") {
          stateVars.add(node.name.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  if (ts.isBlock(body)) {
    ts.forEachChild(body, visit);
  }

  return stateVars;
}
