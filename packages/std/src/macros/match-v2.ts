/**
 * Fluent Pattern Matching — Waves 1+2 (PEP-008)
 *
 * Implements the `.case().if().then().else()` fluent chain for the `match()` macro.
 * This module is called from the existing match macro when a chain call is detected.
 *
 * Supported patterns:
 * - Wave 1: Literals, wildcard (`_`), variable binding
 * - Wave 2: Array patterns (`[a, b]`, `[head, ...tail]`, `[]`),
 *           Object patterns (`{ a, b }`, `{ name: n }`, `{ kind: "circle" }`),
 *           Nested patterns (`{ user: { name } }`, `[{ x }, { y }]`),
 *           Rest/spread patterns for both arrays and objects
 *
 * Compilation target: IIFE with scrutinee evaluated once.
 *
 * @example
 * ```typescript
 * match(arr).case([first, _, _]).if(first > 0).then(first)
 * // compiles to:
 * (() => {
 *   const __m = arr;
 *   if (Array.isArray(__m) && __m.length === 3) {
 *     const first = __m[0];
 *     if (first > 0) return first;
 *   }
 *   throw new MatchError(__m);
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

// ============================================================================
// Pattern Types
// ============================================================================

interface ArrayElementPattern {
  pattern: PatternInfo;
  isRest: boolean;
}

interface ObjectPropertyPattern {
  key: string;
  pattern: PatternInfo;
  isRest: boolean;
}

type PatternInfo =
  | { kind: "literal"; node: ts.Expression }
  | { kind: "wildcard" }
  | { kind: "variable"; name: string }
  | { kind: "array"; elements: ArrayElementPattern[]; hasRest: boolean }
  | { kind: "object"; properties: ObjectPropertyPattern[]; hasRest: boolean }
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
  // Literals
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

  // Identifiers: wildcard, undefined literal, variable binding
  if (ts.isIdentifier(pattern)) {
    if (pattern.text === "_") {
      return { kind: "wildcard" };
    }
    if (pattern.text === "undefined") {
      return { kind: "literal", node: pattern };
    }
    return { kind: "variable", name: pattern.text };
  }

  // Array patterns: [a, b], [head, ...tail], []
  if (ts.isArrayLiteralExpression(pattern)) {
    const elements: ArrayElementPattern[] = [];
    let hasRest = false;

    for (const elem of pattern.elements) {
      if (ts.isSpreadElement(elem)) {
        hasRest = true;
        elements.push({
          pattern: analyzePattern(elem.expression),
          isRest: true,
        });
      } else {
        elements.push({
          pattern: analyzePattern(elem),
          isRest: false,
        });
      }
    }

    return { kind: "array", elements, hasRest };
  }

  // Object patterns: { a, b }, { name: n }, { kind: "circle", radius: r }
  if (ts.isObjectLiteralExpression(pattern)) {
    const properties: ObjectPropertyPattern[] = [];
    let hasRest = false;

    for (const prop of pattern.properties) {
      if (ts.isSpreadAssignment(prop)) {
        hasRest = true;
        const name = ts.isIdentifier(prop.expression) ? prop.expression.text : "__rest";
        properties.push({
          key: name,
          pattern: { kind: "variable", name },
          isRest: true,
        });
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        // { name } → binding to 'name'
        properties.push({
          key: prop.name.text,
          pattern: { kind: "variable", name: prop.name.text },
          isRest: false,
        });
      } else if (ts.isPropertyAssignment(prop)) {
        const keyName = ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isStringLiteral(prop.name)
            ? prop.name.text
            : undefined;

        if (keyName === undefined) {
          continue;
        }

        // Recursively analyze the value — could be literal, identifier, nested object/array
        const valuePat = analyzePattern(prop.initializer);
        properties.push({
          key: keyName,
          pattern: valuePat,
          isRest: false,
        });
      }
    }

    return { kind: "object", properties, hasRest };
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

// ============================================================================
// Pattern Code Generation (recursive for nested patterns)
// ============================================================================

/**
 * Collect all variable bindings from a pattern tree (for nested patterns).
 * Returns binding statements that destructure from the given accessor expression.
 */
function collectBindings(
  f: ts.NodeFactory,
  pattern: PatternInfo,
  accessor: ts.Expression
): ts.Statement[] {
  switch (pattern.kind) {
    case "variable":
      return [
        f.createVariableStatement(
          undefined,
          f.createVariableDeclarationList(
            [
              f.createVariableDeclaration(
                f.createIdentifier(pattern.name),
                undefined,
                undefined,
                accessor
              ),
            ],
            ts.NodeFlags.Const
          )
        ),
      ];

    case "array": {
      const stmts: ts.Statement[] = [];
      const nonRestElements = pattern.elements.filter((e) => !e.isRest);
      const restElement = pattern.elements.find((e) => e.isRest);

      for (let i = 0; i < nonRestElements.length; i++) {
        const elem = nonRestElements[i];
        if (elem.pattern.kind === "wildcard") continue;

        const elemAccess = f.createElementAccessExpression(accessor, i);

        if (elem.pattern.kind === "variable") {
          stmts.push(
            f.createVariableStatement(
              undefined,
              f.createVariableDeclarationList(
                [
                  f.createVariableDeclaration(
                    f.createIdentifier(elem.pattern.name),
                    undefined,
                    undefined,
                    elemAccess
                  ),
                ],
                ts.NodeFlags.Const
              )
            )
          );
        } else if (elem.pattern.kind === "literal") {
          // Literal in array position — no binding, checked via condition
        } else {
          stmts.push(...collectBindings(f, elem.pattern, elemAccess));
        }
      }

      if (restElement && restElement.pattern.kind === "variable") {
        // const tail = accessor.slice(nonRestElements.length)
        const sliceCall = f.createCallExpression(
          f.createPropertyAccessExpression(accessor, "slice"),
          undefined,
          [f.createNumericLiteral(nonRestElements.length)]
        );
        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  f.createIdentifier(restElement.pattern.name),
                  undefined,
                  undefined,
                  sliceCall
                ),
              ],
              ts.NodeFlags.Const
            )
          )
        );
      }

      return stmts;
    }

    case "object": {
      const stmts: ts.Statement[] = [];
      const nonRestProps = pattern.properties.filter((p) => !p.isRest);
      const restProp = pattern.properties.find((p) => p.isRest);

      for (const prop of nonRestProps) {
        const propAccess = f.createPropertyAccessExpression(accessor, prop.key);

        if (prop.pattern.kind === "variable") {
          stmts.push(
            f.createVariableStatement(
              undefined,
              f.createVariableDeclarationList(
                [
                  f.createVariableDeclaration(
                    f.createIdentifier(prop.pattern.name),
                    undefined,
                    undefined,
                    propAccess
                  ),
                ],
                ts.NodeFlags.Const
              )
            )
          );
        } else if (prop.pattern.kind === "literal") {
          // Literal match — no binding, already checked via condition
        } else {
          stmts.push(...collectBindings(f, prop.pattern, propAccess));
        }
      }

      if (restProp && restProp.pattern.kind === "variable") {
        // const rest = (({ key1, key2, ...rest }) => rest)(accessor)
        // Simpler: use object destructuring with rest
        const excludeKeys = nonRestProps.map((p) => p.key);
        const restName = restProp.pattern.name;

        // Build: const { key1: _k1, key2: _k2, ...rest } = accessor
        const bindingElements = [
          ...excludeKeys.map((k) =>
            f.createBindingElement(
              undefined,
              f.createIdentifier(k),
              f.createIdentifier(`_excl_${k}`)
            )
          ),
          f.createBindingElement(
            f.createToken(ts.SyntaxKind.DotDotDotToken),
            undefined,
            f.createIdentifier(restName)
          ),
        ];

        stmts.push(
          f.createVariableStatement(
            undefined,
            f.createVariableDeclarationList(
              [
                f.createVariableDeclaration(
                  f.createObjectBindingPattern(bindingElements),
                  undefined,
                  undefined,
                  accessor
                ),
              ],
              ts.NodeFlags.Const
            )
          )
        );
      }

      return stmts;
    }

    default:
      return [];
  }
}

/**
 * Build the structural condition expression for a pattern.
 * Returns undefined for patterns that always match (wildcard, variable).
 */
function buildCondition(
  f: ts.NodeFactory,
  pattern: PatternInfo,
  accessor: ts.Expression
): ts.Expression | undefined {
  switch (pattern.kind) {
    case "literal":
      return f.createBinaryExpression(
        accessor,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        pattern.node
      );

    case "wildcard":
    case "variable":
      return undefined;

    case "array": {
      const parts: ts.Expression[] = [];

      // Array.isArray(accessor)
      parts.push(
        f.createCallExpression(
          f.createPropertyAccessExpression(f.createIdentifier("Array"), "isArray"),
          undefined,
          [accessor]
        )
      );

      const nonRestElements = pattern.elements.filter((e) => !e.isRest);
      const hasRest = pattern.hasRest;

      // Length check
      if (hasRest) {
        // length >= nonRestElements.length
        if (nonRestElements.length > 0) {
          parts.push(
            f.createBinaryExpression(
              f.createPropertyAccessExpression(accessor, "length"),
              ts.SyntaxKind.GreaterThanEqualsToken,
              f.createNumericLiteral(nonRestElements.length)
            )
          );
        }
      } else {
        // Exact length check
        parts.push(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(accessor, "length"),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createNumericLiteral(nonRestElements.length)
          )
        );
      }

      // Literal element checks
      for (let i = 0; i < nonRestElements.length; i++) {
        const elem = nonRestElements[i];
        if (elem.pattern.kind === "literal") {
          parts.push(
            f.createBinaryExpression(
              f.createElementAccessExpression(accessor, i),
              ts.SyntaxKind.EqualsEqualsEqualsToken,
              elem.pattern.node
            )
          );
        } else if (elem.pattern.kind !== "wildcard" && elem.pattern.kind !== "variable") {
          // Nested pattern — recurse for structural conditions
          const nested = buildCondition(
            f,
            elem.pattern,
            f.createElementAccessExpression(accessor, i)
          );
          if (nested) parts.push(nested);
        }
      }

      return parts.reduce((a, b) =>
        f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
      );
    }

    case "object": {
      const parts: ts.Expression[] = [];
      const nonRestProps = pattern.properties.filter((p) => !p.isRest);

      // typeof accessor === "object" && accessor !== null
      parts.push(
        f.createBinaryExpression(
          f.createTypeOfExpression(accessor),
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          f.createStringLiteral("object")
        )
      );
      parts.push(
        f.createBinaryExpression(
          accessor,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          f.createNull()
        )
      );

      for (const prop of nonRestProps) {
        // "key" in accessor
        parts.push(
          f.createBinaryExpression(
            f.createStringLiteral(prop.key),
            ts.SyntaxKind.InKeyword,
            accessor
          )
        );

        // Literal value check: accessor.key === literal
        if (prop.pattern.kind === "literal") {
          parts.push(
            f.createBinaryExpression(
              f.createPropertyAccessExpression(accessor, prop.key),
              ts.SyntaxKind.EqualsEqualsEqualsToken,
              prop.pattern.node
            )
          );
        } else if (prop.pattern.kind !== "wildcard" && prop.pattern.kind !== "variable") {
          // Nested pattern — recurse
          const nested = buildCondition(
            f,
            prop.pattern,
            f.createPropertyAccessExpression(accessor, prop.key)
          );
          if (nested) parts.push(nested);
        }
      }

      return parts.reduce((a, b) =>
        f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
      );
    }

    case "unsupported":
      return undefined;
  }
}

/**
 * Generate statements for a single match arm (pattern + optional guard + result).
 * Handles all pattern kinds including array, object, and nested.
 */
function generateArmStatements(
  ctx: MacroContext,
  f: ts.NodeFactory,
  pattern: PatternInfo,
  scrutineeRef: ts.Expression,
  guard: ts.Expression | undefined,
  result: ts.Expression
): ts.Statement[] {
  switch (pattern.kind) {
    case "literal": {
      const condition = f.createBinaryExpression(
        scrutineeRef,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        pattern.node
      );
      const check = guard
        ? f.createBinaryExpression(condition, ts.SyntaxKind.AmpersandAmpersandToken, guard)
        : condition;
      return [f.createIfStatement(check, f.createReturnStatement(result))];
    }

    case "wildcard": {
      if (guard) {
        return [f.createIfStatement(guard, f.createReturnStatement(result))];
      }
      return [f.createReturnStatement(result)];
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
              scrutineeRef
            ),
          ],
          ts.NodeFlags.Const
        )
      );
      const bodyStatements: ts.Statement[] = [binding];
      if (guard) {
        bodyStatements.push(f.createIfStatement(guard, f.createReturnStatement(result)));
      } else {
        bodyStatements.push(f.createReturnStatement(result));
      }
      return [f.createBlock(bodyStatements, true)];
    }

    case "array":
    case "object": {
      const condition = buildCondition(f, pattern, scrutineeRef);
      const bindings = collectBindings(f, pattern, scrutineeRef);

      const bodyStatements: ts.Statement[] = [...bindings];
      if (guard) {
        bodyStatements.push(f.createIfStatement(guard, f.createReturnStatement(result)));
      } else {
        bodyStatements.push(f.createReturnStatement(result));
      }

      const body = f.createBlock(bodyStatements, true);

      if (condition) {
        return [f.createIfStatement(condition, body)];
      }
      // No condition (unlikely for array/object but defensive)
      return [body];
    }

    case "unsupported":
      ctx.reportError(
        pattern.node,
        `match: unsupported pattern kind (only literals, _, identifiers, arrays, and objects supported)`
      );
      return [];
  }
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
    const armStatements = generateArmStatements(
      ctx,
      f,
      pattern,
      scrutineeRef,
      arm.guard,
      arm.result
    );
    statements.push(...armStatements);
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
