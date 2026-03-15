/**
 * Fluent Pattern Matching — Wave 1 (PEP-008)
 *
 * Implements the `.case().if().then().else()` fluent chain for the `match()` macro.
 * This module is called from the existing match macro when a chain call is detected.
 *
 * Supported patterns (Wave 1):
 * - Literals: number, string, boolean, null, undefined
 * - Wildcard: `_` (always matches, never binds)
 * - Variable binding: bare identifier (binds scrutinee to name)
 *
 * Compilation target: IIFE with scrutinee evaluated once.
 *
 * @example
 * ```typescript
 * match(x).case(42).then("the answer").case(n).if(n > 0).then(n * 2).else(0)
 * // compiles to:
 * (() => {
 *   const __m = x;
 *   if (__m === 42) return "the answer";
 *   { const n = __m; if (n > 0) return n * 2; }
 *   return 0;
 * })()
 * ```
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";

// ============================================================================
// Chain Parsing
// ============================================================================

interface ChainLink {
  method: string;
  args: readonly ts.Expression[];
  node: ts.CallExpression;
}

interface CaseArm {
  pattern: ts.Expression;
  guard?: ts.Expression;
  result: ts.Expression;
}

type PatternInfo =
  | { kind: "literal"; node: ts.Expression }
  | { kind: "wildcard" }
  | { kind: "variable"; name: string }
  | { kind: "unsupported"; node: ts.Expression };

/**
 * Walk from the outermost chain CallExpression inward to collect all links.
 * Returns links in source order (left-to-right).
 */
function parseChain(outermost: ts.CallExpression): { root: ts.CallExpression; links: ChainLink[] } {
  const links: ChainLink[] = [];
  let current: ts.Expression = outermost;

  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    const call = current;
    const propAccess = call.expression as ts.PropertyAccessExpression;
    links.push({
      method: propAccess.name.text,
      args: call.arguments,
      node: call,
    });
    current = propAccess.expression;
  }

  if (!ts.isCallExpression(current)) {
    throw new Error("Fluent match chain does not root in a call expression");
  }

  links.reverse();
  return { root: current, links };
}

/**
 * Parse chain links into structured case arms and an optional else clause.
 *
 * Grammar:
 *   chain := match(scrutinee) (.case(pattern) [.if(guard)] .then(result))* [.else(default)]
 */
function parseArms(
  ctx: MacroContext,
  links: ChainLink[]
): { arms: CaseArm[]; elseResult?: ts.Expression } {
  const arms: CaseArm[] = [];
  let currentPattern: ts.Expression | undefined;
  let currentGuard: ts.Expression | undefined;
  let elseResult: ts.Expression | undefined;

  for (const link of links) {
    switch (link.method) {
      case "case":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .case() requires a pattern argument");
          break;
        }
        currentPattern = link.args[0];
        currentGuard = undefined;
        break;

      case "if":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .if() requires a guard expression");
          break;
        }
        currentGuard = link.args[0];
        break;

      case "then":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .then() requires a result expression");
          break;
        }
        if (currentPattern === undefined) {
          ctx.reportError(link.node, "match: .then() without preceding .case()");
          break;
        }
        arms.push({
          pattern: currentPattern,
          guard: currentGuard,
          result: link.args[0],
        });
        currentPattern = undefined;
        currentGuard = undefined;
        break;

      case "else":
        if (link.args.length < 1) {
          ctx.reportError(link.node, "match: .else() requires a default expression");
          break;
        }
        elseResult = link.args[0];
        break;

      default:
        ctx.reportError(link.node, `match: unknown chain method '.${link.method}()'`);
    }
  }

  return { arms, elseResult };
}

// ============================================================================
// Pattern Analysis
// ============================================================================

function analyzePattern(pattern: ts.Expression): PatternInfo {
  if (ts.isNumericLiteral(pattern)) {
    return { kind: "literal", node: pattern };
  }
  if (ts.isStringLiteral(pattern)) {
    return { kind: "literal", node: pattern };
  }
  if (pattern.kind === ts.SyntaxKind.TrueKeyword || pattern.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "literal", node: pattern };
  }
  if (pattern.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: "literal", node: pattern };
  }
  if (ts.isPrefixUnaryExpression(pattern) && ts.isNumericLiteral(pattern.operand)) {
    return { kind: "literal", node: pattern };
  }
  if (ts.isIdentifier(pattern)) {
    if (pattern.text === "_") {
      return { kind: "wildcard" };
    }
    if (pattern.text === "undefined") {
      return { kind: "literal", node: pattern };
    }
    return { kind: "variable", name: pattern.text };
  }

  return { kind: "unsupported", node: pattern };
}

// ============================================================================
// Code Generation
// ============================================================================

/**
 * Generate the IIFE that implements the match expression.
 *
 * For simple cases (single literal + else, no guards), generates a ternary
 * expression instead of a full IIFE for zero-cost output.
 */
export function expandFluentMatch(
  ctx: MacroContext,
  chainExpr: ts.CallExpression,
  rootArgs: readonly ts.Expression[]
): ts.Expression {
  const { root, links } = parseChain(chainExpr);
  const scrutinee = rootArgs[0];

  if (!scrutinee) {
    ctx.reportError(chainExpr, "match: requires a scrutinee argument");
    return chainExpr;
  }

  const { arms, elseResult } = parseArms(ctx, links);

  if (arms.length === 0 && elseResult === undefined) {
    ctx.reportError(chainExpr, "match: chain has no .case().then() arms");
    return chainExpr;
  }

  // Optimization: single literal arm + else, no guard → ternary
  if (arms.length === 1 && elseResult !== undefined) {
    const pattern = analyzePattern(arms[0].pattern);
    if (pattern.kind === "literal" && !arms[0].guard) {
      return generateTernary(ctx, scrutinee, arms[0], pattern.node, elseResult);
    }
  }

  return generateIIFE(ctx, scrutinee, arms, elseResult);
}

function generateTernary(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arm: CaseArm,
  literalNode: ts.Expression,
  elseResult: ts.Expression
): ts.Expression {
  const f = ctx.factory;
  const condition = f.createBinaryExpression(
    scrutinee,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    literalNode
  );
  return f.createConditionalExpression(
    condition,
    f.createToken(ts.SyntaxKind.QuestionToken),
    arm.result,
    f.createToken(ts.SyntaxKind.ColonToken),
    elseResult
  );
}

function generateIIFE(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  arms: CaseArm[],
  elseResult: ts.Expression | undefined
): ts.Expression {
  const f = ctx.factory;
  const scrutineeName = ctx.generateUniqueName("m");

  const statements: ts.Statement[] = [];

  // const __m = scrutinee;
  statements.push(
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(scrutineeName, undefined, undefined, scrutinee)],
        ts.NodeFlags.Const
      )
    )
  );

  for (const arm of arms) {
    const pattern = analyzePattern(arm.pattern);
    const scrutineeRef = f.createIdentifier(scrutineeName.text);

    switch (pattern.kind) {
      case "literal": {
        const condition = f.createBinaryExpression(
          scrutineeRef,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          pattern.node
        );
        const check = arm.guard
          ? f.createBinaryExpression(condition, ts.SyntaxKind.AmpersandAmpersandToken, arm.guard)
          : condition;
        statements.push(f.createIfStatement(check, f.createReturnStatement(arm.result)));
        break;
      }

      case "wildcard": {
        if (arm.guard) {
          statements.push(f.createIfStatement(arm.guard, f.createReturnStatement(arm.result)));
        } else {
          statements.push(f.createReturnStatement(arm.result));
        }
        break;
      }

      case "variable": {
        const binding = f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [
              f.createVariableDeclaration(
                f.createIdentifier(pattern.name),
                undefined,
                undefined,
                f.createIdentifier(scrutineeName.text)
              ),
            ],
            ts.NodeFlags.Const
          )
        );

        const bodyStatements: ts.Statement[] = [binding];

        if (arm.guard) {
          bodyStatements.push(f.createIfStatement(arm.guard, f.createReturnStatement(arm.result)));
        } else {
          bodyStatements.push(f.createReturnStatement(arm.result));
        }

        statements.push(f.createBlock(bodyStatements, true));
        break;
      }

      case "unsupported":
        ctx.reportError(
          pattern.node,
          `match: unsupported pattern kind in Wave 1 (only literals, _, and identifiers supported)`
        );
        break;
    }
  }

  // else clause or MatchError
  if (elseResult !== undefined) {
    statements.push(f.createReturnStatement(elseResult));
  } else {
    statements.push(
      f.createThrowStatement(
        f.createNewExpression(f.createIdentifier("MatchError"), undefined, [
          f.createIdentifier(scrutineeName.text),
        ])
      )
    );
  }

  // (() => { ... })()
  const arrowBody = f.createBlock(statements, true);
  const arrow = f.createArrowFunction(
    undefined,
    undefined,
    [],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    arrowBody
  );
  const paren = f.createParenthesizedExpression(arrow);
  return f.createCallExpression(paren, undefined, []);
}
