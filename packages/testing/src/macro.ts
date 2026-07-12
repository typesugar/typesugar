/**
 * Testing Macros - Compile-time testing superpowers for TypeScript
 *
 * Inspired by:
 * - Rust: assert_eq!, #[test], proptest!, insta::assert_snapshot!
 * - Elixir: ExUnit's power assertions, doctest
 * - Swift: #expect macro with sub-expression capture
 * - Nim: check() with expression decomposition
 * - Scala 3: derives for Arbitrary, inline assertions
 *
 * Provides:
 * - assert()          — Expression macro: captures every sub-expression on failure
 * - @derive(Arbitrary) — Derive macro: generates random value generators from types
 * - staticAssert()    — Expression macro: fail the BUILD if invariant is violated
 * - @testCases        — Attribute macro: expand one test into N parameterized tests
 * - assertSnapshot()  — Expression macro: snapshot testing with source capture
 * - typeAssert<T>()   — Expression macro: compile-time type relationship checks
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  defineDeriveMacro,
  defineAttributeMacro,
  globalRegistry,
  type MacroContext,
  type DeriveTypeInfo,
  type DeriveFieldInfo,
  type AttributeTarget,
} from "@typesugar/core";

// Re-export test utilities from macro-context
export { createMacroTestContext, parseSource, type TestMacroContext } from "./macro-context.js";

// ============================================================================
// AST construction helpers
// ============================================================================
// Per the repo CLAUDE.md rule ("prefer AST over string manipulation"), every
// macro in this file builds its output skeleton with `ts.factory.create*`
// directly rather than assembling code as a template string and re-parsing it
// via `ctx.parseStatements`/`ctx.parseExpression`. These thin wrappers keep the
// factory calls that follow readable; they carry no logic of their own.

const f = ts.factory;

function id(name: string): ts.Identifier {
  return f.createIdentifier(name);
}
function str(value: string): ts.StringLiteral {
  return f.createStringLiteral(value);
}
function num(value: number | string): ts.NumericLiteral {
  return f.createNumericLiteral(value as never);
}
function prop(expr: ts.Expression, name: string): ts.PropertyAccessExpression {
  return f.createPropertyAccessExpression(expr, name);
}
function elem(expr: ts.Expression, index: ts.Expression | number): ts.ElementAccessExpression {
  return f.createElementAccessExpression(expr, typeof index === "number" ? num(index) : index);
}
function call(
  expr: ts.Expression,
  args: readonly ts.Expression[] = [],
  typeArgs?: readonly ts.TypeNode[]
): ts.CallExpression {
  return f.createCallExpression(expr, typeArgs, args);
}
function paren(expr: ts.Expression): ts.ParenthesizedExpression {
  return f.createParenthesizedExpression(expr);
}
function bin(
  left: ts.Expression,
  op: ts.BinaryOperator,
  right: ts.Expression
): ts.BinaryExpression {
  return f.createBinaryExpression(left, op, right);
}
function not(expr: ts.Expression): ts.PrefixUnaryExpression {
  return f.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, expr);
}
function cond(
  condition: ts.Expression,
  whenTrue: ts.Expression,
  whenFalse: ts.Expression
): ts.ConditionalExpression {
  return f.createConditionalExpression(
    condition,
    f.createToken(ts.SyntaxKind.QuestionToken),
    whenTrue,
    f.createToken(ts.SyntaxKind.ColonToken),
    whenFalse
  );
}
function arr(elements: readonly ts.Expression[], multiline = false): ts.ArrayLiteralExpression {
  return f.createArrayLiteralExpression(elements, multiline);
}
/** Left-associative `+` chain: concat([a, b, c]) === `a + b + c`. */
function concat(parts: readonly ts.Expression[]): ts.Expression {
  return parts.reduce((a, b) => bin(a, ts.SyntaxKind.PlusToken, b));
}
function anyT(): ts.TypeNode {
  return f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
}
function anyArrT(): ts.TypeNode {
  return f.createArrayTypeNode(anyT());
}
function stringArrT(): ts.TypeNode {
  return f.createArrayTypeNode(f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword));
}
function asAny(expr: ts.Expression): ts.AsExpression {
  return f.createAsExpression(expr, anyT());
}
function ret(expr?: ts.Expression): ts.ReturnStatement {
  return f.createReturnStatement(expr);
}
function exprStmt(expr: ts.Expression): ts.ExpressionStatement {
  return f.createExpressionStatement(expr);
}
function block(statements: readonly ts.Statement[]): ts.Block {
  return f.createBlock(statements, true);
}
function arrow(params: readonly ts.ParameterDeclaration[], body: ts.ConciseBody): ts.ArrowFunction {
  return f.createArrowFunction(
    undefined,
    undefined,
    params,
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    body
  );
}
function param(name: string, type?: ts.TypeNode, rest = false): ts.ParameterDeclaration {
  return f.createParameterDeclaration(
    undefined,
    rest ? f.createToken(ts.SyntaxKind.DotDotDotToken) : undefined,
    id(name),
    undefined,
    type,
    undefined
  );
}
function declStmt(
  flag: ts.NodeFlags,
  name: string,
  init: ts.Expression | undefined,
  type?: ts.TypeNode
): ts.VariableStatement {
  return f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [f.createVariableDeclaration(id(name), undefined, type, init)],
      flag
    )
  );
}
function constStmt(name: string, init: ts.Expression, type?: ts.TypeNode): ts.VariableStatement {
  return declStmt(ts.NodeFlags.Const, name, init, type);
}
function letStmt(name: string, init: ts.Expression, type?: ts.TypeNode): ts.VariableStatement {
  return declStmt(ts.NodeFlags.Let, name, init, type);
}
/** `(() => { <body> })()` — an immediately-invoked arrow with no arguments. */
function iife(body: ts.Block): ts.CallExpression {
  return call(paren(arrow([], body)), []);
}

// ============================================================================
// powerAssert() — Power Assertions with Sub-Expression Capture
// ============================================================================

/**
 * Walk a binary/property-access/call expression tree and collect every
 * meaningful sub-expression. Returns an array of { expr, source } pairs
 * where `expr` is the AST node and `source` is its source text.
 */
function collectSubExpressions(
  node: ts.Expression,
  sourceFile: ts.SourceFile
): Array<{ node: ts.Expression; source: string; displayOffset: number }> {
  const exprStart = node.getStart(sourceFile);
  const subs: Array<{ node: ts.Expression; source: string; displayOffset: number }> = [];

  // Compute the column position where this sub-expression's value indicator
  // should appear in the tree diagram. For property access, position at the
  // property name; for binary ops, at the operator; otherwise at the start.
  function getDisplayOffset(n: ts.Expression): number {
    if (ts.isPropertyAccessExpression(n)) {
      return n.name.getStart(sourceFile) - exprStart;
    }
    if (ts.isBinaryExpression(n)) {
      return n.operatorToken.getStart(sourceFile) - exprStart;
    }
    return n.getStart(sourceFile) - exprStart;
  }

  function walk(n: ts.Expression): void {
    // Skip literals — they're self-explanatory
    if (
      ts.isNumericLiteral(n) ||
      ts.isStringLiteral(n) ||
      n.kind === ts.SyntaxKind.TrueKeyword ||
      n.kind === ts.SyntaxKind.FalseKeyword ||
      n.kind === ts.SyntaxKind.NullKeyword
    ) {
      return;
    }

    // Collect this sub-expression with its display column offset
    const source = n.getText(sourceFile);
    subs.push({ node: n, source, displayOffset: getDisplayOffset(n) });

    // Recurse into children
    if (ts.isBinaryExpression(n)) {
      walk(n.left);
      walk(n.right);
    } else if (ts.isPropertyAccessExpression(n)) {
      walk(n.expression);
    } else if (ts.isCallExpression(n)) {
      walk(n.expression);
      for (const arg of n.arguments) {
        walk(arg);
      }
    } else if (ts.isElementAccessExpression(n)) {
      walk(n.expression);
      walk(n.argumentExpression);
    } else if (ts.isPrefixUnaryExpression(n)) {
      walk(n.operand);
    } else if (ts.isParenthesizedExpression(n)) {
      walk(n.expression);
    } else if (ts.isConditionalExpression(n)) {
      walk(n.condition);
      walk(n.whenTrue);
      walk(n.whenFalse);
    }
  }

  walk(node);
  return subs;
}

export const assertMacro = defineExpressionMacro({
  name: "assert",
  module: "@typesugar/testing",
  description:
    "Assert with sub-expression capture — on failure, shows the value of every sub-expression",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        callExpr,
        "assert expects 1 or 2 arguments: assert(expr) or assert(expr, message)"
      );
      return callExpr;
    }

    const expr = args[0];
    const customMessage = args.length === 2 ? args[1] : undefined;
    const sourceFile = ctx.sourceFile;

    // Get the full source text of the assertion expression
    const exprSource = expr.getText(sourceFile);

    // Collect all meaningful sub-expressions
    const subs = collectSubExpressions(expr, sourceFile);

    // Build: const __vals__ = [sub1, sub2, ...] (evaluated left-to-right).
    // These are the REAL sub-expression nodes captured from the source.
    const valElements = subs.map((s) => s.node);

    // Compute display column positions for each sub-expression.
    // The tree diagram shows "  assert(<expr>)" so the prefix is 9 chars.
    const ASSERT_PREFIX_LEN = 9; // "  assert(".length
    const displayPositions = subs.map((s) => s.displayOffset + ASSERT_PREFIX_LEN);

    // Build the power assertion IIFE with a column-aligned tree diagram,
    // entirely via ts.factory. The user's `expr` and `customMessage` nodes are
    // spliced in directly (no print/re-parse round-trip). Display positions are
    // embedded as compile-time numeric-literal constants.
    //
    // Equivalent source:
    //
    // (() => {
    //   const __pa_result__ = <expr>;
    //   if (!__pa_result__) {
    //     const __pa_vals__: any[] = [<sub1>, <sub2>, ...];
    //     let __pa_msg__: any = <customMessage>;
    //     ...builds a column-aligned tree diagram of every sub-expression value...
    //     throw new Error(__pa_d__);
    //   }
    // })()

    // `__pa_row__ = (vs, ps) => { ... }` — renders one row of the diagram.
    const csIdxK0 = () => elem(elem(id("cs"), id("k")), 0);
    const csIdxK1 = () => elem(elem(id("cs"), id("k")), 1);
    const rowArrow = arrow(
      [param("vs", anyT()), param("ps", anyT())],
      block([
        // var cs = vs.concat(ps.map((p) => [p, "|"]));
        letStmt(
          "cs",
          call(prop(id("vs"), "concat"), [
            call(prop(id("ps"), "map"), [
              arrow([param("p", anyT())], block([ret(arr([id("p"), str("|")]))])),
            ]),
          ])
        ),
        // cs.sort((a, b) => a[0] - b[0]);
        exprStmt(
          call(prop(id("cs"), "sort"), [
            arrow(
              [param("a", anyT()), param("b", anyT())],
              block([ret(bin(elem(id("a"), 0), ts.SyntaxKind.MinusToken, elem(id("b"), 0)))])
            ),
          ])
        ),
        letStmt("s", str("")),
        letStmt("c", num(0)),
        // for (let k = 0; k < cs.length; k++) { ... }
        f.createForStatement(
          f.createVariableDeclarationList(
            [f.createVariableDeclaration(id("k"), undefined, undefined, num(0))],
            ts.NodeFlags.Let
          ),
          bin(id("k"), ts.SyntaxKind.LessThanToken, prop(id("cs"), "length")),
          f.createPostfixUnaryExpression(id("k"), ts.SyntaxKind.PlusPlusToken),
          block([
            // if (cs[k][0] < c) continue;
            f.createIfStatement(
              bin(csIdxK0(), ts.SyntaxKind.LessThanToken, id("c")),
              f.createContinueStatement(undefined),
              undefined
            ),
            // if (c < cs[k][0]) { s += " ".repeat(cs[k][0] - c); c = cs[k][0]; }
            f.createIfStatement(
              bin(id("c"), ts.SyntaxKind.LessThanToken, csIdxK0()),
              block([
                exprStmt(
                  bin(
                    id("s"),
                    ts.SyntaxKind.PlusEqualsToken,
                    call(prop(str(" "), "repeat"), [
                      bin(csIdxK0(), ts.SyntaxKind.MinusToken, id("c")),
                    ])
                  )
                ),
                exprStmt(bin(id("c"), ts.SyntaxKind.EqualsToken, csIdxK0())),
              ]),
              undefined
            ),
            // s += cs[k][1];
            exprStmt(bin(id("s"), ts.SyntaxKind.PlusEqualsToken, csIdxK1())),
            // c += cs[k][1].length;
            exprStmt(bin(id("c"), ts.SyntaxKind.PlusEqualsToken, prop(csIdxK1(), "length"))),
          ])
        ),
        ret(id("s")),
      ])
    );

    // Body of `while (__pa_rm__.length > 0) { ... }`.
    const rmIdxK0 = () => elem(elem(id("__pa_rm__"), id("k")), 0);
    const rmIdxK1 = () => elem(elem(id("__pa_rm__"), id("k")), 1);
    const whileBody = block([
      letStmt("__pa_rw__", arr([]), anyArrT()),
      letStmt("__pa_nx__", arr([]), anyArrT()),
      letStmt("__pa_le__", f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, id("Infinity"))),
      f.createForStatement(
        f.createVariableDeclarationList(
          [f.createVariableDeclaration(id("k"), undefined, undefined, num(0))],
          ts.NodeFlags.Let
        ),
        bin(id("k"), ts.SyntaxKind.LessThanToken, prop(id("__pa_rm__"), "length")),
        f.createPostfixUnaryExpression(id("k"), ts.SyntaxKind.PlusPlusToken),
        block([
          letStmt("dc", rmIdxK0()),
          // if (dc >= __pa_le__ + 1) { rw.push(...); le = ... } else { nx.push(...) }
          f.createIfStatement(
            bin(
              id("dc"),
              ts.SyntaxKind.GreaterThanEqualsToken,
              bin(id("__pa_le__"), ts.SyntaxKind.PlusToken, num(1))
            ),
            block([
              exprStmt(call(prop(id("__pa_rw__"), "push"), [arr([id("dc"), rmIdxK1()])])),
              exprStmt(
                bin(
                  id("__pa_le__"),
                  ts.SyntaxKind.EqualsToken,
                  bin(id("dc"), ts.SyntaxKind.PlusToken, prop(rmIdxK1(), "length"))
                )
              ),
            ]),
            block([exprStmt(call(prop(id("__pa_nx__"), "push"), [elem(id("__pa_rm__"), id("k"))]))])
          ),
        ])
      ),
      // __pa_d__ += __pa_row__(__pa_rw__, __pa_nx__.map((x) => x[0])) + "\n";
      exprStmt(
        bin(
          id("__pa_d__"),
          ts.SyntaxKind.PlusEqualsToken,
          bin(
            call(id("__pa_row__"), [
              id("__pa_rw__"),
              call(prop(id("__pa_nx__"), "map"), [
                arrow([param("x", anyT())], block([ret(elem(id("x"), 0))])),
              ]),
            ]),
            ts.SyntaxKind.PlusToken,
            str("\n")
          )
        )
      ),
      exprStmt(bin(id("__pa_rm__"), ts.SyntaxKind.EqualsToken, id("__pa_nx__"))),
    ]);

    // Statements inside `if (!__pa_result__) { ... }`.
    const ifBody = block([
      constStmt("__pa_vals__", arr(valElements), anyArrT()),
      letStmt("__pa_msg__", customMessage ?? id("undefined"), anyT()),
      // __pa_fv__ = __pa_vals__.map((v) => { try { return JSON.stringify(v); } catch(e) { return String(v); } });
      letStmt(
        "__pa_fv__",
        call(prop(id("__pa_vals__"), "map"), [
          arrow(
            [param("v", anyT())],
            block([
              f.createTryStatement(
                block([ret(call(prop(id("JSON"), "stringify"), [id("v")]))]),
                f.createCatchClause(
                  f.createVariableDeclaration(id("e")),
                  block([ret(call(id("String"), [id("v")]))])
                ),
                undefined
              ),
            ])
          ),
        ])
      ),
      // __pa_it__ = [<positions>].map((p, i) => [p, __pa_fv__[i]]).sort((a, b) => a[1].length - b[1].length || a[0] - b[0]);
      letStmt(
        "__pa_it__",
        call(
          prop(
            call(prop(arr(displayPositions.map((p) => num(p))), "map"), [
              arrow(
                [param("p", anyT()), param("i", anyT())],
                block([ret(arr([id("p"), elem(id("__pa_fv__"), id("i"))]))])
              ),
            ]),
            "sort"
          ),
          [
            arrow(
              [param("a", anyT()), param("b", anyT())],
              block([
                ret(
                  bin(
                    bin(
                      prop(elem(id("a"), 1), "length"),
                      ts.SyntaxKind.MinusToken,
                      prop(elem(id("b"), 1), "length")
                    ),
                    ts.SyntaxKind.BarBarToken,
                    bin(elem(id("a"), 0), ts.SyntaxKind.MinusToken, elem(id("b"), 0))
                  )
                ),
              ])
            ),
          ]
        ),
        anyArrT()
      ),
      // __pa_d__ = "\n\nPower Assert Failed" + (__pa_msg__ ? ": " + __pa_msg__ : "") + "\n\n  assert(" + <exprSource> + ")\n";
      letStmt(
        "__pa_d__",
        concat([
          str("\n\nPower Assert Failed"),
          paren(
            cond(
              id("__pa_msg__"),
              bin(str(": "), ts.SyntaxKind.PlusToken, id("__pa_msg__")),
              str("")
            )
          ),
          str("\n\n  assert("),
          str(exprSource),
          str(")\n"),
        ])
      ),
      constStmt("__pa_row__", rowArrow),
      // __pa_ap__ = __pa_it__.map((x) => x[0]);
      letStmt(
        "__pa_ap__",
        call(prop(id("__pa_it__"), "map"), [
          arrow([param("x", anyT())], block([ret(elem(id("x"), 0))])),
        ])
      ),
      // __pa_d__ += __pa_row__([], __pa_ap__) + "\n";
      exprStmt(
        bin(
          id("__pa_d__"),
          ts.SyntaxKind.PlusEqualsToken,
          bin(
            call(id("__pa_row__"), [arr([]), id("__pa_ap__")]),
            ts.SyntaxKind.PlusToken,
            str("\n")
          )
        )
      ),
      letStmt("__pa_rm__", call(prop(id("__pa_it__"), "slice")), anyArrT()),
      f.createWhileStatement(
        bin(prop(id("__pa_rm__"), "length"), ts.SyntaxKind.GreaterThanToken, num(0)),
        whileBody
      ),
      f.createThrowStatement(f.createNewExpression(id("Error"), undefined, [id("__pa_d__")])),
    ]);

    return iife(
      block([
        constStmt("__pa_result__", expr),
        f.createIfStatement(not(id("__pa_result__")), ifBody, undefined),
      ])
    );
  },
});

// ============================================================================
// @derive(Arbitrary) — Generate Random Value Generators from Types
// ============================================================================

export const ArbitraryDerive = defineDeriveMacro({
  name: "Arbitrary",
  description: "Generate a random value generator (Arbitrary instance) for property-based testing",

  expand(
    _ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const fnName = `arbitrary${name}`;
    const manyName = `${fnName}Many`;
    const numberT = () => f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
    const typeRef = f.createTypeReferenceNode(name, undefined);
    const exportMod = [f.createModifier(ts.SyntaxKind.ExportKeyword)];
    const optionalParam = (n: string, t: ts.TypeNode) =>
      f.createParameterDeclaration(
        undefined,
        undefined,
        id(n),
        f.createToken(ts.SyntaxKind.QuestionToken),
        t,
        undefined
      );
    const seedNotUndefined = () =>
      bin(id("seed"), ts.SyntaxKind.ExclamationEqualsEqualsToken, id("undefined"));

    // Random value for each field, built directly as expression nodes.
    const fieldProps = fields.map((field) =>
      f.createPropertyAssignment(field.name, getArbitraryForType(field))
    );

    // export function arbitrary<Name>(seed?: number): <Name> {
    //   const _rng = seed !== undefined ? _seededRandom(seed) : Math.random;
    //   return { <fields> };
    // }
    const arbFn = f.createFunctionDeclaration(
      exportMod,
      undefined,
      fnName,
      undefined,
      [optionalParam("seed", numberT())],
      typeRef,
      block([
        constStmt(
          "_rng",
          cond(
            seedNotUndefined(),
            call(id("_seededRandom"), [id("seed")]),
            prop(id("Math"), "random")
          )
        ),
        ret(f.createObjectLiteralExpression(fieldProps, true)),
      ])
    );

    // export function arbitrary<Name>Many(count: number, seed?: number): <Name>[] {
    //   const results: <Name>[] = [];
    //   for (let i = 0; i < count; i++) {
    //     results.push(arbitrary<Name>(seed !== undefined ? seed + i : undefined));
    //   }
    //   return results;
    // }
    const manyFn = f.createFunctionDeclaration(
      exportMod,
      undefined,
      manyName,
      undefined,
      [param("count", numberT()), optionalParam("seed", numberT())],
      f.createArrayTypeNode(typeRef),
      block([
        constStmt("results", arr([]), f.createArrayTypeNode(typeRef)),
        f.createForStatement(
          f.createVariableDeclarationList(
            [f.createVariableDeclaration(id("i"), undefined, undefined, num(0))],
            ts.NodeFlags.Let
          ),
          bin(id("i"), ts.SyntaxKind.LessThanToken, id("count")),
          f.createPostfixUnaryExpression(id("i"), ts.SyntaxKind.PlusPlusToken),
          block([
            exprStmt(
              call(prop(id("results"), "push"), [
                call(id(fnName), [
                  cond(
                    seedNotUndefined(),
                    bin(id("seed"), ts.SyntaxKind.PlusToken, id("i")),
                    id("undefined")
                  ),
                ]),
              ])
            ),
          ])
        ),
        ret(id("results")),
      ])
    );

    // The seeded PRNG helper (a plain LCG). Emitted alongside the generators.
    // function _seededRandom(seed: number): () => number {
    //   let s = seed;
    //   return () => {
    //     s = (s * 1664525 + 1013904223) & 0xffffffff;
    //     return (s >>> 0) / 0xffffffff;
    //   };
    // }
    const seededRandomFn = f.createFunctionDeclaration(
      undefined,
      undefined,
      "_seededRandom",
      undefined,
      [param("seed", numberT())],
      f.createFunctionTypeNode(undefined, [], numberT()),
      block([
        letStmt("s", id("seed")),
        ret(
          arrow(
            [],
            block([
              exprStmt(
                bin(
                  id("s"),
                  ts.SyntaxKind.EqualsToken,
                  bin(
                    paren(
                      bin(
                        bin(id("s"), ts.SyntaxKind.AsteriskToken, num(1664525)),
                        ts.SyntaxKind.PlusToken,
                        num(1013904223)
                      )
                    ),
                    ts.SyntaxKind.AmpersandToken,
                    num("0xffffffff")
                  )
                )
              ),
              ret(
                bin(
                  paren(bin(id("s"), ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken, num(0))),
                  ts.SyntaxKind.SlashToken,
                  num("0xffffffff")
                )
              ),
            ])
          )
        ),
      ])
    );

    return [seededRandomFn, arbFn, manyFn];
  },
});

/** Build the per-field random-value generator expression for one field. */
function getArbitraryForType(field: DeriveFieldInfo): ts.Expression {
  const typeStr = field.typeString.toLowerCase();
  const inner = getArbitraryForBaseType(typeStr);

  if (field.optional) {
    // (_rng() > 0.5 ? <inner> : undefined)
    return paren(
      cond(
        bin(call(id("_rng")), ts.SyntaxKind.GreaterThanToken, num("0.5")),
        inner,
        id("undefined")
      )
    );
  }

  return inner;
}

function getArbitraryForBaseType(typeStr: string): ts.Expression {
  // _rng() * 20, _rng() * 26 etc.
  const rngTimes = (n: number) => bin(call(id("_rng")), ts.SyntaxKind.AsteriskToken, num(n));
  const mathFloor = (e: ts.Expression) => call(prop(id("Math"), "floor"), [e]);

  if (typeStr === "number") {
    // (_rng() * 200 - 100)
    return paren(bin(rngTimes(200), ts.SyntaxKind.MinusToken, num(100)));
  }
  if (typeStr === "string") {
    // String.fromCharCode(...Array.from({ length: Math.floor(_rng() * 20) + 1 },
    //                                   () => Math.floor(_rng() * 26) + 97))
    return call(prop(id("String"), "fromCharCode"), [
      f.createSpreadElement(
        call(prop(id("Array"), "from"), [
          f.createObjectLiteralExpression([
            f.createPropertyAssignment(
              "length",
              bin(mathFloor(rngTimes(20)), ts.SyntaxKind.PlusToken, num(1))
            ),
          ]),
          arrow([], bin(mathFloor(rngTimes(26)), ts.SyntaxKind.PlusToken, num(97))),
        ])
      ),
    ]);
  }
  if (typeStr === "boolean") {
    // (_rng() > 0.5)
    return paren(bin(call(id("_rng")), ts.SyntaxKind.GreaterThanToken, num("0.5")));
  }
  if (typeStr.includes("[]") || typeStr.startsWith("array")) {
    return arr([]);
  }
  // Default: ({} as any)
  return paren(asAny(f.createObjectLiteralExpression([])));
}

// ============================================================================
// comptimeAssert() — Compile-Time Build Assertions
// ============================================================================

// Re-export staticAssertMacro from @typesugar/macros to avoid duplicate registration
import { staticAssertMacro as _staticAssertMacro } from "@typesugar/macros";
export const staticAssertMacro = _staticAssertMacro;

// ============================================================================
// @testCases — Parameterized Test Generation
// ============================================================================

export const testCasesAttribute = defineAttributeMacro({
  name: "testCases",
  module: "@typesugar/testing",
  description: "Expand a single test function into multiple parameterized test cases",
  validTargets: ["function"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isFunctionDeclaration(target)) {
      ctx.reportError(target, "@testCases can only be applied to function declarations");
      return target;
    }

    if (args.length !== 1 || !ts.isArrayLiteralExpression(args[0])) {
      ctx.reportError(
        _decorator,
        "@testCases expects a single array argument of test case objects"
      );
      return target;
    }

    const casesArray = args[0] as ts.ArrayLiteralExpression;
    const fnName = target.name?.text ?? "anonymous";
    const params = target.parameters;
    const body = target.body;

    if (!body) {
      ctx.reportError(target, "@testCases: function must have a body");
      return target;
    }

    const statements: ts.Statement[] = [];
    // Only used to render the (compile-time) descriptive test *label* string;
    // the destructured values and the function body are used as real AST nodes.
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

    for (let i = 0; i < casesArray.elements.length; i++) {
      const caseExpr = casesArray.elements[i];

      if (!ts.isObjectLiteralExpression(caseExpr)) {
        ctx.reportError(caseExpr, `@testCases: element ${i} must be an object literal`);
        continue;
      }

      // For each named property collect BOTH the real initializer node (spliced
      // into the destructuring `const`s) and a printed form (for the label only).
      const propInits = new Map<string, ts.Expression>();
      const propLabels = new Map<string, string>();
      for (const member of caseExpr.properties) {
        if (ts.isPropertyAssignment(member) && ts.isIdentifier(member.name)) {
          propInits.set(member.name.text, member.initializer);
          propLabels.set(
            member.name.text,
            printer.printNode(ts.EmitHint.Expression, member.initializer, ctx.sourceFile)
          );
        }
      }

      // Build a descriptive test name, e.g. `add (case #1: a=1, b=2)`.
      const caseLabel = Array.from(propLabels.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      const testLabel = `${fnName} (case #${i + 1}: ${caseLabel})`;

      // Destructure the case object into the function's parameters:
      //   const <param> = <initializer>;
      const paramNames = params.map((p) => (ts.isIdentifier(p.name) ? p.name.text : `_p${i}`));
      const destructureStmts: ts.Statement[] = paramNames.flatMap((name) => {
        const init = propInits.get(name);
        return init !== undefined ? [constStmt(name, init)] : [];
      });

      // it("<label>", () => { <destructuring>; <original function body statements> })
      // `body.statements` are the REAL statement nodes from the source function —
      // spliced directly, with no print/regex/re-parse round-trip.
      statements.push(
        exprStmt(
          call(id("it"), [
            str(testLabel),
            arrow([], block([...destructureStmts, ...body.statements])),
          ])
        )
      );
    }

    return statements;
  },
});

// ============================================================================
// assertSnapshot() — Snapshot Testing with Source Capture
// ============================================================================

export const assertSnapshotMacro = defineExpressionMacro({
  name: "assertSnapshot",
  module: "@typesugar/testing",
  description:
    "Snapshot testing macro that captures the source expression text alongside the value",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        callExpr,
        "assertSnapshot expects 1 or 2 arguments: assertSnapshot(expr) or assertSnapshot(expr, snapshotName)"
      );
      return callExpr;
    }

    const expr = args[0];
    const snapshotName = args.length === 2 ? args[1] : undefined;
    const factory = ctx.factory;

    // Capture the source text of the expression at compile time
    const exprSource = expr.getText ? expr.getText(ctx.sourceFile) : "<expression>";

    // Get file and line info
    const start = callExpr.getStart(ctx.sourceFile);
    const { line } = ctx.sourceFile.getLineAndCharacterOfPosition(start);
    const fileName = ctx.sourceFile.fileName;

    // Generate:
    // expect(<expr>).toMatchSnapshot(
    //   `<fileName>:<line> — <exprSource>` + (snapshotName ? ` [${snapshotName}]` : "")
    // )
    const snapshotLabel = `${fileName}:${line + 1} — ${exprSource}`;

    const snapshotArgs: ts.Expression[] = [];

    if (snapshotName) {
      // Template: `${snapshotLabel} [${snapshotName}]`
      snapshotArgs.push(
        factory.createTemplateExpression(factory.createTemplateHead(`${snapshotLabel} [`), [
          factory.createTemplateSpan(snapshotName, factory.createTemplateTail("]")),
        ])
      );
    } else {
      snapshotArgs.push(factory.createStringLiteral(snapshotLabel));
    }

    // Build: expect(<expr>).toMatchSnapshot(<label>)
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createCallExpression(factory.createIdentifier("expect"), undefined, [expr]),
        "toMatchSnapshot"
      ),
      undefined,
      snapshotArgs
    );
  },
});

// ============================================================================
// typeAssert<T>() — Compile-Time Type Relationship Checks
// ============================================================================

export const typeAssertMacro = defineExpressionMacro({
  name: "typeAssert",
  module: "@typesugar/testing",
  description:
    "Assert type relationships at compile time — fails the build if the type constraint is not satisfied",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(
        callExpr,
        "typeAssert requires exactly one type argument: typeAssert<Condition>()"
      );
      return callExpr;
    }

    const typeArg = typeArgs[0];
    const type = ctx.typeChecker.getTypeFromTypeNode(typeArg);
    const typeStr = ctx.typeChecker.typeToString(type);

    // The type argument should resolve to `true` (literal type).
    // If it resolves to `false` or anything else, the assertion fails.
    if (type.isLiteral()) {
      const literalValue = (type as ts.LiteralType).value;
      // Boolean literals have value as boolean, strings/numbers have their respective types
      if ((literalValue as unknown) === true || literalValue === "true") {
        // Assertion passes — emit void 0
        return factory.createVoidExpression(factory.createNumericLiteral(0));
      }
    }

    // Check if it's the intrinsic `true` type (not a literal)
    if (typeStr === "true") {
      return factory.createVoidExpression(factory.createNumericLiteral(0));
    }

    // Check if it's `false` — definite failure
    if (typeStr === "false") {
      const sourceText = typeArg.getText ? typeArg.getText(ctx.sourceFile) : typeStr;
      ctx.reportError(
        callExpr,
        `Type assertion failed: typeAssert<${sourceText}> resolved to false`
      );
      return factory.createVoidExpression(factory.createNumericLiteral(0));
    }

    // If the type is `boolean` (union of true | false), it means the
    // type-level computation is ambiguous — warn but don't fail
    if (typeStr === "boolean") {
      const sourceText = typeArg.getText ? typeArg.getText(ctx.sourceFile) : typeStr;
      ctx.reportWarning(
        callExpr,
        `Type assertion ambiguous: typeAssert<${sourceText}> resolved to boolean (expected true)`
      );
    }

    // For any other type, it's a failure
    if (typeStr !== "true" && typeStr !== "boolean") {
      const sourceText = typeArg.getText ? typeArg.getText(ctx.sourceFile) : typeStr;
      ctx.reportError(
        callExpr,
        `Type assertion failed: typeAssert<${sourceText}> resolved to ${typeStr} (expected true)`
      );
    }

    return factory.createVoidExpression(factory.createNumericLiteral(0));
  },
});

// ============================================================================
// forAll() — Property-Based Test Runner (Expression Macro)
// ============================================================================

export const forAllMacro = defineExpressionMacro({
  name: "forAll",
  module: "@typesugar/testing",
  description:
    "Run a property-based test with auto-generated values. Uses @derive(Arbitrary) generators.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length < 2 || args.length > 3) {
      ctx.reportError(
        callExpr,
        "forAll expects 2-3 arguments: forAll(generator, property) or forAll(generator, count, property)"
      );
      return callExpr;
    }

    const generator = args[0];
    const count = args.length === 3 ? args[1] : num(100);
    const property = args.length === 3 ? args[2] : args[1];

    // Generate hygienic variable names
    const iName = ctx.generateUniqueName("fa_i").text;
    const valueName = ctx.generateUniqueName("fa_value").text;
    const eName = ctx.generateUniqueName("fa_e").text;
    const errName = ctx.generateUniqueName("fa_err").text;

    // Build directly via ts.factory (the user's `generator`, `count` and
    // `property` nodes are spliced in as-is):
    //
    // (() => {
    //   for (let <i> = 0; <i> < <count>; <i>++) {
    //     const <value> = <generator>(<i>);
    //     try {
    //       (<property>)(<value>);
    //     } catch (<e>) {
    //       const <err> = <e> instanceof Error ? <e>.message : String(<e>);
    //       throw new Error(
    //         "Property failed after " + (<i> + 1) + " tests.\n" +
    //         "Failing input: " + JSON.stringify(<value>) + "\n" +
    //         "Error: " + <err>
    //       );
    //     }
    //   }
    // })()

    const errorMessage = concat([
      str("Property failed after "),
      paren(bin(id(iName), ts.SyntaxKind.PlusToken, num(1))),
      str(" tests.\n"),
      str("Failing input: "),
      call(prop(id("JSON"), "stringify"), [id(valueName)]),
      str("\n"),
      str("Error: "),
      id(errName),
    ]);

    const catchClause = f.createCatchClause(
      f.createVariableDeclaration(id(eName)),
      block([
        constStmt(
          errName,
          cond(
            bin(id(eName), ts.SyntaxKind.InstanceOfKeyword, id("Error")),
            prop(id(eName), "message"),
            call(id("String"), [id(eName)])
          )
        ),
        f.createThrowStatement(f.createNewExpression(id("Error"), undefined, [errorMessage])),
      ])
    );

    const forBody = block([
      // const <value> = <generator>(<i>);
      constStmt(valueName, call(generator, [id(iName)])),
      // try { (<property>)(<value>); } catch (<e>) { ... }
      f.createTryStatement(
        block([exprStmt(call(paren(property), [id(valueName)]))]),
        catchClause,
        undefined
      ),
    ]);

    const forStmt = f.createForStatement(
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(id(iName), undefined, undefined, num(0))],
        ts.NodeFlags.Let
      ),
      bin(id(iName), ts.SyntaxKind.LessThanToken, count),
      f.createPostfixUnaryExpression(id(iName), ts.SyntaxKind.PlusPlusToken),
      forBody
    );

    return iife(block([forStmt]));
  },
});

// ============================================================================
// assertType<T>(value) — Runtime Type Assertion with Detailed Diagnostics
// ============================================================================

/**
 * `assertType<T>(value)` uses compile-time type information (via `typeInfo<T>()`)
 * to validate that a runtime value matches the expected structure. On failure,
 * it produces rich diagnostics showing exactly which fields are missing, have
 * wrong types, or have unexpected values.
 *
 * @example
 * ```typescript
 * interface User {
 *   id: number;
 *   name: string;
 *   email?: string;
 * }
 *
 * // Passes if valid
 * assertType<User>({ id: 1, name: "Alice" });
 *
 * // Fails with detailed diagnostics:
 * // "Type assertion failed for 'User':
 * //   - Field 'id': expected number, got string
 * //   - Field 'name': missing (required)"
 * assertType<User>({ id: "not-a-number" });
 * ```
 */
export const assertTypeMacro = defineExpressionMacro({
  name: "assertType",
  module: "@typesugar/testing",
  description:
    "Assert that a value matches a type at runtime with detailed field-level diagnostics",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(
        callExpr,
        "assertType requires exactly one type argument: assertType<T>(value)"
      );
      return callExpr;
    }

    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        callExpr,
        "assertType expects 1 or 2 arguments: assertType<T>(value) or assertType<T>(value, message)"
      );
      return callExpr;
    }

    const valueExpr = args[0];
    const customMessage = args.length === 2 ? args[1] : undefined;
    const typeArg = typeArgs[0];

    // Get type information at compile time
    const type = ctx.typeChecker.getTypeFromTypeNode(typeArg);
    const typeName = ctx.typeChecker.typeToString(type);
    const properties = ctx.typeChecker.getPropertiesOfType(type);

    // Build field metadata array at compile time
    const fieldInfos: Array<{
      name: string;
      type: string;
      optional: boolean;
    }> = properties.map((sym) => {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(sym, callExpr);
      return {
        name: sym.name,
        type: ctx.typeChecker.typeToString(propType),
        optional: (sym.flags & ts.SymbolFlags.Optional) !== 0,
      };
    });

    // Generate unique variable names
    const valueName = ctx.generateUniqueName("at_value").text;
    const errorsName = ctx.generateUniqueName("at_errors").text;
    const fieldName = ctx.generateUniqueName("at_field").text;
    const actualName = ctx.generateUniqueName("at_actual").text;

    // Field metadata array literal (compile-time type info as runtime data).
    const fieldMetaElements = fieldInfos.map((fi) =>
      f.createObjectLiteralExpression([
        f.createPropertyAssignment("name", str(fi.name)),
        f.createPropertyAssignment("type", str(fi.type)),
        f.createPropertyAssignment("optional", fi.optional ? f.createTrue() : f.createFalse()),
      ])
    );

    const valueId = () => id(valueName);
    const errorsId = () => id(errorsName);
    const fieldId = () => id(fieldName);
    const actualId = () => id(actualName);
    const pushErr = (message: ts.Expression) => exprStmt(call(prop(errorsId(), "push"), [message]));

    // `Field '${field.name}': expected <kind>, got ${actualType}`
    const fieldExpectedTemplate = (kind: string): ts.TemplateExpression =>
      f.createTemplateExpression(f.createTemplateHead("Field '"), [
        f.createTemplateSpan(
          prop(fieldId(), "name"),
          f.createTemplateMiddle(`': expected ${kind}, got `)
        ),
        f.createTemplateSpan(id("actualType"), f.createTemplateTail("")),
      ]);

    // if (expectedType === "<kind>" && actualType !== "<kind>") errors.push(...)
    const primitiveCheck = (kind: string, otherwise: ts.Statement | undefined): ts.IfStatement =>
      f.createIfStatement(
        bin(
          bin(id("expectedType"), ts.SyntaxKind.EqualsEqualsEqualsToken, str(kind)),
          ts.SyntaxKind.AmpersandAmpersandToken,
          bin(id("actualType"), ts.SyntaxKind.ExclamationEqualsEqualsToken, str(kind))
        ),
        block([pushErr(fieldExpectedTemplate(kind))]),
        otherwise
      );

    // else if (expectedType.endsWith("[]") && !Array.isArray(<actual>)) errors.push(...)
    const arrayCheck = f.createIfStatement(
      bin(
        call(prop(id("expectedType"), "endsWith"), [str("[]")]),
        ts.SyntaxKind.AmpersandAmpersandToken,
        not(call(prop(id("Array"), "isArray"), [actualId()]))
      ),
      block([pushErr(fieldExpectedTemplate("array"))]),
      undefined
    );

    // The `if / else if / else if / else if` primitive-validation chain.
    const typeCheckChain = primitiveCheck(
      "string",
      primitiveCheck("number", primitiveCheck("boolean", arrayCheck))
    );

    // for (const <field> of __at_fields__) { ... }
    const forOfBody = block([
      // const <actual> = (<value> as any)[<field>.name];
      constStmt(actualName, elem(paren(asAny(valueId())), prop(fieldId(), "name"))),
      // if (<actual> === undefined) { if (!<field>.optional) errors.push(...); continue; }
      f.createIfStatement(
        bin(actualId(), ts.SyntaxKind.EqualsEqualsEqualsToken, id("undefined")),
        block([
          f.createIfStatement(
            not(prop(fieldId(), "optional")),
            block([
              pushErr(
                f.createTemplateExpression(f.createTemplateHead("Field '"), [
                  f.createTemplateSpan(
                    prop(fieldId(), "name"),
                    f.createTemplateMiddle("': missing (required, expected ")
                  ),
                  f.createTemplateSpan(prop(fieldId(), "type"), f.createTemplateTail(")")),
                ])
              ),
            ]),
            undefined
          ),
          f.createContinueStatement(undefined),
        ]),
        undefined
      ),
      constStmt("actualType", f.createTypeOfExpression(actualId())),
      constStmt("expectedType", prop(fieldId(), "type")),
      typeCheckChain,
    ]);

    // Body of `if (<errors>.length > 0) { ... }` — the runtime failure message.
    // Per the AST-purity rule, `typeName` is baked into string *literals* and
    // the optional custom message is appended via `+` concatenation; we never
    // splice text into a whole statement.
    const finalIfStmts: ts.Statement[] = [
      letStmt("msg", str(`Type assertion failed for '${typeName}'`)),
    ];
    if (customMessage) {
      finalIfStmts.push(
        f.createIfStatement(
          bin(customMessage, ts.SyntaxKind.ExclamationEqualsEqualsToken, id("undefined")),
          block([
            exprStmt(
              bin(
                id("msg"),
                ts.SyntaxKind.PlusEqualsToken,
                bin(str(": "), ts.SyntaxKind.PlusToken, customMessage)
              )
            ),
          ]),
          undefined
        )
      );
    }
    finalIfStmts.push(
      exprStmt(
        bin(
          id("msg"),
          ts.SyntaxKind.PlusEqualsToken,
          bin(
            str("\n  - "),
            ts.SyntaxKind.PlusToken,
            call(prop(errorsId(), "join"), [str("\n  - ")])
          )
        )
      ),
      f.createThrowStatement(f.createNewExpression(id("Error"), undefined, [id("msg")]))
    );

    return iife(
      block([
        // const <value> = <valueExpr>;
        constStmt(valueName, valueExpr),
        // const <errors>: string[] = [];
        constStmt(errorsName, arr([]), stringArrT()),
        // if (typeof <value> !== "object" || <value> === null) { throw ... }
        f.createIfStatement(
          bin(
            bin(
              f.createTypeOfExpression(valueId()),
              ts.SyntaxKind.ExclamationEqualsEqualsToken,
              str("object")
            ),
            ts.SyntaxKind.BarBarToken,
            bin(valueId(), ts.SyntaxKind.EqualsEqualsEqualsToken, f.createNull())
          ),
          block([
            f.createThrowStatement(
              f.createNewExpression(id("Error"), undefined, [
                concat([
                  str(`Type assertion failed for '${typeName}': expected object, got `),
                  paren(
                    cond(
                      bin(valueId(), ts.SyntaxKind.EqualsEqualsEqualsToken, f.createNull()),
                      str("null"),
                      f.createTypeOfExpression(valueId())
                    )
                  ),
                ]),
              ])
            ),
          ]),
          undefined
        ),
        // const __at_fields__ = [<field metadata>];
        constStmt("__at_fields__", arr(fieldMetaElements, true)),
        // for (const <field> of __at_fields__) { ... }
        f.createForOfStatement(
          undefined,
          f.createVariableDeclarationList(
            [f.createVariableDeclaration(fieldId())],
            ts.NodeFlags.Const
          ),
          id("__at_fields__"),
          forOfBody
        ),
        // if (<errors>.length > 0) { ... }
        f.createIfStatement(
          bin(prop(errorsId(), "length"), ts.SyntaxKind.GreaterThanToken, num(0)),
          block(finalIfStmts),
          undefined
        ),
      ])
    );
  },
});

// ============================================================================
// typeInfo<T>() — Compile-Time Type Reflection
// ============================================================================

// Re-export typeInfoMacro from @typesugar/macros to avoid duplicate registration
export { typeInfoMacro } from "@typesugar/macros";

// ============================================================================
// @mock — Generate Mock Implementations from Interfaces
// ============================================================================

/**
 * `@mock` decorator that generates a mock implementation from an interface
 * or class declaration. The mock tracks all method calls and allows stubbing
 * return values.
 *
 * @example
 * ```typescript
 * interface UserService {
 *   getUser(id: string): Promise<User>;
 *   createUser(data: UserInput): Promise<User>;
 * }
 *
 * @mock
 * interface UserService {}
 *
 * // Generates:
 * // const mockUserService: MockOf<UserService> = {
 * //   getUser: createMockFn<(id: string) => Promise<User>>(),
 * //   createUser: createMockFn<(data: UserInput) => Promise<User>>(),
 * //   _calls: { getUser: [], createUser: [] },
 * //   _reset: () => { ... }
 * // }
 *
 * // Usage in tests:
 * mockUserService.getUser.mockReturnValue(Promise.resolve(testUser));
 * await service.getUser("123");
 * expect(mockUserService.getUser).toHaveBeenCalledWith("123");
 * ```
 */
/** One mockable method: its name plus its call signature as a real TypeNode. */
interface MockMethod {
  name: string;
  /** The method's function type, used as `createMockFn<T>()`'s type argument. */
  typeNode: ts.TypeNode;
}

// Flags for rendering a method's type as a usable TypeNode. NoTruncation keeps
// large signatures intact; UseFullyQualifiedType avoids ambiguous bare names.
const MOCK_TYPE_NODE_FLAGS =
  ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseFullyQualifiedType;

/**
 * Extract the call-signature-bearing properties of `type` as {@link MockMethod}s.
 * Each method's signature is captured as a real `ts.TypeNode` via
 * `typeChecker.typeToTypeNode` (not stringified and re-parsed). If the checker
 * cannot build a node for a signature, we fall back to `(...args: any[]) => any`
 * so codegen still produces a working mock.
 */
function extractMockMethods(
  typeChecker: ts.TypeChecker,
  type: ts.Type,
  enclosing: ts.Node
): MockMethod[] {
  const methods: MockMethod[] = [];
  for (const sym of typeChecker.getPropertiesOfType(type)) {
    const propType = typeChecker.getTypeOfSymbolAtLocation(sym, enclosing);
    if (propType.getCallSignatures().length === 0) continue;
    const typeNode = typeChecker.typeToTypeNode(propType, enclosing, MOCK_TYPE_NODE_FLAGS);
    methods.push({
      name: sym.name,
      typeNode: typeNode ?? f.createFunctionTypeNode([], [param("args", anyArrT(), true)], anyT()),
    });
  }
  return methods;
}

/**
 * Build the `(() => { ... })()` IIFE that constructs a call-tracking mock object
 * typed as `mockOfType`. Shared by the `@mock` attribute macro and the `mock<T>()`
 * expression macro. Built entirely via `ts.factory` — no string/re-parse step.
 */
function buildMockIife(methods: readonly MockMethod[], mockOfType: ts.TypeNode): ts.CallExpression {
  const mockProp = (name: string) => prop(id("mock"), name);
  const callsProp = (name: string) => prop(mockProp("_calls"), name);
  const asAnyArr = (e: ts.Expression) => f.createAsExpression(e, anyArrT());

  // { <method>: createMockFn<T>(), ..., _calls: { <method>: [] as any[], ... }, _reset(): void { ... } }
  const objMembers: ts.ObjectLiteralElementLike[] = [
    ...methods.map((m) =>
      f.createPropertyAssignment(m.name, call(id("createMockFn"), [], [m.typeNode]))
    ),
    f.createPropertyAssignment(
      "_calls",
      f.createObjectLiteralExpression(
        methods.map((m) => f.createPropertyAssignment(m.name, asAnyArr(arr([])))),
        true
      )
    ),
    f.createMethodDeclaration(
      undefined,
      undefined,
      "_reset",
      undefined,
      undefined,
      [],
      f.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
      block([
        // mock._calls.<m> = [];
        ...methods.map((m) => exprStmt(bin(callsProp(m.name), ts.SyntaxKind.EqualsToken, arr([])))),
        // (mock.<m> as any).mockReset?.();
        ...methods.map((m) =>
          exprStmt(
            f.createCallChain(
              prop(paren(asAny(mockProp(m.name))), "mockReset"),
              f.createToken(ts.SyntaxKind.QuestionDotToken),
              undefined,
              []
            )
          )
        ),
      ])
    ),
  ];

  // const mock = { ... } as unknown as <mockOfType>;
  const mockDecl = constStmt(
    "mock",
    f.createAsExpression(
      f.createAsExpression(
        f.createObjectLiteralExpression(objMembers, true),
        f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
      ),
      mockOfType
    )
  );

  // Wire up call tracking for each method.
  const wireUp = methods.flatMap((m): ts.Statement[] => [
    // const _orig_<m> = mock.<m>;
    constStmt(`_orig_${m.name}`, mockProp(m.name)),
    // mock.<m> = ((...args: any[]) => { mock._calls.<m>.push(args); return (_orig_<m> as any)(...args); }) as any;
    exprStmt(
      bin(
        mockProp(m.name),
        ts.SyntaxKind.EqualsToken,
        asAny(
          paren(
            arrow(
              [param("args", anyArrT(), true)],
              block([
                exprStmt(call(prop(callsProp(m.name), "push"), [id("args")])),
                ret(call(paren(asAny(id(`_orig_${m.name}`))), [f.createSpreadElement(id("args"))])),
              ])
            )
          )
        )
      )
    ),
    // Object.assign(mock.<m>, _orig_<m>);
    exprStmt(call(prop(id("Object"), "assign"), [mockProp(m.name), id(`_orig_${m.name}`)])),
  ]);

  return iife(block([mockDecl, ...wireUp, ret(id("mock"))]));
}

export const mockAttribute = defineAttributeMacro({
  name: "mock",
  module: "@typesugar/testing",
  description:
    "Generate a mock implementation from an interface or class with call tracking and stubbing support",
  validTargets: ["interface", "class"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    const typeChecker = ctx.typeChecker;

    // Get the name of the interface/class
    let typeName: string;
    let type: ts.Type;

    if (ts.isInterfaceDeclaration(target)) {
      typeName = target.name.text;
      type = typeChecker.getTypeAtLocation(target);
    } else if (ts.isClassDeclaration(target) && target.name) {
      typeName = target.name.text;
      type = typeChecker.getTypeAtLocation(target);
    } else {
      ctx.reportError(target, "@mock can only be applied to named interfaces or classes");
      return target;
    }

    // Extract each method's signature as a real TypeNode (via typeToTypeNode).
    const methods = extractMockMethods(typeChecker, type, target);

    // Check for custom mock name in args
    let mockVarName = `mock${typeName}`;
    if (args.length > 0 && ts.isStringLiteral(args[0])) {
      mockVarName = args[0].text;
    }

    // MockOf<typeName> — fresh nodes per use so we never share a node.
    const mockOfType = () =>
      f.createTypeReferenceNode("MockOf", [f.createTypeReferenceNode(typeName, undefined)]);

    // const <mockVarName>: MockOf<typeName> = (() => { ... })();
    const mockVarStmt = f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [
          f.createVariableDeclaration(
            id(mockVarName),
            undefined,
            mockOfType(),
            buildMockIife(methods, mockOfType())
          ),
        ],
        ts.NodeFlags.Const
      )
    );
    ts.addSyntheticLeadingComment(
      mockVarStmt,
      ts.SyntaxKind.SingleLineCommentTrivia,
      ` Mock implementation for ${typeName}`,
      true
    );

    // Return both the original declaration and the mock variable
    return [target, mockVarStmt];
  },
});

/**
 * Expression macro to create a mock implementation of a type at runtime.
 *
 * @example
 * ```typescript
 * const mockUser = mock<UserService>();
 * mockUser.getUser.mockReturnValue(Promise.resolve(testUser));
 * ```
 */
export const mockExpressionMacro = defineExpressionMacro({
  name: "mock",
  module: "@typesugar/testing",
  description: "Create a mock implementation of a type with call tracking and stubbing support",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    const typeChecker = ctx.typeChecker;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(callExpr, "mock<T>() requires exactly one type argument");
      return callExpr;
    }

    const typeArg = typeArgs[0];
    const type = typeChecker.getTypeFromTypeNode(typeArg);

    // Extract each method's signature as a real TypeNode (via typeToTypeNode).
    const methods = extractMockMethods(typeChecker, type, callExpr);

    // MockOf<T> — reuse the real type-argument node from the call site.
    const mockOfType = f.createTypeReferenceNode("MockOf", [typeArg]);

    return buildMockIife(methods, mockOfType);
  },
});

// ============================================================================
// Mock Helper Types and Functions — re-exported from index.ts (canonical)
// ============================================================================

export { type MockOf, type MockFn, createMockFn, mock } from "./index.js";

// ============================================================================
// Backward Compatibility Aliases
// ============================================================================

/** @deprecated Use `assertMacro` instead */
export const powerAssertMacro = { ...assertMacro, name: "powerAssert" };

/** @deprecated Use `staticAssertMacro` instead */
export const comptimeAssertMacro = {
  ...staticAssertMacro,
  name: "comptimeAssert",
};

// ============================================================================
// Registration
// ============================================================================

// Primary macros
globalRegistry.register(assertMacro);
globalRegistry.register(ArbitraryDerive);
// Note: staticAssertMacro is re-exported from @typesugar/macros and already registered there
globalRegistry.register(testCasesAttribute);
globalRegistry.register(assertSnapshotMacro);
globalRegistry.register(typeAssertMacro);
globalRegistry.register(forAllMacro);
globalRegistry.register(assertTypeMacro);
// Note: typeInfoMacro is re-exported from @typesugar/macros and already registered there
globalRegistry.register(mockAttribute);
globalRegistry.register(mockExpressionMacro);

// Backward compatibility aliases
globalRegistry.register(powerAssertMacro);
globalRegistry.register(comptimeAssertMacro);
