/**
 * Effect and Watch Macros - Side effects in response to state changes
 *
 * effect() - Auto-detects dependencies and runs side effects
 * watch() - Explicitly specified dependencies
 *
 * Usage:
 *   effect(() => {
 *     document.title = `Count: ${count}`;
 *   });
 *
 *   effect(() => {
 *     const controller = new AbortController();
 *     fetchData(query, controller.signal);
 *     return () => controller.abort(); // cleanup
 *   });
 *
 *   watch([userId], (newId) => {
 *     profile.set(await fetchProfile(newId));
 *   });
 *
 * Standard React expansion:
 *   useEffect(() => {
 *     document.title = `Count: ${__count_val}`;
 *   }, [__count_val]);
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
  shouldBeDerived,
  checkEffectCleanup,
} from "../analysis/purity.js";
import { getStateMetadata } from "./state.js";

/**
 * Module name for import-scoped activation
 */
const MODULE_NAME = "typemacro/react";

/**
 * effect() expression macro
 *
 * Transforms: effect(() => { sideEffect })
 * Into: useEffect(() => { sideEffect }, [autoDeps])
 */
export const effectMacro = defineExpressionMacro({
  name: "effect",
  module: MODULE_NAME,
  description: "Run side effects when reactive state changes",

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
        `effect() requires exactly one argument (effect function), got ${args.length}`,
      );
      return callExpr;
    }

    const effectFn = args[0];

    // Ensure the argument is a function
    if (!ts.isArrowFunction(effectFn) && !ts.isFunctionExpression(effectFn)) {
      ctx.reportError(
        callExpr,
        "effect() argument must be an arrow function or function expression",
      );
      return callExpr;
    }

    // Get known state variables from metadata
    const stateMetadata = getStateMetadata(ctx.sourceFile);
    const knownStateVars: StateVariableSet = new Set(stateMetadata.keys());

    // Extract dependencies
    const deps = extractDependencies(
      ctx,
      effectFn as ts.ArrowFunction | ts.FunctionExpression,
      knownStateVars,
    );

    // Check if this should be a derived() instead (warning)
    const derivedCheck = shouldBeDerived(deps);
    if (derivedCheck.shouldWarn) {
      ctx.reportWarning(callExpr, `[effect] ${derivedCheck.reason}`);
    }

    // Check for cleanup requirements
    const cleanupCheck = checkEffectCleanup(
      effectFn as ts.ArrowFunction | ts.FunctionExpression,
    );
    for (const resource of cleanupCheck) {
      if (resource.needsCleanup && !resource.hasCleanup) {
        ctx.reportWarning(
          callExpr,
          `[effect] ${resource.resource} should have a cleanup function. Return a cleanup function from the effect.`,
        );
      }
    }

    // Get the current mode (default to 'react')
    const mode: ReactMacroMode = "react"; // TODO: Get from config

    if (mode === "fine-grained") {
      // Fine-grained mode: createEffect(() => { ... })
      const rewrittenEffectFn = rewriteStateReferencesInEffect(
        ctx,
        effectFn as ts.ArrowFunction | ts.FunctionExpression,
        stateMetadata,
      );
      return factory.createCallExpression(
        factory.createIdentifier("createEffect"),
        undefined,
        [rewrittenEffectFn],
      );
    }

    // Standard React mode: useEffect(() => { ... }, [deps])

    // Build the state value map for dependency array generation
    const stateValueMap = new Map<string, string>();
    for (const [name, meta] of stateMetadata) {
      stateValueMap.set(name, meta.valueIdent);
    }

    // Rewrite state references in the effect body
    const rewrittenEffectFn = rewriteStateReferencesInEffect(
      ctx,
      effectFn as ts.ArrowFunction | ts.FunctionExpression,
      stateMetadata,
    );

    // Generate dependency array
    const depArray = generateDependencyArray(
      factory,
      deps.reads,
      stateValueMap,
    );

    // Generate: useEffect(() => { ... }, [deps])
    return factory.createCallExpression(
      factory.createIdentifier("useEffect"),
      undefined,
      [rewrittenEffectFn, depArray],
    );
  },
});

/**
 * watch() expression macro - explicitly specified dependencies
 *
 * Transforms: watch([dep1, dep2], (val1, val2) => { ... })
 * Into: useEffect(() => { const val1 = dep1; const val2 = dep2; ... }, [dep1, dep2])
 */
export const watchMacro = defineExpressionMacro({
  name: "watch",
  module: MODULE_NAME,
  description: "Run side effects with explicit dependencies (like Vue watch)",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;

    // Validate arguments
    if (args.length !== 2) {
      ctx.reportError(
        callExpr,
        `watch() requires exactly two arguments (deps array, effect function), got ${args.length}`,
      );
      return callExpr;
    }

    const [depsArg, effectFn] = args;

    // Ensure first argument is an array
    if (!ts.isArrayLiteralExpression(depsArg)) {
      ctx.reportError(
        callExpr,
        "watch() first argument must be an array literal of dependencies",
      );
      return callExpr;
    }

    // Ensure second argument is a function
    if (!ts.isArrowFunction(effectFn) && !ts.isFunctionExpression(effectFn)) {
      ctx.reportError(
        callExpr,
        "watch() second argument must be an arrow function or function expression",
      );
      return callExpr;
    }

    // Get known state variables from metadata
    const stateMetadata = getStateMetadata(ctx.sourceFile);

    // Build the state value map
    const stateValueMap = new Map<string, string>();
    for (const [name, meta] of stateMetadata) {
      stateValueMap.set(name, meta.valueIdent);
    }

    // Get the current mode (default to 'react')
    const mode: ReactMacroMode = "react"; // TODO: Get from config

    // Extract dependency names and create the dependency array
    const depNames: string[] = [];
    const depElements: ts.Expression[] = [];

    for (const elem of depsArg.elements) {
      if (ts.isIdentifier(elem)) {
        const name = elem.text;
        depNames.push(name);

        // Use value identifier if this is a state variable
        const valueIdent = stateValueMap.get(name);
        if (valueIdent) {
          depElements.push(factory.createIdentifier(valueIdent));
        } else {
          depElements.push(factory.createIdentifier(name));
        }
      } else {
        ctx.reportError(
          elem,
          "watch() dependency must be an identifier",
        );
        depElements.push(elem);
      }
    }

    if (mode === "fine-grained") {
      // Fine-grained mode: createEffect with explicit deps
      // For now, just wrap the effect
      const rewrittenEffectFn = rewriteStateReferencesInEffect(
        ctx,
        effectFn as ts.ArrowFunction | ts.FunctionExpression,
        stateMetadata,
      );
      return factory.createCallExpression(
        factory.createIdentifier("createEffect"),
        undefined,
        [rewrittenEffectFn],
      );
    }

    // Standard React mode: useEffect

    // Rewrite state references in the effect body
    const rewrittenEffectFn = rewriteStateReferencesInEffect(
      ctx,
      effectFn as ts.ArrowFunction | ts.FunctionExpression,
      stateMetadata,
    );

    // Create dependency array
    const depArray = factory.createArrayLiteralExpression(depElements);

    // Generate: useEffect(() => { ... }, [deps])
    return factory.createCallExpression(
      factory.createIdentifier("useEffect"),
      undefined,
      [rewrittenEffectFn, depArray],
    );
  },
});

/**
 * Rewrite state variable references in an effect function.
 *
 * `count` -> `__count_val`
 * `count.get()` -> `__count_val`
 * `count.set(x)` -> `__count_set(x)`
 */
function rewriteStateReferencesInEffect(
  ctx: MacroContext,
  effectFn: ts.ArrowFunction | ts.FunctionExpression,
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

    // Rewrite stateVar.set() and stateVar.update() calls
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const methodName = node.expression.name.text;
      const obj = node.expression.expression;

      if (
        (methodName === "set" || methodName === "update") &&
        ts.isIdentifier(obj)
      ) {
        const meta = stateMetadata.get(obj.text);
        if (meta) {
          // Transform args recursively first
          const transformedArgs = node.arguments.map((arg) =>
            ts.visitNode(arg, transformNode) as ts.Expression,
          );
          return factory.createCallExpression(
            factory.createIdentifier(meta.setterIdent),
            undefined,
            transformedArgs,
          );
        }
      }
    }

    // Rewrite direct state variable references
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

        // Skip if this is being accessed for a method call
        if (
          node.parent &&
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.expression === node
        ) {
          // We handle .get()/.set()/.update() above
          return node;
        }

        // Rewrite to value identifier
        return factory.createIdentifier(meta.valueIdent);
      }
    }

    return ts.visitEachChild(node, transformNode, ctx.transformContext);
  }

  return transformNode(effectFn) as ts.ArrowFunction | ts.FunctionExpression;
}

// Register the macros
globalRegistry.register(effectMacro);
globalRegistry.register(watchMacro);
