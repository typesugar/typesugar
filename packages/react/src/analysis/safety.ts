/**
 * Compile-Time Safety Checks for React Macros
 *
 * Implements rules-of-hooks style checking at compile time:
 * 1. Conditional state/effect detection (no state() or effect() inside if/loops)
 * 2. State outside component detection
 * 3. Direct state mutation detection (count = 5 instead of count.set(5))
 *
 * These checks happen at compile time, eliminating entire classes of runtime errors.
 */

import * as ts from "typescript";
import type { MacroContext } from "../../../core/types.js";

/**
 * Result of safety checks
 */
export interface SafetyCheckResult {
  /** Whether all checks passed */
  valid: boolean;
  /** Detected violations */
  violations: SafetyViolation[];
}

/**
 * A safety violation
 */
export interface SafetyViolation {
  /** The kind of violation */
  kind:
    | "conditional-state"
    | "conditional-effect"
    | "conditional-derived"
    | "state-outside-component"
    | "direct-mutation"
    | "state-in-loop"
    | "effect-in-loop";

  /** Human-readable message */
  message: string;

  /** The violating node */
  node: ts.Node;

  /** Suggested fix */
  suggestion?: string;
}

/**
 * Check for conditional reactive primitive usage in a function body.
 *
 * Detects patterns like:
 *   if (condition) {
 *     const x = state(0); // Error!
 *   }
 *
 * This is a compile-time equivalent of the rules-of-hooks.
 */
export function checkConditionalPrimitives(
  ctx: MacroContext,
  body: ts.Block | ts.ConciseBody,
): SafetyCheckResult {
  const violations: SafetyViolation[] = [];

  /**
   * Track whether we're inside a conditional context
   */
  interface Context {
    inConditional: boolean;
    inLoop: boolean;
    inTryCatch: boolean;
    conditionalNode?: ts.Node;
    loopNode?: ts.Node;
  }

  function visit(node: ts.Node, context: Context): void {
    // Track conditional contexts
    if (ts.isIfStatement(node)) {
      // Visit condition with current context
      ts.forEachChild(node.expression, (n) => visit(n, context));

      // Visit then/else branches with conditional context
      const conditionalContext: Context = {
        ...context,
        inConditional: true,
        conditionalNode: node,
      };
      visit(node.thenStatement, conditionalContext);
      if (node.elseStatement) {
        visit(node.elseStatement, conditionalContext);
      }
      return;
    }

    // Track conditional expressions (ternary)
    if (ts.isConditionalExpression(node)) {
      const conditionalContext: Context = {
        ...context,
        inConditional: true,
        conditionalNode: node,
      };
      ts.forEachChild(node.condition, (n) => visit(n, context));
      visit(node.whenTrue, conditionalContext);
      visit(node.whenFalse, conditionalContext);
      return;
    }

    // Track switch statements
    if (ts.isSwitchStatement(node)) {
      ts.forEachChild(node.expression, (n) => visit(n, context));
      const conditionalContext: Context = {
        ...context,
        inConditional: true,
        conditionalNode: node,
      };
      node.caseBlock.clauses.forEach((clause) => {
        visit(clause, conditionalContext);
      });
      return;
    }

    // Track loop contexts
    if (
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isWhileStatement(node) ||
      ts.isDoStatement(node)
    ) {
      const loopContext: Context = {
        ...context,
        inLoop: true,
        loopNode: node,
      };
      ts.forEachChild(node, (n) => visit(n, loopContext));
      return;
    }

    // Track try-catch
    if (ts.isTryStatement(node)) {
      const tryContext: Context = {
        ...context,
        inConditional: true, // catch blocks are conditional
        conditionalNode: node,
      };
      visit(node.tryBlock, context);
      if (node.catchClause) {
        visit(node.catchClause, tryContext);
      }
      if (node.finallyBlock) {
        visit(node.finallyBlock, context);
      }
      return;
    }

    // Check for reactive primitive calls in bad contexts
    if (ts.isCallExpression(node)) {
      const callName = getCallExpressionName(node);

      if (callName === "state" || callName === "derived" || callName === "effect" || callName === "watch") {
        if (context.inConditional) {
          violations.push({
            kind: callName === "state"
              ? "conditional-state"
              : callName === "effect" || callName === "watch"
                ? "conditional-effect"
                : "conditional-derived",
            message: `${callName}() cannot be called conditionally. React hooks (which this compiles to) must be called in the same order on every render.`,
            node,
            suggestion: `Move ${callName}() outside of the conditional, or use a different pattern.`,
          });
        }

        if (context.inLoop) {
          violations.push({
            kind: callName === "state" ? "state-in-loop" : "effect-in-loop",
            message: `${callName}() cannot be called inside a loop. The number of hooks must be consistent between renders.`,
            node,
            suggestion: `Move ${callName}() outside of the loop, or use a different pattern like each() for iteration.`,
          });
        }
      }
    }

    // Continue visiting children
    ts.forEachChild(node, (n) => visit(n, context));
  }

  const initialContext: Context = {
    inConditional: false,
    inLoop: false,
    inTryCatch: false,
  };

  if (ts.isBlock(body)) {
    ts.forEachChild(body, (n) => visit(n, initialContext));
  } else if (ts.isExpression(body)) {
    visit(body, initialContext);
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Check for direct state mutation (assignment to state variable).
 *
 * Detects:
 *   count = 5;  // Error! Should be count.set(5)
 *
 * But allows:
 *   const count = state(0);  // OK - declaration
 */
export function checkDirectMutation(
  ctx: MacroContext,
  body: ts.Block | ts.ConciseBody,
  stateVariables: Set<string>,
): SafetyCheckResult {
  const violations: SafetyViolation[] = [];

  function visit(node: ts.Node): void {
    // Check for assignment expressions
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;

      // Assignment operators
      if (
        op === ts.SyntaxKind.EqualsToken ||
        op === ts.SyntaxKind.PlusEqualsToken ||
        op === ts.SyntaxKind.MinusEqualsToken
      ) {
        // Check if LHS is a state variable
        if (ts.isIdentifier(node.left)) {
          const name = node.left.text;
          if (stateVariables.has(name)) {
            violations.push({
              kind: "direct-mutation",
              message: `Cannot directly assign to state variable '${name}'. Use ${name}.set() instead.`,
              node,
              suggestion: `Change '${name} = value' to '${name}.set(value)'`,
            });
          }
        }
      }
    }

    // Check for increment/decrement of state
    if (
      ts.isPrefixUnaryExpression(node) ||
      ts.isPostfixUnaryExpression(node)
    ) {
      const op = node.operator;
      if (
        op === ts.SyntaxKind.PlusPlusToken ||
        op === ts.SyntaxKind.MinusMinusToken
      ) {
        const operand = node.operand;
        if (ts.isIdentifier(operand) && stateVariables.has(operand.text)) {
          violations.push({
            kind: "direct-mutation",
            message: `Cannot use ++/-- on state variable '${operand.text}'. Use ${operand.text}.set(v => v + 1) instead.`,
            node,
            suggestion: `Change '${operand.text}++' to '${operand.text}.set(v => v + 1)'`,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  if (ts.isBlock(body)) {
    ts.forEachChild(body, visit);
  } else if (ts.isExpression(body)) {
    visit(body);
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Check that state/effect/derived are used inside a function component.
 *
 * Detects top-level usage outside of components.
 */
export function checkComponentScope(
  ctx: MacroContext,
  sourceFile: ts.SourceFile,
): SafetyCheckResult {
  const violations: SafetyViolation[] = [];

  function visit(node: ts.Node, inComponentScope: boolean): void {
    // Track function declarations/expressions that look like components
    // (capitalize first letter or return JSX)
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      const isComponent = checkIfComponent(node);
      ts.forEachChild(node, (n) => visit(n, isComponent));
      return;
    }

    // Check for reactive primitive calls outside components
    if (ts.isCallExpression(node)) {
      const callName = getCallExpressionName(node);

      if (
        (callName === "state" ||
          callName === "derived" ||
          callName === "effect" ||
          callName === "watch") &&
        !inComponentScope
      ) {
        violations.push({
          kind: "state-outside-component",
          message: `${callName}() must be called inside a function component, not at the top level.`,
          node,
          suggestion: `Move ${callName}() inside a function component.`,
        });
      }
    }

    ts.forEachChild(node, (n) => visit(n, inComponentScope));
  }

  ts.forEachChild(sourceFile, (n) => visit(n, false));

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Get the name of a call expression (the function being called)
 */
function getCallExpressionName(node: ts.CallExpression): string | null {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }
  return null;
}

/**
 * Check if a function looks like a React component
 * (starts with uppercase or returns JSX)
 */
function checkIfComponent(
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
): boolean {
  // Check name starts with uppercase (convention for components)
  if (ts.isFunctionDeclaration(node) && node.name) {
    const firstChar = node.name.text.charAt(0);
    if (firstChar === firstChar.toUpperCase()) {
      return true;
    }
  }

  // Check if body contains JSX return
  if (node.body) {
    return containsJsxReturn(node.body);
  }

  return false;
}

/**
 * Check if a function body contains a JSX return
 */
function containsJsxReturn(body: ts.ConciseBody): boolean {
  if (ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body) || ts.isJsxFragment(body)) {
    return true;
  }

  if (ts.isBlock(body)) {
    let foundJsx = false;

    function visit(node: ts.Node): void {
      if (ts.isReturnStatement(node) && node.expression) {
        if (
          ts.isJsxElement(node.expression) ||
          ts.isJsxSelfClosingElement(node.expression) ||
          ts.isJsxFragment(node.expression)
        ) {
          foundJsx = true;
        }
      }
      ts.forEachChild(node, visit);
    }

    ts.forEachChild(body, visit);
    return foundJsx;
  }

  return false;
}

/**
 * Run all safety checks on a function body
 */
export function runAllSafetyChecks(
  ctx: MacroContext,
  body: ts.Block | ts.ConciseBody,
  stateVariables: Set<string>,
): SafetyCheckResult {
  const results: SafetyCheckResult[] = [
    checkConditionalPrimitives(ctx, body),
    checkDirectMutation(ctx, body, stateVariables),
  ];

  const allViolations = results.flatMap((r) => r.violations);

  return {
    valid: allViolations.length === 0,
    violations: allViolations,
  };
}

/**
 * Report safety violations as compile-time errors
 */
export function reportSafetyViolations(
  ctx: MacroContext,
  result: SafetyCheckResult,
): void {
  for (const violation of result.violations) {
    let message = violation.message;
    if (violation.suggestion) {
      message += `\n  Suggestion: ${violation.suggestion}`;
    }
    ctx.reportError(violation.node, message);
  }
}
