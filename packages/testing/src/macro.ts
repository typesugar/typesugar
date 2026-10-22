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
  isSyntheticNode,
  type MacroContext,
  type DeriveTypeInfo,
  type DeriveFieldInfo,
  type AttributeTarget,
} from "@typesugar/core";

// Re-export test utilities from macro-context
export { createMacroTestContext, parseSource, type TestMacroContext } from "./macro-context.js";

// ============================================================================
// Shared codegen helpers
// ============================================================================

/** Module the emitted runtime-helper references are imported from. */
const RUNTIME_MODULE = "@typesugar/testing";

function isValidIdentifierName(name: string): boolean {
  if (name.length === 0) return false;
  let i = 0;
  for (const ch of name) {
    const cp = ch.codePointAt(0)!;
    const ok =
      i === 0
        ? ts.isIdentifierStart(cp, ts.ScriptTarget.Latest)
        : ts.isIdentifierPart(cp, ts.ScriptTarget.Latest);
    if (!ok) return false;
    i++;
  }
  // Reserved words are fine here: this is only used for property names.
  return true;
}

/**
 * Reference a runtime helper exported by @typesugar/testing, guaranteeing the
 * import (aliased if the name is taken). Returns a FRESH identifier each call:
 * `ensureImport` hands back a cached node that is also the import
 * specifier's name, and placing that one node instance in the expansion too
 * lets trivia/positions assigned to one occurrence leak into the other.
 */
function runtimeRef(ctx: MacroContext, name: string): ts.Identifier {
  return ctx.factory.createIdentifier(ctx.ensureImport(name, RUNTIME_MODULE).text);
}

/** A property name node: a bare identifier when valid, else a string literal. */
function propertyName(factory: ts.NodeFactory, name: string): ts.PropertyName {
  return isValidIdentifierName(name)
    ? factory.createIdentifier(name)
    : factory.createStringLiteral(name);
}

/** `const <name>[: type] = <init>;` */
function constStatement(
  factory: ts.NodeFactory,
  name: ts.Identifier | string,
  init: ts.Expression,
  type?: ts.TypeNode,
  flags: ts.NodeFlags = ts.NodeFlags.Const
): ts.VariableStatement {
  return factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList(
      [factory.createVariableDeclaration(name, undefined, type, init)],
      flags
    )
  );
}

/** `(() => { ...statements })()`, async + awaited when `isAsync`. */
function iife(factory: ts.NodeFactory, statements: ts.Statement[], isAsync = false): ts.Expression {
  const call = factory.createCallExpression(
    factory.createParenthesizedExpression(
      factory.createArrowFunction(
        isAsync ? [factory.createModifier(ts.SyntaxKind.AsyncKeyword)] : undefined,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createBlock(statements, true)
      )
    ),
    undefined,
    []
  );
  return isAsync ? factory.createAwaitExpression(call) : call;
}

/** Plain data -> AST literal (strings, numbers, booleans, null, undefined, arrays, objects). */
function dataToExpression(factory: ts.NodeFactory, value: unknown): ts.Expression {
  if (value === null) return factory.createNull();
  if (value === undefined) return factory.createIdentifier("undefined");
  if (typeof value === "string") return factory.createStringLiteral(value);
  if (typeof value === "boolean") return value ? factory.createTrue() : factory.createFalse();
  if (typeof value === "number") {
    if (Number.isNaN(value)) return factory.createIdentifier("NaN");
    if (!Number.isFinite(value)) {
      const inf = factory.createIdentifier("Infinity");
      return value < 0 ? factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, inf) : inf;
    }
    if (value < 0 || Object.is(value, -0)) {
      return factory.createPrefixUnaryExpression(
        ts.SyntaxKind.MinusToken,
        factory.createNumericLiteral(-value)
      );
    }
    return factory.createNumericLiteral(value);
  }
  if (Array.isArray(value)) {
    return factory.createArrayLiteralExpression(value.map((v) => dataToExpression(factory, v)));
  }
  if (typeof value === "object") {
    return factory.createObjectLiteralExpression(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        factory.createPropertyAssignment(propertyName(factory, k), dataToExpression(factory, v))
      ),
      false
    );
  }
  throw new Error(`@typesugar/testing: cannot emit ${typeof value} as a literal`);
}

/** Whether `node` contains an `await` that belongs to ITS function (not a nested one). */
function containsOwnAwait(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isAwaitExpression(n)) {
      found = true;
      return;
    }
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

// ============================================================================
// powerAssert() — Power Assertions with Sub-Expression Capture
// ============================================================================

/** The tree diagram shows "  assert(<expr>)", so values are offset by 9 columns. */
const ASSERT_PREFIX_LEN = 9; // "  assert(".length

function isSelfExplanatoryLiteral(n: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(n) ||
    ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    n.kind === ts.SyntaxKind.TrueKeyword ||
    n.kind === ts.SyntaxKind.FalseKeyword ||
    n.kind === ts.SyntaxKind.NullKeyword
  );
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/**
 * Rebuild `expr` so every meaningful sub-expression records its value into
 * `values[i]` AS IT IS EVALUATED — `(values[i] = <sub>)` — so on failure the
 * diagram shows the values from the one real evaluation. Nothing is evaluated
 * twice (side effects such as `n++` happen once), and sub-expressions that
 * short-circuiting skipped are simply absent from `values`.
 *
 * Positions that must stay un-wrapped for the program to mean the same thing
 * are left alone: assignment / `++`/`--` targets, method-call callees (wrapping
 * would lose `this`), the inner links of an optional chain (wrapping would end
 * the chain early), `super`, and `import(...)`.
 */
function instrumentAssertion(
  factory: ts.NodeFactory,
  expr: ts.Expression,
  source: ts.Expression,
  sourceFile: ts.SourceFile,
  values: ts.Identifier
): { instrumented: ts.Expression; positions: number[] } {
  const exprStart = source.getStart(sourceFile);
  const exprEnd = source.getEnd();
  const positions: number[] = [];

  // `expr` has already been macro-expanded (assert is `expandArgumentsFirst`).
  // A node a nested macro generated is synthetic: it has no column of its
  // own. If it is a COPY of a source node (an expansion that reuses an
  // operand clones it, keeping an `original` link: the operands of a
  // rewritten `a === b`, the receiver of a rewritten `n.show()`), it is drawn
  // at that source node's column; anything else synthetic is not recorded,
  // but its children are still visited by the same rules. A source node from
  // outside the assertion (reused by an expansion) has no column in this
  // diagram either. One source node is drawn once: an expansion that reads an
  // operand twice (`c === p || (c != null && ...)`) records the first read,
  // which is always evaluated.
  const sourceOf = (n: ts.Node): ts.Node | undefined => {
    if (!isSyntheticNode(n)) return n;
    const original = ts.getOriginalNode(n);
    return original !== n && !isSyntheticNode(original) ? original : undefined;
  };
  const drawn = new Set<ts.Node>();
  const hasColumn = (n: ts.Expression): boolean => {
    const src = sourceOf(n);
    return (
      !!src && !drawn.has(src) && src.getStart(sourceFile) >= exprStart && src.getEnd() <= exprEnd
    );
  };

  // Column where this sub-expression's value indicator appears in the diagram:
  // at the property name for property access, the operator for binary ops,
  // otherwise the start. Read from the source node (see sourceOf).
  const displayOffset = (n: ts.Expression): number => {
    const src = sourceOf(n) ?? n;
    if (ts.isPropertyAccessExpression(src)) return src.name.getStart(sourceFile) - exprStart;
    if (ts.isBinaryExpression(src)) return src.operatorToken.getStart(sourceFile) - exprStart;
    return src.getStart(sourceFile) - exprStart;
  };

  const inChain = (n: ts.Node): boolean => (n.flags & ts.NodeFlags.OptionalChain) !== 0;

  const visit = (n: ts.Expression, wantRecord: boolean): ts.Expression => {
    if (isSelfExplanatoryLiteral(n) || n.kind === ts.SyntaxKind.SuperKeyword) return n;
    const record = wantRecord && hasColumn(n);

    // Allocate the index before visiting children: pre-order, matching the
    // left-to-right reading order of the diagram.
    let index = -1;
    if (record) {
      drawn.add(sourceOf(n)!);
      index = positions.length;
      positions.push(displayOffset(n) + ASSERT_PREFIX_LEN);
    }

    let rebuilt: ts.Expression = n;
    if (ts.isBinaryExpression(n)) {
      const left = isAssignmentOperator(n.operatorToken.kind) ? n.left : visit(n.left, true);
      rebuilt = factory.updateBinaryExpression(n, left, n.operatorToken, visit(n.right, true));
    } else if (ts.isPropertyAccessExpression(n)) {
      const chainLink = inChain(n) && inChain(n.expression);
      rebuilt = factory.updatePropertyAccessExpression(n, visit(n.expression, !chainLink), n.name);
    } else if (ts.isElementAccessExpression(n)) {
      const chainLink = inChain(n) && inChain(n.expression);
      rebuilt = factory.updateElementAccessExpression(
        n,
        visit(n.expression, !chainLink),
        visit(n.argumentExpression, true)
      );
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const isMethodCall =
        ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee);
      const keepCallee =
        isMethodCall ||
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        callee.kind === ts.SyntaxKind.SuperKeyword ||
        (inChain(n) && inChain(callee));
      const newCallee =
        callee.kind === ts.SyntaxKind.ImportKeyword || callee.kind === ts.SyntaxKind.SuperKeyword
          ? callee
          : visit(callee, !keepCallee);
      const newArgs = n.arguments.map((arg) =>
        ts.isSpreadElement(arg)
          ? factory.updateSpreadElement(arg, visit(arg.expression, true))
          : visit(arg, true)
      );
      rebuilt = factory.updateCallExpression(n, newCallee, n.typeArguments, newArgs);
    } else if (ts.isPrefixUnaryExpression(n)) {
      const mutates =
        n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken;
      if (!mutates) {
        rebuilt = factory.updatePrefixUnaryExpression(n, visit(n.operand, true));
      }
    } else if (ts.isParenthesizedExpression(n)) {
      rebuilt = factory.updateParenthesizedExpression(n, visit(n.expression, true));
    } else if (ts.isConditionalExpression(n)) {
      rebuilt = factory.updateConditionalExpression(
        n,
        visit(n.condition, true),
        n.questionToken,
        visit(n.whenTrue, true),
        n.colonToken,
        visit(n.whenFalse, true)
      );
    }

    if (index < 0) return rebuilt;
    return factory.createParenthesizedExpression(
      factory.createAssignment(
        factory.createElementAccessExpression(values, factory.createNumericLiteral(index)),
        rebuilt
      )
    );
  };

  return { instrumented: visit(expr, true), positions };
}

export const assertMacro = defineExpressionMacro({
  name: "assert",
  module: "@typesugar/testing",
  description:
    "Assert with sub-expression capture — on failure, shows the value of every sub-expression",
  // Instrumenting first wrapped `summon` in `summon<Show<number>>()` as
  // `(values[i] = summon)()` (so it never expanded and threw at run time) and
  // hid extension-method receivers from the checker: expand the argument's
  // macros first, then instrument what they produced.
  expandArgumentsFirst: true,

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

    // `args` are already macro-expanded; `callExpr.arguments` is the source.
    const expr = args[0];
    const source = callExpr.arguments[0] ?? expr;
    const customMessage = args.length === 2 ? args[1] : undefined;
    const factory = ctx.factory;
    const sourceFile = ctx.sourceFile;
    const fail = runtimeRef(ctx, "__powerAssertFail");
    const values = ctx.generateUniqueName("pa_vals");

    // Generates:
    //
    //   (() => {
    //     const <values>: any[] = [];
    //     if (!(<expr, each sub-expression wrapped as (<values>[i] = sub)>))
    //       __powerAssertFail("<expr source>", [<display columns>], <values>, <message>);
    //   })()
    //
    // (async + awaited when the expression awaits). The expression is
    // evaluated exactly once; the diagram is built by the runtime helper.
    let instrumented: ts.Expression;
    let positions: number[];
    let exprSource: string;
    if (isSyntheticNode(source)) {
      // A macro-generated argument has no source text or positions to draw a
      // diagram from: assert it plainly (still evaluated once).
      ctx.reportWarning(
        callExpr,
        "assert(): argument is macro-generated, so the failure message will not include a sub-expression diagram"
      );
      instrumented = expr;
      positions = [];
      exprSource = ts
        .createPrinter({ removeComments: true })
        .printNode(ts.EmitHint.Expression, expr, sourceFile);
    } else {
      ({ instrumented, positions } = instrumentAssertion(
        factory,
        expr,
        source,
        sourceFile,
        values
      ));
      exprSource = source.getText(sourceFile);
    }

    const failArgs: ts.Expression[] = [
      factory.createStringLiteral(exprSource),
      factory.createArrayLiteralExpression(positions.map((p) => factory.createNumericLiteral(p))),
      values,
    ];
    if (customMessage) failArgs.push(customMessage);

    return iife(
      factory,
      [
        constStatement(
          factory,
          values,
          factory.createArrayLiteralExpression([]),
          factory.createArrayTypeNode(factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))
        ),
        factory.createIfStatement(
          factory.createPrefixUnaryExpression(
            ts.SyntaxKind.ExclamationToken,
            factory.createParenthesizedExpression(instrumented)
          ),
          factory.createExpressionStatement(factory.createCallExpression(fail, undefined, failArgs))
        ),
      ],
      containsOwnAwait(expr) || (customMessage !== undefined && containsOwnAwait(customMessage))
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
    ctx: MacroContext,
    _target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo
  ): ts.Statement[] {
    const f = ctx.factory;
    const { name, fields } = typeInfo;
    const fnName = `arbitrary${name}`;
    // The seeded PRNG is a runtime helper imported once per file (not a
    // top-level function emitted per derived type, which collided — TS2393).
    const seeded = runtimeRef(ctx, "__seededRandom");
    const rng = f.createIdentifier("_rng");
    const seed = f.createIdentifier("seed");
    const count = f.createIdentifier("count");
    const results = f.createIdentifier("results");
    const i = f.createIdentifier("i");
    const typeRef = () => f.createTypeReferenceNode(name);
    const numberType = () => f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
    const exportMod = () => [f.createModifier(ts.SyntaxKind.ExportKeyword)];
    const seedDefined = () =>
      f.createBinaryExpression(
        seed,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        f.createIdentifier("undefined")
      );

    // export function arbitraryX(seed?: number): X {
    //   const _rng = seed !== undefined ? __seededRandom(seed) : Math.random;
    //   return { field: <generator>, ... };
    // }
    const single = f.createFunctionDeclaration(
      exportMod(),
      undefined,
      fnName,
      undefined,
      [
        f.createParameterDeclaration(
          undefined,
          undefined,
          seed,
          f.createToken(ts.SyntaxKind.QuestionToken),
          numberType()
        ),
      ],
      typeRef(),
      f.createBlock(
        [
          constStatement(
            f,
            rng,
            f.createConditionalExpression(
              seedDefined(),
              f.createToken(ts.SyntaxKind.QuestionToken),
              f.createCallExpression(seeded, undefined, [seed]),
              f.createToken(ts.SyntaxKind.ColonToken),
              f.createPropertyAccessExpression(f.createIdentifier("Math"), "random")
            )
          ),
          f.createReturnStatement(
            f.createObjectLiteralExpression(
              fields.map((field) =>
                f.createPropertyAssignment(
                  propertyName(f, field.name),
                  arbitraryForField(f, rng, field)
                )
              ),
              true
            )
          ),
        ],
        true
      )
    );

    // export function arbitraryXMany(count: number, seed?: number): X[] {
    //   const results: X[] = [];
    //   for (let i = 0; i < count; i++)
    //     results.push(arbitraryX(seed !== undefined ? seed + i : undefined));
    //   return results;
    // }
    const many = f.createFunctionDeclaration(
      exportMod(),
      undefined,
      `${fnName}Many`,
      undefined,
      [
        f.createParameterDeclaration(undefined, undefined, count, undefined, numberType()),
        f.createParameterDeclaration(
          undefined,
          undefined,
          seed,
          f.createToken(ts.SyntaxKind.QuestionToken),
          numberType()
        ),
      ],
      f.createArrayTypeNode(typeRef()),
      f.createBlock(
        [
          constStatement(
            f,
            results,
            f.createArrayLiteralExpression([]),
            f.createArrayTypeNode(typeRef())
          ),
          f.createForStatement(
            f.createVariableDeclarationList(
              [f.createVariableDeclaration(i, undefined, undefined, f.createNumericLiteral(0))],
              ts.NodeFlags.Let
            ),
            f.createBinaryExpression(i, ts.SyntaxKind.LessThanToken, count),
            f.createPostfixUnaryExpression(i, ts.SyntaxKind.PlusPlusToken),
            f.createBlock(
              [
                f.createExpressionStatement(
                  f.createCallExpression(
                    f.createPropertyAccessExpression(results, "push"),
                    undefined,
                    [
                      f.createCallExpression(f.createIdentifier(fnName), undefined, [
                        f.createConditionalExpression(
                          seedDefined(),
                          f.createToken(ts.SyntaxKind.QuestionToken),
                          f.createBinaryExpression(seed, ts.SyntaxKind.PlusToken, i),
                          f.createToken(ts.SyntaxKind.ColonToken),
                          f.createIdentifier("undefined")
                        ),
                      ]),
                    ]
                  )
                ),
              ],
              true
            )
          ),
          f.createReturnStatement(results),
        ],
        true
      )
    );

    return [single, many];
  },
});

/** `_rng()` */
function rngCall(f: ts.NodeFactory, rng: ts.Identifier): ts.Expression {
  return f.createCallExpression(rng, undefined, []);
}

/** `Math.floor(<e>)` */
function mathFloor(f: ts.NodeFactory, e: ts.Expression): ts.Expression {
  return f.createCallExpression(
    f.createPropertyAccessExpression(f.createIdentifier("Math"), "floor"),
    undefined,
    [e]
  );
}

function arbitraryForField(
  f: ts.NodeFactory,
  rng: ts.Identifier,
  field: DeriveFieldInfo
): ts.Expression {
  const base = arbitraryForBaseType(f, rng, field.typeString.toLowerCase());
  if (!field.optional) return base;
  // (_rng() > 0.5 ? <base> : undefined)
  return f.createParenthesizedExpression(
    f.createConditionalExpression(
      f.createBinaryExpression(
        rngCall(f, rng),
        ts.SyntaxKind.GreaterThanToken,
        f.createNumericLiteral(0.5)
      ),
      f.createToken(ts.SyntaxKind.QuestionToken),
      base,
      f.createToken(ts.SyntaxKind.ColonToken),
      f.createIdentifier("undefined")
    )
  );
}

function arbitraryForBaseType(
  f: ts.NodeFactory,
  rng: ts.Identifier,
  typeStr: string
): ts.Expression {
  if (typeStr === "number") {
    // (_rng() * 200 - 100)
    return f.createParenthesizedExpression(
      f.createBinaryExpression(
        f.createBinaryExpression(
          rngCall(f, rng),
          ts.SyntaxKind.AsteriskToken,
          f.createNumericLiteral(200)
        ),
        ts.SyntaxKind.MinusToken,
        f.createNumericLiteral(100)
      )
    );
  }
  if (typeStr === "string") {
    // String.fromCharCode(...Array.from({ length: Math.floor(_rng() * 20) + 1 },
    //                                   () => Math.floor(_rng() * 26) + 97))
    const scaled = (n: number) =>
      mathFloor(
        f,
        f.createBinaryExpression(
          rngCall(f, rng),
          ts.SyntaxKind.AsteriskToken,
          f.createNumericLiteral(n)
        )
      );
    return f.createCallExpression(
      f.createPropertyAccessExpression(f.createIdentifier("String"), "fromCharCode"),
      undefined,
      [
        f.createSpreadElement(
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier("Array"), "from"),
            undefined,
            [
              f.createObjectLiteralExpression([
                f.createPropertyAssignment(
                  "length",
                  f.createBinaryExpression(
                    scaled(20),
                    ts.SyntaxKind.PlusToken,
                    f.createNumericLiteral(1)
                  )
                ),
              ]),
              f.createArrowFunction(
                undefined,
                undefined,
                [],
                undefined,
                f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                f.createBinaryExpression(
                  scaled(26),
                  ts.SyntaxKind.PlusToken,
                  f.createNumericLiteral(97)
                )
              ),
            ]
          )
        ),
      ]
    );
  }
  if (typeStr === "boolean") {
    // (_rng() > 0.5)
    return f.createParenthesizedExpression(
      f.createBinaryExpression(
        rngCall(f, rng),
        ts.SyntaxKind.GreaterThanToken,
        f.createNumericLiteral(0.5)
      )
    );
  }
  if (typeStr.includes("[]") || typeStr.startsWith("array")) {
    return f.createArrayLiteralExpression([]);
  }
  // Default: ({} as any)
  return f.createParenthesizedExpression(
    f.createAsExpression(
      f.createObjectLiteralExpression([]),
      f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)
    )
  );
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

    const f = ctx.factory;
    const casesArray = args[0] as ts.ArrayLiteralExpression;
    const fnName = target.name?.text ?? "anonymous";
    const body = target.body;
    const isAsync = (target.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

    if (!body) {
      ctx.reportError(target, "@testCases: function must have a body");
      return target;
    }

    // Printing is used ONLY for the human-readable test label text (a string
    // literal); the generated code itself reuses the original AST nodes, so
    // macros inside the body or the case values are still expanded.
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true });
    const labelText = (e: ts.Expression): string =>
      isSyntheticNode(e)
        ? printer.printNode(ts.EmitHint.Expression, e, ctx.sourceFile)
        : e.getText(ctx.sourceFile);

    const statements: ts.Statement[] = [];

    for (let i = 0; i < casesArray.elements.length; i++) {
      const caseExpr = casesArray.elements[i];

      if (!ts.isObjectLiteralExpression(caseExpr)) {
        ctx.reportError(caseExpr, `@testCases: element ${i} must be an object literal`);
        continue;
      }

      const props = new Map<string, ts.Expression>();
      for (const prop of caseExpr.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          props.set(prop.name.text, prop.initializer);
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          props.set(prop.name.text, prop.name);
        }
      }

      const caseLabel = Array.from(props.entries())
        .map(([k, v]) => `${k}=${labelText(v).replace(/\s+/g, " ")}`)
        .join(", ");

      // it("<fn> (case #<n>: <label>)", () => { let <param> = <value>; ...body })
      const bindings: ts.Statement[] = [];
      for (const p of target.parameters) {
        if (!ts.isIdentifier(p.name)) continue;
        const value = props.get(p.name.text);
        if (value === undefined) continue;
        bindings.push(constStatement(f, p.name.text, value, undefined, ts.NodeFlags.Let));
      }

      statements.push(
        f.createExpressionStatement(
          f.createCallExpression(f.createIdentifier("it"), undefined, [
            f.createStringLiteral(`${fnName} (case #${i + 1}: ${caseLabel})`),
            f.createArrowFunction(
              isAsync ? [f.createModifier(ts.SyntaxKind.AsyncKeyword)] : undefined,
              undefined,
              [],
              undefined,
              f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              f.createBlock([...bindings, ...body.statements], true)
            ),
          ])
        )
      );
    }

    // One Block rather than an array of statements: the transformer only
    // re-visits the FIRST node an attribute macro returns (extra statements
    // are spliced in un-visited), so with an array, macros in the body of
    // every case after the first would never expand. A block of `it(...)`
    // calls is equivalent at the top level of a test file.
    return f.createBlock(statements, true);
  },
});

// ============================================================================
// assertSnapshot() — Snapshot Testing with Source Capture
// ============================================================================

/** The source file's path relative to the program's root directory, '/'-separated. */
function projectRelativePath(ctx: MacroContext): string {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const file = norm(ctx.sourceFile.fileName);
  let root = norm(ctx.program.getCurrentDirectory());
  if (root && !root.endsWith("/")) root += "/";
  if (root && file.startsWith(root)) return file.slice(root.length);
  // Outside the project root: the basename is the only machine-independent part.
  return file.slice(file.lastIndexOf("/") + 1);
}

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
    const exprSource = isSyntheticNode(expr) ? "<expression>" : expr.getText(ctx.sourceFile);

    // The label is part of the snapshot KEY, so it must be stable across
    // machines and edits: a project-relative path (not the absolute path of
    // whoever wrote the snapshot) and no line number (inserting a line above
    // must not orphan every snapshot below it). Vitest/Jest already number
    // repeated keys within a test.
    const fileName = projectRelativePath(ctx);

    // Generate:
    // expect(<expr>).toMatchSnapshot(
    //   `<file> — <exprSource>` + (snapshotName ? ` [${snapshotName}]` : "")
    // )
    const snapshotLabel = `${fileName} — ${exprSource}`;

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

    const f = ctx.factory;
    const generatorArg = args[0];
    const countArg = args.length === 3 ? args[1] : f.createNumericLiteral(100);
    const propertyArg = args.length === 3 ? args[2] : args[1];

    const gen = ctx.generateUniqueName("fa_gen");
    const count = ctx.generateUniqueName("fa_count");
    const prop = ctx.generateUniqueName("fa_prop");
    const i = ctx.generateUniqueName("fa_i");
    const value = ctx.generateUniqueName("fa_value");
    const e = ctx.generateUniqueName("fa_e");
    const err = ctx.generateUniqueName("fa_err");
    const str = (s: string) => f.createStringLiteral(s);
    const plus = (a: ts.Expression, b: ts.Expression) =>
      f.createBinaryExpression(a, ts.SyntaxKind.PlusToken, b);

    // (function <T>(<gen>: (seed: number) => T, <count>: number, <prop>: (value: T) => void): void {
    //   for (let <i> = 0; <i> < <count>; <i>++) {
    //     const <value> = <gen>(<i>);
    //     try { <prop>(<value>); }
    //     catch (<e>) {
    //       const <err> = <e> instanceof Error ? <e>.message : String(<e>);
    //       throw new Error("Property failed after " + (<i> + 1) + " tests.\n" +
    //         "Failing input: " + JSON.stringify(<value>) + "\n" + "Error: " + <err>);
    //     }
    //   }
    // })(<generator>, <count>, <property>)  (each evaluated once, in order)
    const loop = f.createForStatement(
      f.createVariableDeclarationList(
        [f.createVariableDeclaration(i, undefined, undefined, f.createNumericLiteral(0))],
        ts.NodeFlags.Let
      ),
      f.createBinaryExpression(i, ts.SyntaxKind.LessThanToken, count),
      f.createPostfixUnaryExpression(i, ts.SyntaxKind.PlusPlusToken),
      f.createBlock(
        [
          constStatement(f, value, f.createCallExpression(gen, undefined, [i])),
          f.createTryStatement(
            f.createBlock([
              f.createExpressionStatement(f.createCallExpression(prop, undefined, [value])),
            ]),
            f.createCatchClause(
              e,
              f.createBlock(
                [
                  constStatement(
                    f,
                    err,
                    f.createConditionalExpression(
                      f.createBinaryExpression(
                        e,
                        ts.SyntaxKind.InstanceOfKeyword,
                        f.createIdentifier("Error")
                      ),
                      f.createToken(ts.SyntaxKind.QuestionToken),
                      f.createPropertyAccessExpression(e, "message"),
                      f.createToken(ts.SyntaxKind.ColonToken),
                      f.createCallExpression(f.createIdentifier("String"), undefined, [e])
                    )
                  ),
                  f.createThrowStatement(
                    f.createNewExpression(f.createIdentifier("Error"), undefined, [
                      plus(
                        plus(
                          plus(
                            plus(
                              plus(
                                plus(
                                  str("Property failed after "),
                                  f.createParenthesizedExpression(
                                    plus(i, f.createNumericLiteral(1))
                                  )
                                ),
                                str(" tests.\n")
                              ),
                              str("Failing input: ")
                            ),
                            f.createCallExpression(
                              f.createPropertyAccessExpression(
                                f.createIdentifier("JSON"),
                                "stringify"
                              ),
                              undefined,
                              [value]
                            )
                          ),
                          str("\nError: ")
                        ),
                        err
                      ),
                    ])
                  ),
                ],
                true
              )
            ),
            undefined
          ),
        ],
        true
      )
    );

    // The arguments are passed to a generic function typed like forAll's
    // own signature, `<T>(gen: (seed: number) => T, count: number, prop:
    // (value: T) => void)`, rather than bound to consts: that evaluates each
    // once, in order, as before, and keeps the contextual types the call
    // gave unannotated parameters (`(seed) => …`, `(value) => …`), which a
    // const loses — TS7006 under `typesugar check --strict` (turf case
    // study, round 2). A function expression, not an arrow: `<T>(…) =>`
    // reads as JSX in a .tsx file.
    const tRef = () => f.createTypeReferenceNode("T");
    const param = (name: ts.Identifier, type: ts.TypeNode) =>
      f.createParameterDeclaration(undefined, undefined, name, undefined, type);
    const fnType = (paramName: string, paramType: ts.TypeNode, result: ts.TypeNode) =>
      f.createFunctionTypeNode(
        undefined,
        [f.createParameterDeclaration(undefined, undefined, paramName, undefined, paramType)],
        result
      );
    const runner = f.createFunctionExpression(
      undefined,
      undefined,
      undefined,
      [f.createTypeParameterDeclaration(undefined, "T")],
      [
        param(gen, fnType("seed", f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword), tRef())),
        param(count, f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)),
        param(prop, fnType("value", tRef(), f.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword))),
      ],
      f.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
      f.createBlock([loop], true)
    );
    return f.createCallExpression(f.createParenthesizedExpression(runner), undefined, [
      generatorArg,
      countArg,
      propertyArg,
    ]);
  },
});

// ============================================================================
// assertType<T>(value) — Runtime Type Assertion with Detailed Diagnostics
// ============================================================================

type Literal = string | number | boolean | null | undefined;
type Check = "string" | "number" | "boolean" | "bigint" | "symbol" | "array";

/**
 * Describe `type` as primitive checks + allowed literal values, or return
 * "any" (unchecked) / null (not a primitive type).
 */
function primitiveShape(
  checker: ts.TypeChecker,
  type: ts.Type
): { checks: Check[]; literals: Literal[] } | "any" | null {
  const parts = type.isUnion() ? type.types : [type];
  const checks = new Set<Check>();
  const literals: Literal[] = [];
  for (const t of parts) {
    const fl = t.flags;
    if (fl & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return "any";
    if (t.isStringLiteral()) literals.push(t.value);
    else if (t.isNumberLiteral()) literals.push(t.value);
    else if (fl & ts.TypeFlags.BooleanLiteral)
      literals.push((t as { intrinsicName?: string }).intrinsicName === "true");
    else if (fl & ts.TypeFlags.StringLike) checks.add("string");
    else if (fl & ts.TypeFlags.NumberLike) checks.add("number");
    else if (fl & ts.TypeFlags.BooleanLike) checks.add("boolean");
    else if (fl & ts.TypeFlags.BigIntLike) checks.add("bigint");
    else if (fl & ts.TypeFlags.ESSymbolLike) checks.add("symbol");
    else if (fl & ts.TypeFlags.Null) literals.push(null);
    else if (fl & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) literals.push(undefined);
    else if (checker.isArrayType(t) || checker.isTupleType(t)) checks.add("array");
    else return null;
  }
  return { checks: [...checks], literals };
}

/** Build the runtime `__TypeSpec` (as plain data) for `type`. */
function typeSpecFor(checker: ts.TypeChecker, type: ts.Type, location: ts.Node): unknown {
  const prim = primitiveShape(checker, type);
  if (prim === "any") return { kind: "any" };
  if (prim) {
    if (prim.checks.length === 1 && prim.checks[0] === "array" && prim.literals.length === 0) {
      return { kind: "array" };
    }
    return { kind: "primitive", ...prim };
  }
  if (type.isUnion()) {
    // A union mixing object and primitive members (or several object shapes)
    // has no single field list to check; only common properties are reliable.
    const allObjects = type.types.every((t) => (t.flags & ts.TypeFlags.Object) !== 0);
    if (!allObjects) return { kind: "any" };
  }

  const fields = checker.getPropertiesOfType(type).map((prop) => {
    const propType = checker.getTypeOfSymbolAtLocation(prop, location);
    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
    const shape = primitiveShape(
      checker,
      optional ? checker.getNonNullableType(propType) : propType
    );
    const usable = shape && shape !== "any" ? shape : { checks: [], literals: [] };
    return {
      name: prop.name,
      type: checker.typeToString(propType),
      optional,
      checks: usable.checks,
      literals: usable.literals,
    };
  });
  return { kind: "object", fields };
}

/**
 * `assertType<T>(value)` uses compile-time type information to validate that
 * a runtime value matches the expected structure. On failure, it produces
 * rich diagnostics showing exactly which fields are missing, have wrong
 * types, or have unexpected values.
 *
 * Primitive and literal types (`assertType<number>(5)`, `assertType<"a" | "b">(x)`)
 * are checked by `typeof` / value; object types field by field (including
 * literal-typed fields such as `{ kind: "click" }`).
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
 * //   - Field 'name': missing (required, expected string)"
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
    const f = ctx.factory;
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

    const typeArg = typeArgs[0];
    if (isSyntheticNode(typeArg)) {
      ctx.reportWarning(
        callExpr,
        "assertType<T>(): the type argument is macro-generated and cannot be resolved by the type checker; left as the runtime call"
      );
      return callExpr;
    }

    const checker = ctx.typeChecker;
    const type = checker.getTypeFromTypeNode(typeArg);
    const spec = typeSpecFor(checker, type, callExpr);

    // __assertTypeCheck(<value>, "<T as text>", <spec literal>[, <message>])
    const callArgs: ts.Expression[] = [
      args[0],
      f.createStringLiteral(checker.typeToString(type)),
      dataToExpression(f, spec),
    ];
    if (args.length === 2) callArgs.push(args[1]);
    return f.createCallExpression(runtimeRef(ctx, "__assertTypeCheck"), undefined, callArgs);
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

/** Names of the callable (method / function-valued) properties of `type`. */
function methodNamesOf(checker: ts.TypeChecker, type: ts.Type, location: ts.Node): string[] {
  const names: string[] = [];
  for (const prop of checker.getPropertiesOfType(type)) {
    // Symbol-keyed members ("__@iterator@12") have no string key to mock by.
    if (prop.name.startsWith("__@")) continue;
    const propType = checker.getTypeOfSymbolAtLocation(prop, location);
    if (propType.getCallSignatures().length > 0) names.push(prop.name);
  }
  return names;
}

/** `createMockObject<T>(["m1", "m2", ...])` */
function createMockObjectCall(
  ctx: MacroContext,
  typeNode: ts.TypeNode,
  methodNames: readonly string[]
): ts.Expression {
  const f = ctx.factory;
  return f.createCallExpression(
    runtimeRef(ctx, "createMockObject"),
    [typeNode],
    [f.createArrayLiteralExpression(methodNames.map((n) => f.createStringLiteral(n)))]
  );
}

/**
 * `@mock` decorator that generates a mock implementation from an interface
 * or class declaration. The mock tracks all method calls and allows stubbing
 * return values.
 *
 * @example
 * ```typescript
 * @mock
 * interface UserService {
 *   getUser(id: string): Promise<User>;
 *   createUser(data: UserInput): Promise<User>;
 * }
 *
 * // Generates (createMockObject is imported from @typesugar/testing):
 * // const mockUserService = createMockObject<UserService>(["getUser", "createUser"]);
 *
 * // Usage in tests:
 * mockUserService.getUser.mockReturnValue(Promise.resolve(testUser));
 * await mockUserService.getUser("123");
 * expect(mockUserService._calls.getUser).toEqual([["123"]]);
 * ```
 */
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
    const f = ctx.factory;

    if (!(ts.isInterfaceDeclaration(target) || (ts.isClassDeclaration(target) && target.name))) {
      ctx.reportError(target, "@mock can only be applied to named interfaces or classes");
      return target;
    }
    const typeName = target.name!.text;
    if (isSyntheticNode(target)) {
      ctx.reportWarning(
        target,
        `@mock: '${typeName}' is macro-generated and cannot be inspected by the type checker; no mock was generated`
      );
      return target;
    }

    const type = ctx.typeChecker.getTypeAtLocation(target);
    const methodNames = methodNamesOf(ctx.typeChecker, type, target);

    let mockVarName = `mock${typeName}`;
    if (args.length > 0 && ts.isStringLiteral(args[0])) {
      mockVarName = args[0].text;
    }

    return [
      target,
      constStatement(
        f,
        mockVarName,
        createMockObjectCall(ctx, f.createTypeReferenceNode(typeName), methodNames)
      ),
    ];
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
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(callExpr, "mock<T>() requires exactly one type argument");
      return callExpr;
    }

    const typeArg = typeArgs[0];
    if (isSyntheticNode(typeArg)) {
      ctx.reportWarning(
        callExpr,
        "mock<T>(): the type argument is macro-generated and cannot be resolved by the type checker; left as the runtime call"
      );
      return callExpr;
    }

    const type = ctx.typeChecker.getTypeFromTypeNode(typeArg);
    return createMockObjectCall(ctx, typeArg, methodNamesOf(ctx.typeChecker, type, callExpr));
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
