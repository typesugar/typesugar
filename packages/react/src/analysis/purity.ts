/**
 * Purity Checking for React Macros
 *
 * Verifies that closures used in `derived()` are pure (no side effects).
 * Reports compile-time errors when impure code is detected.
 *
 * A closure is considered pure if:
 * 1. It doesn't call .set() or .update() on any state
 * 2. It doesn't mutate the DOM (document.*, window.*)
 * 3. It doesn't use console.*
 * 4. It doesn't call fetch() or XHR
 * 5. It doesn't use timers (setTimeout, setInterval)
 * 6. It doesn't throw exceptions (in strict mode)
 */

import * as ts from "typescript";
import type { MacroContext } from "../../../core/types.js";
import type { DependencyInfo, SideEffect } from "../types.js";
import { extractDependencies, type StateVariableSet } from "./deps.js";

/**
 * Result of purity verification
 */
export interface PurityResult {
  /** Whether the closure is pure */
  isPure: boolean;

  /** Detected violations (if not pure) */
  violations: PurityViolation[];

  /** Dependency info from the analysis */
  dependencies: DependencyInfo;
}

/**
 * A purity violation
 */
export interface PurityViolation {
  /** The kind of violation */
  kind: SideEffect["kind"] | "unknown-call" | "throw";

  /** Human-readable message */
  message: string;

  /** The violating node (for error reporting) */
  node: ts.Node;

  /** Suggested fix */
  suggestion?: string;
}

/**
 * Verify that a closure is pure (no side effects).
 * Used by the `derived()` macro to enforce purity.
 *
 * @param ctx - Macro context
 * @param closure - The closure to verify
 * @param knownStateVars - Known state variables in scope
 * @param strictMode - If true, also check for throw statements
 * @returns Purity result with any violations
 */
export function verifyPurity(
  ctx: MacroContext,
  closure: ts.ArrowFunction | ts.FunctionExpression,
  knownStateVars: StateVariableSet,
  strictMode: boolean = true,
): PurityResult {
  const dependencies = extractDependencies(ctx, closure, knownStateVars);
  const violations: PurityViolation[] = [];

  // Convert side effects to violations
  for (const effect of dependencies.sideEffects) {
    const violation = sideEffectToViolation(effect, closure);
    if (violation) {
      violations.push(violation);
    }
  }

  // Additional strict-mode checks
  if (strictMode) {
    const additionalViolations = checkStrictPurity(closure);
    violations.push(...additionalViolations);
  }

  return {
    isPure: violations.length === 0,
    violations,
    dependencies,
  };
}

/**
 * Convert a side effect to a purity violation
 */
function sideEffectToViolation(
  effect: SideEffect,
  closure: ts.Node,
): PurityViolation | null {
  switch (effect.kind) {
    case "state-mutation":
      return {
        kind: "state-mutation",
        message: `derived() computations must be pure. Found state mutation: ${effect.description}`,
        node: closure,
        suggestion: "Move state updates to an effect() instead",
      };

    case "dom-mutation":
      return {
        kind: "dom-mutation",
        message: `derived() computations must be pure. Found DOM mutation: ${effect.description}`,
        node: closure,
        suggestion: "Move DOM operations to an effect() instead",
      };

    case "console":
      return {
        kind: "console",
        message: `derived() computations must be pure. Found console call: ${effect.description}`,
        node: closure,
        suggestion: "Remove console calls from derived computations",
      };

    case "fetch":
      return {
        kind: "fetch",
        message: `derived() computations must be pure. Found async operation: ${effect.description}`,
        node: closure,
        suggestion:
          "Use effect() for data fetching, store results in state()",
      };

    case "timer":
      return {
        kind: "timer",
        message: `derived() computations must be pure. Found timer: ${effect.description}`,
        node: closure,
        suggestion: "Move timer setup to an effect() with proper cleanup",
      };

    case "unknown":
      // Don't report unknown effects as violations (too noisy)
      return null;
  }
}

/**
 * Additional strict-mode purity checks
 */
function checkStrictPurity(closure: ts.Node): PurityViolation[] {
  const violations: PurityViolation[] = [];

  function visit(node: ts.Node): void {
    // Check for throw statements
    if (ts.isThrowStatement(node)) {
      violations.push({
        kind: "throw",
        message:
          "derived() computations should not throw. Consider returning an error value instead.",
        node,
        suggestion:
          "Return { ok: false, error } instead of throwing, or use a try/catch",
      });
    }

    // Check for assignment expressions (mutations)
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        op === ts.SyntaxKind.EqualsToken ||
        op === ts.SyntaxKind.PlusEqualsToken ||
        op === ts.SyntaxKind.MinusEqualsToken ||
        op === ts.SyntaxKind.AsteriskEqualsToken ||
        op === ts.SyntaxKind.SlashEqualsToken
      ) {
        // Check if LHS is a property access or element access (mutation)
        if (
          ts.isPropertyAccessExpression(node.left) ||
          ts.isElementAccessExpression(node.left)
        ) {
          violations.push({
            kind: "state-mutation",
            message:
              "derived() computations should not mutate objects. Found property assignment.",
            node,
            suggestion:
              "Create a new object with spread syntax: { ...obj, prop: newValue }",
          });
        }
      }
    }

    // Check for increment/decrement operators (mutations)
    if (
      ts.isPrefixUnaryExpression(node) ||
      ts.isPostfixUnaryExpression(node)
    ) {
      const op = node.operator;
      if (
        op === ts.SyntaxKind.PlusPlusToken ||
        op === ts.SyntaxKind.MinusMinusToken
      ) {
        violations.push({
          kind: "state-mutation",
          message: "derived() computations should not use ++/-- operators.",
          node,
          suggestion: "Use a local variable or return the incremented value",
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(closure);
  return violations;
}

/**
 * Report purity violations as compile-time errors
 */
export function reportPurityViolations(
  ctx: MacroContext,
  result: PurityResult,
  macroName: string,
): void {
  for (const violation of result.violations) {
    let message = `[${macroName}] ${violation.message}`;
    if (violation.suggestion) {
      message += `\n  Suggestion: ${violation.suggestion}`;
    }
    ctx.reportError(violation.node, message);
  }
}

/**
 * Check if a closure looks like it should be derived (pure computation)
 * but is being used in effect() (side effect).
 *
 * Used to emit warnings like "consider using derived() instead".
 */
export function shouldBeDerived(dependencies: DependencyInfo): {
  shouldWarn: boolean;
  reason: string;
} {
  // If there are reads but no writes and no side effects,
  // and the closure is pure, it might be better as derived()
  if (
    dependencies.reads.size > 0 &&
    dependencies.writes.size === 0 &&
    dependencies.sideEffects.length === 0 &&
    dependencies.isPure
  ) {
    return {
      shouldWarn: true,
      reason:
        "This effect only reads state without side effects. Consider using derived() instead.",
    };
  }

  return {
    shouldWarn: false,
    reason: "",
  };
}

/**
 * Check if an effect has proper cleanup for resources it creates.
 * Emits warnings for common patterns that need cleanup.
 */
export function checkEffectCleanup(
  closure: ts.ArrowFunction | ts.FunctionExpression,
): { needsCleanup: boolean; resource: string; hasCleanup: boolean }[] {
  const resourcesNeedingCleanup: {
    needsCleanup: boolean;
    resource: string;
    hasCleanup: boolean;
  }[] = [];

  let hasReturnStatement = false;

  function visit(node: ts.Node): void {
    // Check for return statement (cleanup function)
    if (ts.isReturnStatement(node) && node.expression) {
      hasReturnStatement = true;
    }

    // Check for addEventListener
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "addEventListener"
    ) {
      resourcesNeedingCleanup.push({
        needsCleanup: true,
        resource: "addEventListener",
        hasCleanup: false, // Will be updated after full traversal
      });
    }

    // Check for setInterval
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "setInterval"
    ) {
      resourcesNeedingCleanup.push({
        needsCleanup: true,
        resource: "setInterval",
        hasCleanup: false,
      });
    }

    // Check for setTimeout (less critical but worth noting)
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "setTimeout"
    ) {
      resourcesNeedingCleanup.push({
        needsCleanup: true,
        resource: "setTimeout",
        hasCleanup: false,
      });
    }

    // Check for AbortController (good pattern)
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "AbortController"
    ) {
      resourcesNeedingCleanup.push({
        needsCleanup: true,
        resource: "AbortController",
        hasCleanup: false,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(closure);

  // Update hasCleanup based on whether there's a return statement
  for (const resource of resourcesNeedingCleanup) {
    resource.hasCleanup = hasReturnStatement;
  }

  return resourcesNeedingCleanup;
}
