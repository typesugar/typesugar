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
  sourceFile: ts.SourceFile,
): Array<{ node: ts.Expression; source: string }> {
  const subs: Array<{ node: ts.Expression; source: string }> = [];

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

    // Collect this sub-expression
    const source = n.getText(sourceFile);
    subs.push({ node: n, source });

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
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        callExpr,
        "assert expects 1 or 2 arguments: assert(expr) or assert(expr, message)",
      );
      return callExpr;
    }

    const expr = args[0];
    const customMessage = args.length === 2 ? args[1] : undefined;
    const factory = ctx.factory;
    const sourceFile = ctx.sourceFile;

    // Get the full source text of the assertion expression
    const exprSource = expr.getText(sourceFile);

    // Collect all meaningful sub-expressions
    const subs = collectSubExpressions(expr, sourceFile);

    // Build: const __vals__ = [sub1, sub2, ...] (evaluated left-to-right)
    // Build: const __srcs__ = ["sub1Source", "sub2Source", ...]
    const valElements = subs.map((s) => s.node);
    const srcElements = subs.map((s) => factory.createStringLiteral(s.source));

    // Generate the power assertion IIFE:
    //
    // (() => {
    //   const __result__ = <expr>;
    //   if (!__result__) {
    //     const __vals__ = [<sub1>, <sub2>, ...];
    //     const __srcs__ = ["sub1Source", "sub2Source", ...];
    //     let __diagram__ = "Power Assert Failed\n\n";
    //     __diagram__ += "  " + <exprSource> + "\n\n";
    //     __diagram__ += "Sub-expressions:\n";
    //     for (let __i__ = 0; __i__ < __srcs__.length; __i__++) {
    //       __diagram__ += "  " + __srcs__[__i__] + " → " + JSON.stringify(__vals__[__i__]) + "\n";
    //     }
    //     throw new Error(__diagram__);
    //   }
    // })()
    //
    // We build this as a string and parse it, then splice in the real
    // expression nodes for correctness.

    const code = `(() => {
  const __pa_result__ = undefined;
  if (!__pa_result__) {
    const __pa_vals__ = [];
    const __pa_srcs__ = [];
    let __pa_msg__ = ${customMessage ? "undefined" : "undefined"};
    let __pa_diagram__ = "\\n\\nPower Assert Failed" + (__pa_msg__ ? ": " + __pa_msg__ : "") + "\\n\\n";
    __pa_diagram__ += "  " + ${JSON.stringify(exprSource)} + "\\n\\n";
    __pa_diagram__ += "Sub-expressions:\\n";
    for (let __pa_i__ = 0; __pa_i__ < __pa_srcs__.length; __pa_i__++) {
      __pa_diagram__ += "  " + __pa_srcs__[__pa_i__] + " \\u2192 " + JSON.stringify(__pa_vals__[__pa_i__]) + "\\n";
    }
    throw new Error(__pa_diagram__);
  }
})()`;

    const stmts = ctx.parseStatements(code);
    // The parsed code is an ExpressionStatement wrapping a CallExpression (IIFE)
    const iife = stmts[0];
    if (!ts.isExpressionStatement(iife)) return callExpr;

    const iifeCall = iife.expression as ts.CallExpression;
    const arrowFn = (iifeCall.expression as ts.ParenthesizedExpression)
      .expression as ts.ArrowFunction;
    const block = arrowFn.body as ts.Block;

    // Now rebuild the block with real expression nodes spliced in.
    // Statement 0: const __pa_result__ = <expr>
    const resultDecl = block.statements[0] as ts.VariableStatement;
    const resultVarDecl = resultDecl.declarationList.declarations[0];
    const newResultDecl = factory.updateVariableDeclaration(
      resultVarDecl,
      resultVarDecl.name,
      undefined,
      undefined,
      expr,
    );
    const newResultStmt = factory.updateVariableStatement(
      resultDecl,
      resultDecl.modifiers,
      factory.updateVariableDeclarationList(resultDecl.declarationList, [
        newResultDecl,
      ]),
    );

    // Statement 1: if (!__pa_result__) { ... }
    const ifStmt = block.statements[1] as ts.IfStatement;
    const ifBlock = ifStmt.thenStatement as ts.Block;

    // ifBlock[0]: const __pa_vals__ = [<real sub-expressions>]
    const valsDecl = ifBlock.statements[0] as ts.VariableStatement;
    const valsVarDecl = valsDecl.declarationList.declarations[0];
    const newValsDecl = factory.updateVariableDeclaration(
      valsVarDecl,
      valsVarDecl.name,
      undefined,
      undefined,
      factory.createArrayLiteralExpression(valElements),
    );
    const newValsStmt = factory.updateVariableStatement(
      valsDecl,
      valsDecl.modifiers,
      factory.updateVariableDeclarationList(valsDecl.declarationList, [
        newValsDecl,
      ]),
    );

    // ifBlock[1]: const __pa_srcs__ = [<source strings>]
    const srcsDecl = ifBlock.statements[1] as ts.VariableStatement;
    const srcsVarDecl = srcsDecl.declarationList.declarations[0];
    const newSrcsDecl = factory.updateVariableDeclaration(
      srcsVarDecl,
      srcsVarDecl.name,
      undefined,
      undefined,
      factory.createArrayLiteralExpression(srcElements),
    );
    const newSrcsStmt = factory.updateVariableStatement(
      srcsDecl,
      srcsDecl.modifiers,
      factory.updateVariableDeclarationList(srcsDecl.declarationList, [
        newSrcsDecl,
      ]),
    );

    // ifBlock[2]: let __pa_msg__ = <customMessage or undefined>
    const msgDecl = ifBlock.statements[2] as ts.VariableStatement;
    const msgVarDecl = msgDecl.declarationList.declarations[0];
    const newMsgDecl = factory.updateVariableDeclaration(
      msgVarDecl,
      msgVarDecl.name,
      undefined,
      undefined,
      customMessage ?? factory.createIdentifier("undefined"),
    );
    const newMsgStmt = factory.updateVariableStatement(
      msgDecl,
      msgDecl.modifiers,
      factory.updateVariableDeclarationList(msgDecl.declarationList, [
        newMsgDecl,
      ]),
    );

    // Rebuild the if-block with patched statements
    const newIfBlock = factory.updateBlock(ifBlock, [
      newValsStmt,
      newSrcsStmt,
      newMsgStmt,
      ...ifBlock.statements.slice(3),
    ]);

    const newIfStmt = factory.updateIfStatement(
      ifStmt,
      ifStmt.expression,
      newIfBlock,
      ifStmt.elseStatement,
    );

    // Rebuild the arrow function body
    const newBlock = factory.updateBlock(block, [newResultStmt, newIfStmt]);

    const newArrow = factory.updateArrowFunction(
      arrowFn,
      arrowFn.modifiers,
      arrowFn.typeParameters,
      arrowFn.parameters,
      arrowFn.type,
      arrowFn.equalsGreaterThanToken,
      newBlock,
    );

    // Rebuild the IIFE
    return factory.createCallExpression(
      factory.createParenthesizedExpression(newArrow),
      undefined,
      [],
    );
  },
});

// ============================================================================
// @derive(Arbitrary) — Generate Random Value Generators from Types
// ============================================================================

export const ArbitraryDerive = defineDeriveMacro({
  name: "Arbitrary",
  description:
    "Generate a random value generator (Arbitrary instance) for property-based testing",

  expand(
    ctx: MacroContext,
    _target:
      | ts.InterfaceDeclaration
      | ts.ClassDeclaration
      | ts.TypeAliasDeclaration,
    typeInfo: DeriveTypeInfo,
  ): ts.Statement[] {
    const { name, fields } = typeInfo;
    const fnName = `arbitrary${name}`;

    // Generate a random value for each field based on its type
    const fieldGenerators = fields.map((field) => {
      const gen = getArbitraryForType(field);
      return `    ${field.name}: ${gen}`;
    });

    const code = `
export function ${fnName}(seed?: number): ${name} {
  const _rng = seed !== undefined ? _seededRandom(seed) : Math.random;
  return {
${fieldGenerators.join(",\n")}
  };
}

export function ${fnName}Many(count: number, seed?: number): ${name}[] {
  const results: ${name}[] = [];
  for (let i = 0; i < count; i++) {
    results.push(${fnName}(seed !== undefined ? seed + i : undefined));
  }
  return results;
}
`;

    // Also generate the seeded random helper if not already present
    const helperCode = `
function _seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}
`;

    return [...ctx.parseStatements(helperCode), ...ctx.parseStatements(code)];
  },
});

function getArbitraryForType(field: DeriveFieldInfo): string {
  const typeStr = field.typeString.toLowerCase();

  if (field.optional) {
    const inner = getArbitraryForBaseType(typeStr);
    return `(_rng() > 0.5 ? ${inner} : undefined)`;
  }

  return getArbitraryForBaseType(typeStr);
}

function getArbitraryForBaseType(typeStr: string): string {
  if (typeStr === "number") {
    return "(_rng() * 200 - 100)";
  }
  if (typeStr === "string") {
    return `String.fromCharCode(...Array.from({ length: Math.floor(_rng() * 20) + 1 }, () => Math.floor(_rng() * 26) + 97))`;
  }
  if (typeStr === "boolean") {
    return "(_rng() > 0.5)";
  }
  if (typeStr.includes("[]") || typeStr.startsWith("array")) {
    return "[]";
  }
  // Default: empty object
  return "({} as any)";
}

// ============================================================================
// comptimeAssert() — Compile-Time Build Assertions
// ============================================================================

export const staticAssertMacro = defineExpressionMacro({
  name: "staticAssert",
  module: "@typesugar/testing",
  description:
    "Assert a condition at compile time — fails the BUILD if the condition is false",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        callExpr,
        "staticAssert expects 1 or 2 arguments: staticAssert(expr) or staticAssert(expr, message)",
      );
      return callExpr;
    }

    const conditionExpr = args[0];
    const messageExpr = args.length === 2 ? args[1] : undefined;

    // Try to evaluate the condition at compile time
    const result = ctx.evaluate(conditionExpr);

    if (result.kind === "error") {
      // Can't evaluate at compile time — report error
      ctx.reportError(
        callExpr,
        `staticAssert: cannot evaluate condition at compile time: ${result.message}`,
      );
      return callExpr;
    }

    // Check truthiness
    const isTruthy =
      (result.kind === "boolean" && result.value) ||
      (result.kind === "number" && result.value !== 0) ||
      (result.kind === "string" && result.value !== "") ||
      result.kind === "array" ||
      result.kind === "object";

    if (!isTruthy) {
      // Evaluate the message if provided
      let message = "Compile-time assertion failed";
      if (messageExpr) {
        const msgResult = ctx.evaluate(messageExpr);
        if (msgResult.kind === "string") {
          message = msgResult.value;
        }
      }

      // Get source location info
      const sourceText = conditionExpr.getText
        ? conditionExpr.getText(ctx.sourceFile)
        : "<expression>";

      ctx.reportError(
        callExpr,
        `${message}\n  Assertion: staticAssert(${sourceText})`,
      );
    }

    // Replace with void 0 (no runtime cost)
    return ctx.factory.createVoidExpression(
      ctx.factory.createNumericLiteral(0),
    );
  },
});

// ============================================================================
// @testCases — Parameterized Test Generation
// ============================================================================

export const testCasesAttribute = defineAttributeMacro({
  name: "testCases",
  module: "@typesugar/testing",
  description:
    "Expand a single test function into multiple parameterized test cases",
  validTargets: ["function"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    args: readonly ts.Expression[],
  ): ts.Node | ts.Node[] {
    if (!ts.isFunctionDeclaration(target)) {
      ctx.reportError(
        target,
        "@testCases can only be applied to function declarations",
      );
      return target;
    }

    if (args.length !== 1 || !ts.isArrayLiteralExpression(args[0])) {
      ctx.reportError(
        _decorator,
        "@testCases expects a single array argument of test case objects",
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
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

    for (let i = 0; i < casesArray.elements.length; i++) {
      const caseExpr = casesArray.elements[i];

      if (!ts.isObjectLiteralExpression(caseExpr)) {
        ctx.reportError(
          caseExpr,
          `@testCases: element ${i} must be an object literal`,
        );
        continue;
      }

      // Extract property values for the test case label
      const props = new Map<string, string>();
      for (const prop of caseExpr.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
          const valText = printer.printNode(
            ts.EmitHint.Expression,
            prop.initializer,
            ctx.sourceFile,
          );
          props.set(prop.name.text, valText);
        }
      }

      // Build a descriptive test name
      const caseLabel = Array.from(props.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");

      // Generate: it("fnName (case #i: label)", () => { ... })
      // where the body destructures the case object into the function params
      const paramNames = params.map((p) =>
        ts.isIdentifier(p.name) ? p.name.text : `_p${i}`,
      );

      const destructure = paramNames
        .map((name) => {
          const val = props.get(name);
          return val !== undefined ? `const ${name} = ${val};` : "";
        })
        .filter(Boolean)
        .join("\n  ");

      const bodyText = printer.printNode(
        ts.EmitHint.Unspecified,
        body,
        ctx.sourceFile,
      );
      // Strip the outer braces from the function body
      const innerBody = bodyText.replace(/^\{/, "").replace(/\}$/, "").trim();

      const testCode = `
it("${fnName} (case #${i + 1}: ${caseLabel.replace(/"/g, '\\"')})", () => {
  ${destructure}
  ${innerBody}
});
`;

      statements.push(...ctx.parseStatements(testCode));
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
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        callExpr,
        "assertSnapshot expects 1 or 2 arguments: assertSnapshot(expr) or assertSnapshot(expr, snapshotName)",
      );
      return callExpr;
    }

    const expr = args[0];
    const snapshotName = args.length === 2 ? args[1] : undefined;
    const factory = ctx.factory;

    // Capture the source text of the expression at compile time
    const exprSource = expr.getText
      ? expr.getText(ctx.sourceFile)
      : "<expression>";

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
        factory.createTemplateExpression(
          factory.createTemplateHead(`${snapshotLabel} [`),
          [
            factory.createTemplateSpan(
              snapshotName,
              factory.createTemplateTail("]"),
            ),
          ],
        ),
      );
    } else {
      snapshotArgs.push(factory.createStringLiteral(snapshotLabel));
    }

    // Build: expect(<expr>).toMatchSnapshot(<label>)
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createCallExpression(
          factory.createIdentifier("expect"),
          undefined,
          [expr],
        ),
        "toMatchSnapshot",
      ),
      undefined,
      snapshotArgs,
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
    _args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(
        callExpr,
        "typeAssert requires exactly one type argument: typeAssert<Condition>()",
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
      const sourceText = typeArg.getText
        ? typeArg.getText(ctx.sourceFile)
        : typeStr;
      ctx.reportError(
        callExpr,
        `Type assertion failed: typeAssert<${sourceText}> resolved to false`,
      );
      return factory.createVoidExpression(factory.createNumericLiteral(0));
    }

    // If the type is `boolean` (union of true | false), it means the
    // type-level computation is ambiguous — warn but don't fail
    if (typeStr === "boolean") {
      const sourceText = typeArg.getText
        ? typeArg.getText(ctx.sourceFile)
        : typeStr;
      ctx.reportWarning(
        callExpr,
        `Type assertion ambiguous: typeAssert<${sourceText}> resolved to boolean (expected true)`,
      );
    }

    // For any other type, it's a failure
    if (typeStr !== "true" && typeStr !== "boolean") {
      const sourceText = typeArg.getText
        ? typeArg.getText(ctx.sourceFile)
        : typeStr;
      ctx.reportError(
        callExpr,
        `Type assertion failed: typeAssert<${sourceText}> resolved to ${typeStr} (expected true)`,
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
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length < 2 || args.length > 3) {
      ctx.reportError(
        callExpr,
        "forAll expects 2-3 arguments: forAll(generator, property) or forAll(generator, count, property)",
      );
      return callExpr;
    }

    const factory = ctx.factory;
    const generator = args[0];
    const count =
      args.length === 3 ? args[1] : factory.createNumericLiteral(100);
    const property = args.length === 3 ? args[2] : args[1];

    // Generate hygienic variable names
    const iName = ctx.generateUniqueName("fa_i").text;
    const valueName = ctx.generateUniqueName("fa_value").text;
    const eName = ctx.generateUniqueName("fa_e").text;
    const errName = ctx.generateUniqueName("fa_err").text;

    // Generate:
    // (() => {
    //   for (let <i> = 0; <i> < <count>; <i>++) {
    //     const <value> = <generator>(<i>);
    //     try {
    //       (<property>)(<value>);
    //     } catch (<e>) {
    //       const <err> = <e> instanceof Error ? <e>.message : String(<e>);
    //       throw new Error(
    //         `Property failed after ${<i> + 1} tests.\n` +
    //         `Failing input: ${JSON.stringify(<value>)}\n` +
    //         `Error: ${<err>}`
    //       );
    //     }
    //   }
    // })()

    const code = `(() => {
  for (let ${iName} = 0; ${iName} < 100; ${iName}++) {
    const ${valueName} = undefined;
    try {
      undefined;
    } catch (${eName}) {
      const ${errName} = ${eName} instanceof Error ? ${eName}.message : String(${eName});
      throw new Error(
        "Property failed after " + (${iName} + 1) + " tests.\\n" +
        "Failing input: " + JSON.stringify(${valueName}) + "\\n" +
        "Error: " + ${errName}
      );
    }
  }
})()`;

    const stmts = ctx.parseStatements(code);
    const iifeStmt = stmts[0] as ts.ExpressionStatement;
    const iifeCall = iifeStmt.expression as ts.CallExpression;
    const arrowFn = (iifeCall.expression as ts.ParenthesizedExpression)
      .expression as ts.ArrowFunction;
    const block = arrowFn.body as ts.Block;
    const forStmt = block.statements[0] as ts.ForStatement;
    const forBlock = forStmt.statement as ts.Block;

    // Patch the for condition to use the real count
    const newForStmt = factory.updateForStatement(
      forStmt,
      forStmt.initializer,
      factory.createBinaryExpression(
        factory.createIdentifier(iName),
        factory.createToken(ts.SyntaxKind.LessThanToken),
        count,
      ),
      forStmt.incrementor,
      forStmt.statement,
    );

    // Patch <value> = <generator>(<i>)
    const valueDecl = forBlock.statements[0] as ts.VariableStatement;
    const valueVarDecl = valueDecl.declarationList.declarations[0];
    const newValueDecl = factory.updateVariableDeclaration(
      valueVarDecl,
      valueVarDecl.name,
      undefined,
      undefined,
      factory.createCallExpression(generator, undefined, [
        factory.createIdentifier(iName),
      ]),
    );
    const newValueStmt = factory.updateVariableStatement(
      valueDecl,
      valueDecl.modifiers,
      factory.updateVariableDeclarationList(valueDecl.declarationList, [
        newValueDecl,
      ]),
    );

    // Patch try body: (<property>)(<value>)
    const tryStmt = forBlock.statements[1] as ts.TryStatement;
    const tryBlock = tryStmt.tryBlock;
    const newTryBlock = factory.updateBlock(tryBlock, [
      factory.createExpressionStatement(
        factory.createCallExpression(
          factory.createParenthesizedExpression(property),
          undefined,
          [factory.createIdentifier(valueName)],
        ),
      ),
    ]);

    const newTryStmt = factory.updateTryStatement(
      tryStmt,
      newTryBlock,
      tryStmt.catchClause,
      tryStmt.finallyBlock,
    );

    // Rebuild
    const newForBlock = factory.updateBlock(forBlock, [
      newValueStmt,
      newTryStmt,
    ]);

    const finalForStmt = factory.updateForStatement(
      newForStmt,
      newForStmt.initializer,
      newForStmt.condition,
      newForStmt.incrementor,
      newForBlock,
    );

    const newBody = factory.updateBlock(block, [finalForStmt]);
    const newArrow = factory.updateArrowFunction(
      arrowFn,
      arrowFn.modifiers,
      arrowFn.typeParameters,
      arrowFn.parameters,
      arrowFn.type,
      arrowFn.equalsGreaterThanToken,
      newBody,
    );

    return factory.createCallExpression(
      factory.createParenthesizedExpression(newArrow),
      undefined,
      [],
    );
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
    args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(
        callExpr,
        "assertType requires exactly one type argument: assertType<T>(value)",
      );
      return callExpr;
    }

    if (args.length < 1 || args.length > 2) {
      ctx.reportError(
        callExpr,
        "assertType expects 1 or 2 arguments: assertType<T>(value) or assertType<T>(value, message)",
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
    }> = properties.map((prop) => {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(
        prop,
        callExpr,
      );
      return {
        name: prop.name,
        type: ctx.typeChecker.typeToString(propType),
        optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
      };
    });

    // Generate unique variable names
    const valueName = ctx.generateUniqueName("at_value").text;
    const errorsName = ctx.generateUniqueName("at_errors").text;
    const fieldName = ctx.generateUniqueName("at_field").text;
    const actualName = ctx.generateUniqueName("at_actual").text;

    // Build the field metadata as an array literal
    const fieldMetaElements = fieldInfos.map((f) =>
      factory.createObjectLiteralExpression([
        factory.createPropertyAssignment("name", factory.createStringLiteral(f.name)),
        factory.createPropertyAssignment("type", factory.createStringLiteral(f.type)),
        factory.createPropertyAssignment(
          "optional",
          f.optional ? factory.createTrue() : factory.createFalse(),
        ),
      ]),
    );

    // Generate the runtime validation code
    // This IIFE checks each field and collects detailed errors
    const code = `(() => {
  const ${valueName} = undefined;
  const ${errorsName}: string[] = [];

  // Check that value is an object
  if (typeof ${valueName} !== "object" || ${valueName} === null) {
    throw new Error(
      "Type assertion failed for '${typeName}': expected object, got " +
      (${valueName} === null ? "null" : typeof ${valueName})
    );
  }

  // Field metadata from compile-time type info
  const __at_fields__ = [];

  for (const ${fieldName} of __at_fields__) {
    const ${actualName} = (${valueName} as any)[${fieldName}.name];

    // Check if field exists
    if (${actualName} === undefined) {
      if (!${fieldName}.optional) {
        ${errorsName}.push(\`Field '\${${fieldName}.name}': missing (required, expected \${${fieldName}.type})\`);
      }
      continue;
    }

    // Type validation based on expected type
    const actualType = typeof ${actualName};
    const expectedType = ${fieldName}.type;

    // Handle primitive type checks
    if (expectedType === "string" && actualType !== "string") {
      ${errorsName}.push(\`Field '\${${fieldName}.name}': expected string, got \${actualType}\`);
    } else if (expectedType === "number" && actualType !== "number") {
      ${errorsName}.push(\`Field '\${${fieldName}.name}': expected number, got \${actualType}\`);
    } else if (expectedType === "boolean" && actualType !== "boolean") {
      ${errorsName}.push(\`Field '\${${fieldName}.name}': expected boolean, got \${actualType}\`);
    } else if (expectedType.endsWith("[]") && !Array.isArray(${actualName})) {
      ${errorsName}.push(\`Field '\${${fieldName}.name}': expected array, got \${actualType}\`);
    }
  }

  if (${errorsName}.length > 0) {
    let msg = "Type assertion failed for '${typeName}'";
    if (undefined !== undefined) {
      msg += ": " + undefined;
    }
    msg += "\\n  - " + ${errorsName}.join("\\n  - ");
    throw new Error(msg);
  }
})()`;

    const stmts = ctx.parseStatements(code);
    const iifeStmt = stmts[0] as ts.ExpressionStatement;
    const iifeCall = iifeStmt.expression as ts.CallExpression;
    const arrowFn = (iifeCall.expression as ts.ParenthesizedExpression)
      .expression as ts.ArrowFunction;
    const block = arrowFn.body as ts.Block;

    // Patch: const <valueName> = <valueExpr>
    const valueDecl = block.statements[0] as ts.VariableStatement;
    const valueVarDecl = valueDecl.declarationList.declarations[0];
    const newValueDecl = factory.updateVariableDeclaration(
      valueVarDecl,
      valueVarDecl.name,
      undefined,
      undefined,
      valueExpr,
    );
    const newValueStmt = factory.updateVariableStatement(
      valueDecl,
      valueDecl.modifiers,
      factory.updateVariableDeclarationList(valueDecl.declarationList, [
        newValueDecl,
      ]),
    );

    // Patch: const __at_fields__ = [<field metadata>]
    const fieldsDecl = block.statements[3] as ts.VariableStatement;
    const fieldsVarDecl = fieldsDecl.declarationList.declarations[0];
    const newFieldsDecl = factory.updateVariableDeclaration(
      fieldsVarDecl,
      fieldsVarDecl.name,
      undefined,
      undefined,
      factory.createArrayLiteralExpression(fieldMetaElements, true),
    );
    const newFieldsStmt = factory.updateVariableStatement(
      fieldsDecl,
      fieldsDecl.modifiers,
      factory.updateVariableDeclarationList(fieldsDecl.declarationList, [
        newFieldsDecl,
      ]),
    );

    // Find and patch the custom message in the final if block
    const ifStmt = block.statements[5] as ts.IfStatement;
    const ifBlock = ifStmt.thenStatement as ts.Block;

    // The message variable is in statement index 1 of the if block
    // We need to patch: if (undefined !== undefined) to use customMessage
    const msgIfStmt = ifBlock.statements[1] as ts.IfStatement;
    let newMsgIfStmt: ts.IfStatement;

    if (customMessage) {
      newMsgIfStmt = factory.updateIfStatement(
        msgIfStmt,
        factory.createBinaryExpression(
          customMessage,
          factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
          factory.createIdentifier("undefined"),
        ),
        factory.createBlock([
          factory.createExpressionStatement(
            factory.createBinaryExpression(
              factory.createIdentifier("msg"),
              factory.createToken(ts.SyntaxKind.PlusEqualsToken),
              factory.createBinaryExpression(
                factory.createStringLiteral(": "),
                factory.createToken(ts.SyntaxKind.PlusToken),
                customMessage,
              ),
            ),
          ),
        ]),
        undefined,
      );
    } else {
      // Remove the if statement entirely by replacing with empty block
      newMsgIfStmt = factory.updateIfStatement(
        msgIfStmt,
        factory.createFalse(),
        factory.createBlock([]),
        undefined,
      );
    }

    const newIfBlock = factory.updateBlock(ifBlock, [
      ifBlock.statements[0],
      newMsgIfStmt,
      ifBlock.statements[2],
      ifBlock.statements[3],
    ]);

    const newIfStmt = factory.updateIfStatement(
      ifStmt,
      ifStmt.expression,
      newIfBlock,
      ifStmt.elseStatement,
    );

    // Rebuild the block with patched statements
    const newBlock = factory.updateBlock(block, [
      newValueStmt,
      block.statements[1], // const errors
      block.statements[2], // if (typeof value !== "object")
      newFieldsStmt,
      block.statements[4], // for loop
      newIfStmt,
    ]);

    const newArrow = factory.updateArrowFunction(
      arrowFn,
      arrowFn.modifiers,
      arrowFn.typeParameters,
      arrowFn.parameters,
      arrowFn.type,
      arrowFn.equalsGreaterThanToken,
      newBlock,
    );

    return factory.createCallExpression(
      factory.createParenthesizedExpression(newArrow),
      undefined,
      [],
    );
  },
});

// ============================================================================
// typeInfo<T>() — Compile-Time Type Reflection
// ============================================================================

/**
 * Expression macro that extracts compile-time type information.
 * This is re-exported from the core reflect macros and registered
 * here for convenience in testing scenarios.
 */
export const typeInfoMacro = defineExpressionMacro({
  name: "typeInfo",
  module: "@typesugar/testing",
  description:
    "Get compile-time type information for enhanced assertion diagnostics",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[],
  ): ts.Expression {
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(callExpr, "typeInfo requires exactly one type argument");
      return callExpr;
    }

    const typeArg = typeArgs[0];
    const type = ctx.typeChecker.getTypeFromTypeNode(typeArg);
    const typeName = ctx.typeChecker.typeToString(type);
    const properties = ctx.typeChecker.getPropertiesOfType(type);

    // Determine the kind
    let kind = "type";
    const symbol = type.getSymbol();
    if (symbol) {
      const decls = symbol.getDeclarations();
      if (decls && decls.length > 0) {
        const decl = decls[0];
        if (ts.isInterfaceDeclaration(decl)) kind = "interface";
        else if (ts.isClassDeclaration(decl)) kind = "class";
        else if (ts.isEnumDeclaration(decl)) kind = "enum";
      }
    }

    // Build fields array
    const fieldsArray = properties.map((prop) => {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(
        prop,
        callExpr,
      );
      const decls = prop.getDeclarations();
      const decl = decls?.[0];
      const isReadonly =
        decl && (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl))
          ? (decl.modifiers?.some(
              (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword,
            ) ?? false)
          : false;

      return factory.createObjectLiteralExpression(
        [
          factory.createPropertyAssignment(
            "name",
            factory.createStringLiteral(prop.name),
          ),
          factory.createPropertyAssignment(
            "type",
            factory.createStringLiteral(ctx.typeChecker.typeToString(propType)),
          ),
          factory.createPropertyAssignment(
            "optional",
            (prop.flags & ts.SymbolFlags.Optional) !== 0
              ? factory.createTrue()
              : factory.createFalse(),
          ),
          factory.createPropertyAssignment(
            "readonly",
            isReadonly ? factory.createTrue() : factory.createFalse(),
          ),
        ],
        true,
      );
    });

    return factory.createObjectLiteralExpression(
      [
        factory.createPropertyAssignment(
          "name",
          factory.createStringLiteral(typeName),
        ),
        factory.createPropertyAssignment(
          "kind",
          factory.createStringLiteral(kind),
        ),
        factory.createPropertyAssignment(
          "fields",
          factory.createArrayLiteralExpression(fieldsArray, true),
        ),
      ],
      true,
    );
  },
});

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
globalRegistry.register(staticAssertMacro);
globalRegistry.register(testCasesAttribute);
globalRegistry.register(assertSnapshotMacro);
globalRegistry.register(typeAssertMacro);
globalRegistry.register(forAllMacro);
globalRegistry.register(assertTypeMacro);
globalRegistry.register(typeInfoMacro);

// Backward compatibility aliases
globalRegistry.register(powerAssertMacro);
globalRegistry.register(comptimeAssertMacro);
