/**
 * old() — Pre-Call Value Capture
 *
 * Used inside ensures() to reference the value of an expression
 * as it was before the function body executed.
 *
 * The @contract macro (or ensures() macro) finds all old() calls,
 * hoists their arguments into variables at the top of the function,
 * and replaces old(expr) with the hoisted variable reference.
 *
 * @example
 * ```typescript
 * function increment(counter: Counter): void {
 *   ensures(counter.value === old(counter.value) + 1);
 *   counter.value++;
 * }
 *
 * // Transforms to:
 * function increment(counter: Counter): void {
 *   const __old_0__ = counter.value;
 *   counter.value++;
 *   (counter.value === __old_0__ + 1) || (() => { throw ... })();
 * }
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

/**
 * Collected old() captures for the current function being processed.
 * The ensures() and @contract macros use this to hoist captures.
 */
export interface OldCapture {
  /** The original expression inside old(...) */
  expression: ts.Expression;
  /** The generated variable name for the captured value */
  variableName: ts.Identifier;
  /** The source text of the expression (for error messages) */
  sourceText: string;
}

/**
 * Scan an expression tree for old() calls and collect captures.
 * Returns the expression with old(expr) replaced by variable references,
 * and the list of captures that need to be hoisted.
 */
export function extractOldCaptures(
  ctx: MacroContext,
  expression: ts.Expression
): { rewritten: ts.Expression; captures: OldCapture[] } {
  const captures: OldCapture[] = [];

  function visit(node: ts.Node): ts.Node {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "old"
    ) {
      if (node.arguments.length !== 1) {
        ctx.reportError(node, "old() expects exactly one argument");
        return node;
      }

      const arg = node.arguments[0];
      const varName = ctx.generateUniqueName("old");
      const sourceText = arg.getText?.() ?? "expr";

      captures.push({
        expression: arg,
        variableName: varName,
        sourceText,
      });

      return varName;
    }

    return ts.visitEachChild(node, visit, ctx.transformContext);
  }

  const rewritten = ts.visitNode(expression, visit) as ts.Expression;
  return { rewritten, captures };
}

/**
 * Generate variable declarations for old() captures.
 * These are placed at the top of the function body, before any mutations.
 */
export function generateOldCaptureStatements(
  ctx: MacroContext,
  captures: OldCapture[]
): ts.Statement[] {
  return captures.map((capture) =>
    ctx.factory.createVariableStatement(
      undefined,
      ctx.factory.createVariableDeclarationList(
        [
          ctx.factory.createVariableDeclaration(
            capture.variableName,
            undefined,
            undefined,
            capture.expression
          ),
        ],
        ts.NodeFlags.Const
      )
    )
  );
}

/**
 * The old() expression macro itself.
 * When encountered outside of ensures()/@contract context, it's an identity.
 * The real transformation happens in extractOldCaptures().
 */
export const oldMacro = defineExpressionMacro({
  name: "old",
  module: "@typesugar/contracts",
  description: "Capture the pre-call value of an expression for use in postconditions.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    // old() is only meaningful inside an `ensures:` block of a function that is
    // (explicitly or implicitly) under @contract. In that case the @contract
    // attribute macro rewrites old(expr) into a hoisted pre-state snapshot
    // BEFORE the transformer ever descends to this call, so reaching this
    // expander means old() was used somewhere it cannot capture pre-state
    // (e.g. a standalone `ensures(old(x))` expression call). Report it rather
    // than silently returning the current value, which would make valid
    // postconditions throw.
    ctx.reportError(
      callExpr,
      "old() can only be used inside an `ensures:` block of an @contract function. " +
        "Use the requires:/ensures: block form (see the Design by Contract guide); " +
        "old() is not supported in a standalone ensures(...) call."
    );
    // Fall back to identity so downstream emit still produces valid code.
    return args.length >= 1 ? args[0] : callExpr;
  },
});

globalRegistry.register(oldMacro);
