/**
 * Closure Capture Analysis for React Macros
 *
 * Analyzes closures used in `component()` to determine:
 * 1. What variables from the parent scope are captured
 * 2. Which captures are state variables (need special handling)
 * 3. Which captures are setters (need to be threaded as props)
 * 4. How to thread captured variables as props when hoisting
 *
 * This enables the `component()` macro to hoist embedded components
 * to module level while correctly handling closure captures.
 */

import * as ts from "typescript";
import type { MacroContext } from "../../../core/types.js";
import type { ClosureCapture } from "../types.js";
import { type StateVariableSet } from "./deps.js";

/**
 * Result of closure capture analysis
 */
export interface ClosureAnalysisResult {
  /** All captured variables */
  captures: ClosureCapture[];

  /** State variables that are read */
  stateReads: string[];

  /** State setters that are captured */
  stateSetters: string[];

  /** Non-state captures (functions, constants, etc.) */
  otherCaptures: string[];

  /** Whether this closure can be safely hoisted */
  canHoist: boolean;

  /** Reason if cannot hoist */
  hoistBlocker?: string;
}

/**
 * Analyze closure captures in a component render function.
 *
 * @param ctx - Macro context
 * @param closure - The render function closure
 * @param knownStateVars - State variables in the parent scope
 * @param parentScopeVars - All variables declared in the parent scope
 * @returns Analysis result with capture information
 */
export function analyzeClosureCaptures(
  ctx: MacroContext,
  closure: ts.ArrowFunction | ts.FunctionExpression,
  knownStateVars: StateVariableSet,
  parentScopeVars: Set<string>,
): ClosureAnalysisResult {
  const captures: ClosureCapture[] = [];
  const capturedNames = new Set<string>();

  // Track local variables declared inside the closure
  const localVars = new Set<string>();

  // Track parameters
  const params = new Set<string>();

  // First pass: collect local declarations and parameters
  function collectLocals(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      localVars.add(node.name.text);
    }

    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      params.add(node.name.text);
    }

    // Handle destructuring in parameters
    if (ts.isParameter(node) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
          params.add(element.name.text);
        }
      }
    }

    // Handle destructuring in variable declarations
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
          localVars.add(element.name.text);
        }
      }
    }

    ts.forEachChild(node, collectLocals);
  }

  collectLocals(closure);

  // Second pass: find captured variables
  function findCaptures(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const name = node.text;

      // Skip local variables and parameters
      if (localVars.has(name) || params.has(name)) {
        return;
      }

      // Skip if it's a property name in property access
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

      // Skip type-only references
      if (node.parent && ts.isTypeReferenceNode(node.parent)) {
        return;
      }

      // Skip import specifiers
      if (node.parent && ts.isImportSpecifier(node.parent)) {
        return;
      }

      // Check if this is from parent scope
      if (parentScopeVars.has(name) && !capturedNames.has(name)) {
        capturedNames.add(name);

        const isState = knownStateVars.has(name);

        // Check if this might be a setter (convention: setX for state x)
        const isSetter =
          name.startsWith("set") &&
          knownStateVars.has(name.charAt(3).toLowerCase() + name.slice(4));
        const stateFor = isSetter
          ? name.charAt(3).toLowerCase() + name.slice(4)
          : undefined;

        captures.push({
          name,
          isState,
          isSetter,
          stateFor,
          needsProp: isState || isSetter,
        });
      }
    }

    ts.forEachChild(node, findCaptures);
  }

  findCaptures(closure);

  // Categorize captures
  const stateReads = captures
    .filter((c) => c.isState && !c.isSetter)
    .map((c) => c.name);
  const stateSetters = captures.filter((c) => c.isSetter).map((c) => c.name);
  const otherCaptures = captures
    .filter((c) => !c.isState && !c.isSetter)
    .map((c) => c.name);

  // Determine if we can hoist
  let canHoist = true;
  let hoistBlocker: string | undefined;

  // Check for captures that prevent hoisting
  // For now, we can hoist anything, but we'll need to thread captures as props
  // Future: detect captures that can't be threaded (e.g., mutable refs)

  return {
    captures,
    stateReads,
    stateSetters,
    otherCaptures,
    canHoist,
    hoistBlocker,
  };
}

/**
 * Generate additional props for a hoisted component based on captures.
 *
 * @param factory - TypeScript node factory
 * @param captures - Captured variables
 * @param stateValueMap - Map from state name to value identifier
 * @param stateSetterMap - Map from state name to setter identifier
 * @returns Array of property signature nodes for the props type
 */
export function generateCaptureProps(
  factory: ts.NodeFactory,
  captures: ClosureCapture[],
  stateValueMap: Map<string, string>,
  stateSetterMap: Map<string, string>,
): ts.PropertySignature[] {
  const props: ts.PropertySignature[] = [];

  for (const capture of captures) {
    if (!capture.needsProp) {
      continue;
    }

    // Generate prop name (prefix internal props with __)
    const propName = capture.isState
      ? `__${capture.name}_val`
      : capture.isSetter
        ? `__${capture.stateFor}_set`
        : `__${capture.name}`;

    // Create property signature
    // Type will be inferred or specified as `any` for simplicity
    const prop = factory.createPropertySignature(
      undefined,
      factory.createIdentifier(propName),
      undefined,
      factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
    );

    props.push(prop);
  }

  return props;
}

/**
 * Generate prop passing for a hoisted component usage.
 *
 * @param factory - TypeScript node factory
 * @param captures - Captured variables
 * @param stateValueMap - Map from state name to current value identifier
 * @param stateSetterMap - Map from state name to setter identifier
 * @returns Array of JSX attribute nodes
 */
export function generateCapturePropAssignments(
  factory: ts.NodeFactory,
  captures: ClosureCapture[],
  stateValueMap: Map<string, string>,
  stateSetterMap: Map<string, string>,
): ts.JsxAttribute[] {
  const attrs: ts.JsxAttribute[] = [];

  for (const capture of captures) {
    if (!capture.needsProp) {
      continue;
    }

    let propName: string;
    let valueIdent: string;

    if (capture.isState) {
      propName = `__${capture.name}_val`;
      valueIdent = stateValueMap.get(capture.name) ?? capture.name;
    } else if (capture.isSetter && capture.stateFor) {
      propName = `__${capture.stateFor}_set`;
      valueIdent = stateSetterMap.get(capture.stateFor) ?? capture.name;
    } else {
      propName = `__${capture.name}`;
      valueIdent = capture.name;
    }

    const attr = factory.createJsxAttribute(
      factory.createIdentifier(propName),
      factory.createJsxExpression(
        undefined,
        factory.createIdentifier(valueIdent),
      ),
    );

    attrs.push(attr);
  }

  return attrs;
}

/**
 * Rewrite references to captured variables inside a hoisted component
 * to use the threaded props instead.
 *
 * @param closure - The component closure
 * @param captures - Captured variables
 * @returns Transformed closure with capture references rewritten
 */
export function rewriteCaptureReferences(
  ctx: MacroContext,
  closure: ts.ArrowFunction | ts.FunctionExpression,
  captures: ClosureCapture[],
): ts.ArrowFunction | ts.FunctionExpression {
  const factory = ctx.factory;

  // Build a map of original name -> prop name
  const rewriteMap = new Map<string, string>();
  for (const capture of captures) {
    if (capture.needsProp) {
      if (capture.isState) {
        rewriteMap.set(capture.name, `__${capture.name}_val`);
      } else if (capture.isSetter && capture.stateFor) {
        rewriteMap.set(capture.name, `__${capture.stateFor}_set`);
      } else {
        rewriteMap.set(capture.name, `__${capture.name}`);
      }
    }
  }

  // Transform the closure
  function transformNode(node: ts.Node): ts.Node {
    // Rewrite identifier references
    if (ts.isIdentifier(node) && rewriteMap.has(node.text)) {
      // Skip property names
      if (
        node.parent &&
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.name === node
      ) {
        return node;
      }

      // Skip declarations
      if (
        node.parent &&
        ts.isVariableDeclaration(node.parent) &&
        node.parent.name === node
      ) {
        return node;
      }

      return factory.createIdentifier(rewriteMap.get(node.text)!);
    }

    return ts.visitEachChild(
      node,
      transformNode,
      ctx.transformContext,
    );
  }

  return transformNode(closure) as ts.ArrowFunction | ts.FunctionExpression;
}

/**
 * Find all variables declared in a function body (parent scope).
 */
export function findParentScopeVariables(
  body: ts.Block | ts.ConciseBody,
): Set<string> {
  const vars = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      vars.add(node.name.text);
    }

    // Handle destructuring
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
          vars.add(element.name.text);
        }
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
          vars.add(element.name.text);
        }
      }
    }

    // Also track function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      vars.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  }

  if (ts.isBlock(body)) {
    ts.forEachChild(body, visit);
  }

  return vars;
}
