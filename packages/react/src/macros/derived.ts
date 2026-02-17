/**
 * Derived Macro - Computed values from reactive state
 *
 * Transforms `derived(() => computation)` into React's useMemo or computed signals.
 *
 * Usage:
 *   const doubled = derived(() => count * 2);
 *   const filtered = derived(() => items.filter(i => i.includes(query)));
 *
 * Standard React expansion:
 *   const doubled = useMemo(() => __count_val * 2, [__count_val]);
 *
 * The macro:
 * 1. Extracts reactive dependencies from the closure
 * 2. Auto-generates the dependency array
 * 3. Verifies the computation is pure (compile-time error if not)
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "../../../core/registry.js";
import type { MacroContext } from "../../../core/types.js";
import type { ReactMacroMode } from "../types.js";
import {
  extractDependencies,
  generateDependencyArray,
  type StateVariableSet,
} from "../analysis/deps.js";
import {
  verifyPurity,
  reportPurityViolations,
} from "../analysis/purity.js";
import { getStateMetadata } from "./state.js";

/**
 * Module name for import-scoped activation
 */
const MODULE_NAME = "typemacro/react";

/**
 * derived() expression macro
 *
 * Transforms: const x = derived(() => computation)
 * Into: const x = useMemo(() => computation, [deps...])
 */
export const derivedMacro = defineExpressionMacro({
  name: "derived",
  module: MODULE_NAME,
  description: "Create a derived (computed) value from reactive state",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;

    // Validate arguments
    if (args.length !== 1) {
      ctx.reportError(
        callExpr,
        `derived() requires exactly one argument (computation function), got ${args.length}`,
      );
      return callExpr;
    }

    const computation = args[0];

    // Ensure the argument is a function
    if (!ts.isArrowFunction(computation) && !ts.isFunctionExpression(computation)) {
      ctx.reportError(
        callExpr,
        "derived() argument must be an arrow function or function expression",
      );
      return callExpr;
    }

    // Get known state variables from metadata
    const stateMetadata = getStateMetadata(ctx.sourceFile);
    const knownStateVars: StateVariableSet = new Set(stateMetadata.keys());

    // Verify purity
    const purityResult = verifyPurity(
      ctx,
      computation as ts.ArrowFunction | ts.FunctionExpression,
      knownStateVars,
      true, // strict mode
    );

    if (!purityResult.isPure) {
      reportPurityViolations(ctx, purityResult, "derived");
      // Continue with transformation anyway for better error recovery
    }

    // Get dependencies
    const deps = purityResult.dependencies;

    // Get the current mode (default to 'react')
    const mode: ReactMacroMode = "react"; // TODO: Get from config

    if (mode === "fine-grained") {
      // Fine-grained mode: createComputed(() => computation)
      return factory.createCallExpression(
        factory.createIdentifier("createComputed"),
        undefined,
        [computation],
      );
    }

    // Standard React mode: useMemo(() => computation, [deps])

    // Build the state value map for dependency array generation
    const stateValueMap = new Map<string, string>();
    for (const [name, meta] of stateMetadata) {
      stateValueMap.set(name, meta.valueIdent);
    }

    // Rewrite state references in the computation body
    const rewrittenComputation = rewriteStateReferences(
      ctx,
      computation as ts.ArrowFunction | ts.FunctionExpression,
      stateMetadata,
    );

    // Generate dependency array
    const depArray = generateDependencyArray(
      factory,
      deps.reads,
      stateValueMap,
    );

    // Generate: useMemo(() => rewrittenBody, [deps])
    return factory.createCallExpression(
      factory.createIdentifier("useMemo"),
      undefined,
      [rewrittenComputation, depArray],
    );
  },
});

/**
 * Rewrite state variable references in a computation to use value identifiers.
 *
 * `count` -> `__count_val`
 * `count.get()` -> `__count_val`
 */
function rewriteStateReferences(
  ctx: MacroContext,
  computation: ts.ArrowFunction | ts.FunctionExpression,
  stateMetadata: Map<string, { name: string; valueIdent: string; setterIdent: string }>,
): ts.ArrowFunction | ts.FunctionExpression {
  const factory = ctx.factory;

  function transformNode(node: ts.Node): ts.Node {
    // Rewrite stateVar.get() calls to just the value identifier
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "get" &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const varName = node.expression.expression.text;
      const meta = stateMetadata.get(varName);
      if (meta) {
        return factory.createIdentifier(meta.valueIdent);
      }
    }

    // Rewrite direct state variable references (in most contexts)
    if (ts.isIdentifier(node)) {
      const varName = node.text;
      const meta = stateMetadata.get(varName);

      if (meta) {
        // Skip if this is a property name
        if (
          node.parent &&
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.name === node
        ) {
          return node;
        }

        // Skip if this is being declared
        if (
          node.parent &&
          ts.isVariableDeclaration(node.parent) &&
          node.parent.name === node
        ) {
          return node;
        }

        // Skip if this is being accessed for .get() or .set()
        // We handle .get() above, and .set() shouldn't be in derived
        if (
          node.parent &&
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.expression === node
        ) {
          const propName = node.parent.name.text;
          if (propName === "get" || propName === "set" || propName === "update") {
            // Already handled above for .get(), .set()/.update() is an error
            return node;
          }
        }

        // Rewrite to value identifier
        return factory.createIdentifier(meta.valueIdent);
      }
    }

    return ts.visitEachChild(node, transformNode, ctx.transformContext);
  }

  return transformNode(computation) as ts.ArrowFunction | ts.FunctionExpression;
}

// Register the macro
globalRegistry.register(derivedMacro);
