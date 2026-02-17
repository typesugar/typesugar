/**
 * Component Macro - Embedded component definitions
 *
 * Transforms inline component definitions into hoisted, memoized React components.
 * This solves the anti-pattern of defining components inside other components.
 *
 * Usage:
 *   function Parent() {
 *     const count = state(0);
 *
 *     const Child = component<{ value: number }>(({ value }) => {
 *       const local = state(false);
 *       return <div>{value}</div>;
 *     });
 *
 *     return <Child value={count} />;
 *   }
 *
 * Expansion:
 *   // Hoisted to module level
 *   const Child = React.memo(function Child({ value }: { value: number }) {
 *     const [__local_val, __local_set] = useState(false);
 *     return <div>{value}</div>;
 *   });
 *
 *   function Parent() {
 *     const [__count_val, __count_set] = useState(0);
 *     return <Child value={__count_val} />;
 *   }
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry } from "../../../core/registry.js";
import type { MacroContext } from "../../../core/types.js";
import type { ReactMacroMode } from "../types.js";
import {
  analyzeClosureCaptures,
  findParentScopeVariables,
  generateCaptureProps,
  rewriteCaptureReferences,
} from "../analysis/closure.js";
import { findStateDeclarations } from "../analysis/deps.js";
import { getStateMetadata, type StateMetadata } from "./state.js";

/**
 * Module name for import-scoped activation
 */
const MODULE_NAME = "typemacro/react";

/**
 * Metadata for hoisted components
 */
export interface HoistedComponent {
  /** Generated component name */
  name: string;
  /** Props type (from generic parameter) */
  propsType: ts.TypeNode | undefined;
  /** The component function body */
  body: ts.ArrowFunction | ts.FunctionExpression;
  /** Captured variables that need to be props */
  capturedProps: string[];
  /** The original call expression (for source mapping) */
  originalNode: ts.CallExpression;
}

/**
 * Per-file tracking of hoisted components
 */
export const hoistedComponentsMap = new WeakMap<ts.SourceFile, HoistedComponent[]>();

/**
 * Get or create the hoisted components array for a source file
 */
export function getHoistedComponents(sourceFile: ts.SourceFile): HoistedComponent[] {
  let arr = hoistedComponentsMap.get(sourceFile);
  if (!arr) {
    arr = [];
    hoistedComponentsMap.set(sourceFile, arr);
  }
  return arr;
}

/**
 * Counter for generating unique component names when needed
 */
let componentCounter = 0;

/**
 * component() expression macro
 *
 * Transforms: const X = component<Props>(renderFn)
 * Into: A marker that triggers hoisting + React.memo wrapping
 */
export const componentMacro = defineExpressionMacro({
  name: "component",
  module: MODULE_NAME,
  description: "Define an embedded component that is hoisted and memoized",

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
        `component() requires exactly one argument (render function), got ${args.length}`,
      );
      return callExpr;
    }

    const renderFn = args[0];

    // Ensure the argument is a function
    if (!ts.isArrowFunction(renderFn) && !ts.isFunctionExpression(renderFn)) {
      ctx.reportError(
        callExpr,
        "component() argument must be an arrow function or function expression",
      );
      return callExpr;
    }

    // Get the component name from the parent variable declaration
    const componentName = getComponentNameFromCall(callExpr);
    const finalName = componentName ?? `__AnonymousComponent_${++componentCounter}`;

    // Get props type from type argument if provided
    let propsType: ts.TypeNode | undefined;
    if (callExpr.typeArguments && callExpr.typeArguments.length > 0) {
      propsType = callExpr.typeArguments[0];
    }

    // Find the parent function to analyze scope
    const parentFn = findParentFunction(callExpr);
    let parentScopeVars = new Set<string>();
    let parentStateVars = new Set<string>();

    if (parentFn && ts.isBlock(parentFn.body)) {
      parentScopeVars = findParentScopeVariables(parentFn.body);
      parentStateVars = findStateDeclarations(parentFn.body);
    }

    // Analyze closure captures
    const captureAnalysis = analyzeClosureCaptures(
      ctx,
      renderFn as ts.ArrowFunction | ts.FunctionExpression,
      parentStateVars,
      parentScopeVars,
    );

    if (!captureAnalysis.canHoist) {
      ctx.reportError(
        callExpr,
        `Cannot hoist component: ${captureAnalysis.hoistBlocker}`,
      );
      return callExpr;
    }

    // Store hoisted component info
    const hoisted = getHoistedComponents(ctx.sourceFile);
    hoisted.push({
      name: finalName,
      propsType,
      body: renderFn as ts.ArrowFunction | ts.FunctionExpression,
      capturedProps: captureAnalysis.captures
        .filter((c) => c.needsProp)
        .map((c) => c.name),
      originalNode: callExpr,
    });

    // Get the current mode (default to 'react')
    const mode: ReactMacroMode = "react"; // TODO: Get from config

    // Return a marker object that will be processed by the transformer
    // The actual component definition will be hoisted to module level
    return factory.createObjectLiteralExpression([
      // Marker
      factory.createPropertyAssignment(
        factory.createIdentifier("__typemacro_component"),
        factory.createTrue(),
      ),
      // Component name
      factory.createPropertyAssignment(
        factory.createIdentifier("__name"),
        factory.createStringLiteral(finalName),
      ),
      // Captured props (for JSX usage transformation)
      factory.createPropertyAssignment(
        factory.createIdentifier("__capturedProps"),
        factory.createArrayLiteralExpression(
          captureAnalysis.captures
            .filter((c) => c.needsProp)
            .map((c) => factory.createStringLiteral(c.name)),
        ),
      ),
    ]);
  },
});

/**
 * Get the component name from a call expression in a variable declaration.
 */
function getComponentNameFromCall(callExpr: ts.CallExpression): string | null {
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
 * Find the parent function containing a node
 */
function findParentFunction(
  node: ts.Node,
): ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Generate a hoisted React.memo component declaration
 */
export function generateHoistedComponent(
  ctx: MacroContext,
  component: HoistedComponent,
  stateMetadata: Map<string, StateMetadata>,
): ts.VariableStatement {
  const factory = ctx.factory;

  // Get the render function body
  const renderFn = component.body;

  // Create the props parameter with type annotation
  const propsParam = factory.createParameterDeclaration(
    undefined,
    undefined,
    factory.createObjectBindingPattern(
      getPropsBindings(renderFn, factory),
    ),
    undefined,
    component.propsType,
    undefined,
  );

  // Create the inner function
  const innerFn = factory.createFunctionExpression(
    undefined,
    undefined,
    factory.createIdentifier(component.name),
    undefined,
    [propsParam],
    undefined,
    ts.isBlock(renderFn.body)
      ? renderFn.body
      : factory.createBlock([factory.createReturnStatement(renderFn.body)]),
  );

  // Wrap in React.memo
  const memoizedComponent = factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier("React"),
      factory.createIdentifier("memo"),
    ),
    undefined,
    [innerFn],
  );

  // Create the variable declaration
  return factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [
        factory.createVariableDeclaration(
          factory.createIdentifier(component.name),
          undefined,
          undefined,
          memoizedComponent,
        ),
      ],
      ts.NodeFlags.Const,
    ),
  );
}

/**
 * Extract props bindings from a render function
 */
function getPropsBindings(
  renderFn: ts.ArrowFunction | ts.FunctionExpression,
  factory: ts.NodeFactory,
): ts.BindingElement[] {
  const params = renderFn.parameters;
  if (params.length === 0) {
    return [];
  }

  const firstParam = params[0];
  if (ts.isObjectBindingPattern(firstParam.name)) {
    return [...firstParam.name.elements];
  }

  // If it's a simple identifier, we need to create bindings from the type
  // For now, return empty and let TypeScript infer
  return [];
}

/**
 * Check if an expression is a component marker object
 */
export function isComponentMarker(expr: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(expr)) {
    return false;
  }

  return expr.properties.some(
    (prop) =>
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "__typemacro_component",
  );
}

/**
 * Extract component name from a marker object
 */
export function extractComponentFromMarker(
  expr: ts.ObjectLiteralExpression,
): { name: string; capturedProps: string[] } | null {
  let name: string | undefined;
  let capturedProps: string[] = [];

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
      case "__capturedProps":
        if (ts.isArrayLiteralExpression(prop.initializer)) {
          capturedProps = prop.initializer.elements
            .filter(ts.isStringLiteral)
            .map((s) => s.text);
        }
        break;
    }
  }

  if (name) {
    return { name, capturedProps };
  }
  return null;
}

// Register the macro
globalRegistry.register(componentMacro);
