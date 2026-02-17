/**
 * State Macro - Reactive state primitive
 *
 * Transforms `state(initialValue)` into React's useState or signals.
 *
 * Usage:
 *   const count = state(0);
 *   count.set(1);
 *   count.set(c => c + 1);
 *
 * Standard React expansion:
 *   const [__count_val, __count_set] = useState(0);
 *   // References to `count` in JSX become `__count_val`
 *   // Calls to `count.set()` become `__count_set()`
 *
 * Fine-grained expansion:
 *   const count = createSignal(0);
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "../../../core/registry.js";
import type { MacroContext } from "../../../core/types.js";
import type { ReactMacroMode } from "../types.js";

/**
 * Module name for import-scoped activation
 */
const MODULE_NAME = "typemacro/react";

/**
 * Metadata attached to state declarations for use by other macros
 */
export interface StateMetadata {
  /** Original variable name */
  name: string;
  /** Generated value identifier */
  valueIdent: string;
  /** Generated setter identifier */
  setterIdent: string;
  /** Initial value expression */
  initialValue: ts.Expression;
}

/**
 * Per-file state tracking (populated during transformation)
 */
export const stateMetadataMap = new WeakMap<ts.SourceFile, Map<string, StateMetadata>>();

/**
 * Get or create the state metadata map for a source file
 */
export function getStateMetadata(sourceFile: ts.SourceFile): Map<string, StateMetadata> {
  let map = stateMetadataMap.get(sourceFile);
  if (!map) {
    map = new Map();
    stateMetadataMap.set(sourceFile, map);
  }
  return map;
}

/**
 * state() expression macro
 *
 * Transforms: const x = state(initialValue)
 * Into: const [__x_val, __x_set] = useState(initialValue)
 */
export const stateMacro = defineExpressionMacro({
  name: "state",
  module: MODULE_NAME,
  description: "Create reactive state (like Vue ref() or Svelte $state)",

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
        `state() requires exactly one argument (initial value), got ${args.length}`,
      );
      return callExpr;
    }

    const initialValue = args[0];

    // Get the variable name from the parent variable declaration
    const varName = getVariableNameFromCall(callExpr);
    if (!varName) {
      ctx.reportError(
        callExpr,
        "state() must be used in a variable declaration: const x = state(value)",
      );
      return callExpr;
    }

    // Generate unique identifiers for value and setter
    const valueIdent = `__${varName}_val`;
    const setterIdent = `__${varName}_set`;

    // Store metadata for use by other macros
    const metadata: StateMetadata = {
      name: varName,
      valueIdent,
      setterIdent,
      initialValue,
    };
    getStateMetadata(ctx.sourceFile).set(varName, metadata);

    // Get the current mode from config (default to 'react')
    const mode: ReactMacroMode = "react"; // TODO: Get from config

    if (mode === "fine-grained") {
      // Fine-grained mode: createSignal(initialValue)
      return factory.createCallExpression(
        factory.createIdentifier("createSignal"),
        undefined,
        [initialValue],
      );
    }

    // Standard React mode:
    // We can't directly return a destructuring, so we return an object
    // that has .get() and .set() methods that will be rewritten later.
    //
    // The actual useState transformation happens at the statement level
    // in the transformer. Here we just return a marker that indicates
    // this is a state variable.
    //
    // Actually, let's generate a helper that creates the state object:
    // { get: () => __x_val, set: __x_set, update: (fn) => __x_set(fn) }

    // For now, return an IIFE that will be processed by the statement transformer
    // This is a marker pattern - the real transformation happens elsewhere
    return factory.createObjectLiteralExpression([
      // __typemacro_state marker
      factory.createPropertyAssignment(
        factory.createIdentifier("__typemacro_state"),
        factory.createTrue(),
      ),
      // Original variable name
      factory.createPropertyAssignment(
        factory.createIdentifier("__name"),
        factory.createStringLiteral(varName),
      ),
      // Value identifier
      factory.createPropertyAssignment(
        factory.createIdentifier("__valueIdent"),
        factory.createStringLiteral(valueIdent),
      ),
      // Setter identifier
      factory.createPropertyAssignment(
        factory.createIdentifier("__setterIdent"),
        factory.createStringLiteral(setterIdent),
      ),
      // Initial value (wrapped in a function to preserve the expression)
      factory.createPropertyAssignment(
        factory.createIdentifier("__init"),
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          initialValue,
        ),
      ),
    ]);
  },
});

/**
 * Get the variable name from a call expression in a variable declaration.
 * Returns null if the call is not in a variable declaration.
 */
function getVariableNameFromCall(callExpr: ts.CallExpression): string | null {
  // Walk up to find VariableDeclaration
  let node: ts.Node = callExpr;
  while (node.parent) {
    if (ts.isVariableDeclaration(node.parent)) {
      const decl = node.parent;
      if (ts.isIdentifier(decl.name)) {
        return decl.name.text;
      }
      return null;
    }
    node = node.parent;
  }
  return null;
}

/**
 * Check if a node is a state variable reference
 */
export function isStateVariable(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): StateMetadata | null {
  if (!ts.isIdentifier(node)) {
    return null;
  }

  const metadata = getStateMetadata(sourceFile);
  return metadata.get(node.text) ?? null;
}

/**
 * Rewrite a state variable reference to use the value identifier.
 *
 * In JSX: {count} -> {__count_val}
 */
export function rewriteStateRead(
  factory: ts.NodeFactory,
  metadata: StateMetadata,
): ts.Identifier {
  return factory.createIdentifier(metadata.valueIdent);
}

/**
 * Rewrite a state setter call to use the setter function.
 *
 * count.set(5) -> __count_set(5)
 * count.set(c => c + 1) -> __count_set(c => c + 1)
 * count.update(c => c + 1) -> __count_set(c => c + 1)
 */
export function rewriteStateSetter(
  factory: ts.NodeFactory,
  metadata: StateMetadata,
  args: readonly ts.Expression[],
): ts.CallExpression {
  return factory.createCallExpression(
    factory.createIdentifier(metadata.setterIdent),
    undefined,
    [...args],
  );
}

/**
 * Generate the useState destructuring statement for a state variable.
 *
 * const [__x_val, __x_set] = useState(initialValue);
 */
export function generateUseStateDeclaration(
  factory: ts.NodeFactory,
  metadata: StateMetadata,
): ts.VariableStatement {
  return factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [
        factory.createVariableDeclaration(
          factory.createArrayBindingPattern([
            factory.createBindingElement(
              undefined,
              undefined,
              factory.createIdentifier(metadata.valueIdent),
            ),
            factory.createBindingElement(
              undefined,
              undefined,
              factory.createIdentifier(metadata.setterIdent),
            ),
          ]),
          undefined,
          undefined,
          factory.createCallExpression(
            factory.createIdentifier("useState"),
            undefined,
            [metadata.initialValue],
          ),
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}

/**
 * Check if an expression is a state marker object (from macro expansion)
 */
export function isStateMarker(expr: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(expr)) {
    return false;
  }

  return expr.properties.some(
    (prop) =>
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "__typemacro_state",
  );
}

/**
 * Extract state metadata from a marker object
 */
export function extractStateFromMarker(
  expr: ts.ObjectLiteralExpression,
): { name: string; valueIdent: string; setterIdent: string; initExpr: ts.Expression } | null {
  let name: string | undefined;
  let valueIdent: string | undefined;
  let setterIdent: string | undefined;
  let initExpr: ts.Expression | undefined;

  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
      continue;
    }

    switch (prop.name.text) {
      case "__name":
        if (ts.isStringLiteral(prop.initializer)) {
          name = prop.initializer.text;
        }
        break;
      case "__valueIdent":
        if (ts.isStringLiteral(prop.initializer)) {
          valueIdent = prop.initializer.text;
        }
        break;
      case "__setterIdent":
        if (ts.isStringLiteral(prop.initializer)) {
          setterIdent = prop.initializer.text;
        }
        break;
      case "__init":
        if (ts.isArrowFunction(prop.initializer)) {
          initExpr = prop.initializer.body as ts.Expression;
        }
        break;
    }
  }

  if (name && valueIdent && setterIdent && initExpr) {
    return { name, valueIdent, setterIdent, initExpr };
  }
  return null;
}

// Register the macro
globalRegistry.register(stateMacro);
