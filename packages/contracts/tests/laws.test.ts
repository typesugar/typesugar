/**
 * Tests for laws.ts — the generic @laws attribute macro
 *
 * Covers the two AST-construction code paths added by the PEP-057 migration
 * away from `ctx.parseStatements(templateString)`:
 *
 * - expandCompileTime: builds a `(function __laws_verify_<name>() { ... })();`
 *   IIFE directly via `ts.factory.create*`.
 * - expandPropertyTest: builds a `describe(...)`/`it(...)` property-test
 *   block directly via `ts.factory.create*`.
 *
 * Both are exercised end-to-end through `lawsAttribute.expand()` (no access
 * to unexported internals is required), asserting both printed-text shape
 * and actual AST node kinds/structure so the tests would fail on a
 * string-templating regression, not just on cosmetic output changes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";
import { lawsAttribute } from "@typesugar/contracts/macros";
import { setLawsConfig, resetLawsConfig } from "@typesugar/contracts";

// ---------------------------------------------------------------------------
// Helpers — build a ts.Program backed by a temp source file, then create a
// real MacroContext inside a transformer. Mirrors the pattern used by
// packages/macros/src/verify-laws.test.ts for its sibling macro.
// ---------------------------------------------------------------------------

interface ProgramFixture {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
}

function makeProgram(source: string): ProgramFixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "laws-test-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const sf = origGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    if (sf && fileName === filePath) {
      return ts.createSourceFile(fileName, sf.text, languageVersion, true);
    }
    return sf;
  };

  const program = ts.createProgram([filePath], options, host);
  const sourceFile = program.getSourceFile(filePath)!;
  return {
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * Run a transformer once, capturing the MacroContext for synchronous use.
 */
function withContext<T>(source: string, fn: (ctx: MacroContext, sf: ts.SourceFile) => T): T {
  const { program, sourceFile, cleanup } = makeProgram(source);
  try {
    let result: T | undefined;
    let captured = false;
    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      result = fn(ctx, sourceFile);
      captured = true;
      return (sf) => sf;
    };
    ts.transform(sourceFile, [transformerFactory]);
    if (!captured) {
      throw new Error("transformer did not run");
    }
    return result as T;
  } finally {
    cleanup();
  }
}

function firstVarStatement(sf: ts.SourceFile): ts.VariableStatement {
  const v = sf.statements.find(ts.isVariableStatement);
  if (!v) throw new Error("no VariableStatement found in source");
  return v;
}

function printNodes(nodes: ts.Node[], sf: ts.SourceFile): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return nodes.map((n) => printer.printNode(ts.EmitHint.Unspecified, n, sf)).join("\n");
}

/**
 * Parse a `@laws(...)` decorator applied to a throwaway class, and return its
 * call-expression arguments as real (positioned) ts.Expression nodes. Real
 * parser output is required here — `parseOptions` inside laws.ts calls
 * `value.getText()` on option values, which throws on synthetic
 * (factory-created, position -1) nodes.
 */
function parseDecoratorArgs(decoratorCall: string): readonly ts.Expression[] {
  return withContext(`${decoratorCall}\nclass __X {}`, (_ctx, sf) => {
    const cls = sf.statements.find(ts.isClassDeclaration)!;
    const decorators = ts.getDecorators(cls);
    if (!decorators || decorators.length === 0) {
      throw new Error("decorator not parsed");
    }
    const expr = decorators[0].expression;
    if (!ts.isCallExpression(expr)) {
      return [] as readonly ts.Expression[];
    }
    return expr.arguments.map((a) => a);
  });
}

/**
 * Run `lawsAttribute.expand()` against the first VariableStatement in
 * `source`, with `decoratorArgs` as the macro call arguments.
 */
function runAttribute(
  source: string,
  decoratorArgs: readonly ts.Expression[] = []
): {
  nodes: ts.Node[];
  printed: string;
  diagnostics: ReturnType<MacroContext["getDiagnostics"]>;
} {
  return withContext(source, (ctx, sf) => {
    const target = firstVarStatement(sf);
    const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("laws"));
    const result = lawsAttribute.expand(ctx, decorator, target, decoratorArgs);
    const nodes = Array.isArray(result) ? result : [result];
    return {
      nodes,
      printed: printNodes(nodes, sf),
      diagnostics: ctx.getDiagnostics(),
    };
  });
}

beforeEach(() => {
  resetLawsConfig();
});

afterEach(() => {
  resetLawsConfig();
});

// ===========================================================================
// lawsAttribute metadata + erasure mode
// ===========================================================================

describe("lawsAttribute", () => {
  it("declares the expected macro metadata", () => {
    expect(lawsAttribute.name).toBe("laws");
    expect(lawsAttribute.module).toBe("@typesugar/contracts");
    expect(lawsAttribute.kind).toBe("attribute");
    expect(lawsAttribute.validTargets).toContain("property");
    expect(lawsAttribute.validTargets).toContain("class");
  });

  it("erases the decorator by default (mode=false)", () => {
    const args = parseDecoratorArgs(`@laws(myLaws)`);
    const { nodes, diagnostics } = runAttribute(`const myThing: Foo = {} as any;`, args);
    expect(nodes).toHaveLength(1);
    expect(diagnostics).toHaveLength(0);
  });

  it("reports an error and strips when no law generator is given", () => {
    setLawsConfig({ mode: "compile-time" });
    const { nodes, diagnostics } = runAttribute(`const myThing: Foo = {} as any;`, []);
    expect(nodes).toHaveLength(1);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toMatch(/requires a law generator/);
  });
});

// ===========================================================================
// expandCompileTime — direct ts.factory AST construction of the IIFE
// ===========================================================================

describe("expandCompileTime (mode='compile-time')", () => {
  beforeEach(() => {
    setLawsConfig({ mode: "compile-time" });
  });

  it("emits a stripped target plus an IIFE referencing the law generator and instance", () => {
    const args = parseDecoratorArgs(`@laws(myLaws)`);
    const { nodes, printed, diagnostics } = runAttribute(`const myThing: Foo = {} as any;`, args);

    expect(diagnostics).toHaveLength(0);
    expect(nodes).toHaveLength(2);
    expect(printed).toContain("__laws_verify_myThing");
    expect(printed).toContain("myLaws(myThing)");
    expect(printed).toContain("TYPESUGAR_LAWS_DEBUG");
  });

  it("builds the IIFE as real AST nodes (function expression, for-of, if-guard)", () => {
    const args = parseDecoratorArgs(`@laws(myLaws)`);
    const { nodes } = runAttribute(`const myThing: Foo = {} as any;`, args);

    const iifeStatement = nodes[1];
    expect(ts.isExpressionStatement(iifeStatement)).toBe(true);
    const callExpr = (iifeStatement as ts.ExpressionStatement).expression;
    expect(ts.isCallExpression(callExpr)).toBe(true);

    const paren = (callExpr as ts.CallExpression).expression;
    expect(ts.isParenthesizedExpression(paren)).toBe(true);
    const fnExpr = (paren as ts.ParenthesizedExpression).expression;
    expect(ts.isFunctionExpression(fnExpr)).toBe(true);
    expect((fnExpr as ts.FunctionExpression).name?.text).toBe("__laws_verify_myThing");

    const body = (fnExpr as ts.FunctionExpression).body;
    expect(body.statements).toHaveLength(2);

    // statements[0]: const _laws = myLaws(myThing);
    const lawsDecl = body.statements[0];
    expect(ts.isVariableStatement(lawsDecl)).toBe(true);
    const decl = (lawsDecl as ts.VariableStatement).declarationList.declarations[0];
    expect((decl.name as ts.Identifier).text).toBe("_laws");
    expect(ts.isCallExpression(decl.initializer!)).toBe(true);

    // statements[1]: for (const _law of _laws) { if (...) { console.log(...) } }
    const forOf = body.statements[1];
    expect(ts.isForOfStatement(forOf)).toBe(true);
    const forOfStmt = forOf as ts.ForOfStatement;
    expect(ts.isBlock(forOfStmt.statement)).toBe(true);
    const ifStmt = (forOfStmt.statement as ts.Block).statements[0];
    expect(ts.isIfStatement(ifStmt)).toBe(true);
  });

  it("threads the explicit eq argument into the law-generator call", () => {
    const args = parseDecoratorArgs(`@laws(myLaws, { eq: eqFoo })`);
    const { printed, diagnostics } = runAttribute(`const myThing: Foo = {} as any;`, args);
    expect(diagnostics).toHaveLength(0);
    expect(printed).toContain("myLaws(myThing, eqFoo)");
  });

  it("builds a dotted eq reference as a property-access chain, not spliced text", () => {
    const args = parseDecoratorArgs(`@laws(myLaws, { eq: myModule.eqFoo })`);
    const { nodes, printed } = runAttribute(`const myThing: Foo = {} as any;`, args);
    expect(printed).toContain("myLaws(myThing, myModule.eqFoo)");

    const fnExpr = (
      ((nodes[1] as ts.ExpressionStatement).expression as ts.CallExpression)
        .expression as ts.ParenthesizedExpression
    ).expression as ts.FunctionExpression;
    const lawsDecl = fnExpr.body.statements[0] as ts.VariableStatement;
    const call = lawsDecl.declarationList.declarations[0].initializer as ts.CallExpression;
    const eqArg = call.arguments[1];
    expect(ts.isPropertyAccessExpression(eqArg)).toBe(true);
    expect((eqArg as ts.PropertyAccessExpression).name.text).toBe("eqFoo");
  });
});

// ===========================================================================
// expandPropertyTest — direct ts.factory AST construction of describe/it
// ===========================================================================

describe("expandPropertyTest (mode='property-test')", () => {
  beforeEach(() => {
    setLawsConfig({ mode: "property-test" });
  });

  it("reports an error and strips when 'arbitrary' is missing", () => {
    const args = parseDecoratorArgs(`@laws(myLaws)`);
    const { nodes, diagnostics } = runAttribute(`const myThing: Foo = {} as any;`, args);
    expect(nodes).toHaveLength(1);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toMatch(/requires an 'arbitrary' option/);
  });

  it("emits describe/it referencing the law generator, instance, and iteration count", () => {
    setLawsConfig({ iterations: 7 });
    const args = parseDecoratorArgs(`@laws(myLaws, { arbitrary: arbFoo })`);
    const { nodes, printed, diagnostics } = runAttribute(`const myThing: Foo = {} as any;`, args);

    expect(diagnostics).toHaveLength(0);
    expect(nodes).toHaveLength(2);
    expect(printed).toContain('describe("myThing laws"');
    expect(printed).toContain("myLaws(myThing)");
    expect(printed).toContain("arbFoo.arbitrary()");
    expect(printed).toContain("_i < 7");
  });

  it("builds the describe/it block as real AST nodes", () => {
    const args = parseDecoratorArgs(`@laws(myLaws, { arbitrary: arbFoo })`);
    const { nodes } = runAttribute(`const myThing: Foo = {} as any;`, args);

    const describeStatement = nodes[1];
    expect(ts.isExpressionStatement(describeStatement)).toBe(true);
    const describeCall = (describeStatement as ts.ExpressionStatement)
      .expression as ts.CallExpression;
    expect(ts.isCallExpression(describeCall)).toBe(true);
    expect((describeCall.expression as ts.Identifier).text).toBe("describe");

    const [titleArg, arrowArg] = describeCall.arguments;
    expect(ts.isStringLiteral(titleArg)).toBe(true);
    expect((titleArg as ts.StringLiteral).text).toBe("myThing laws");
    expect(ts.isArrowFunction(arrowArg)).toBe(true);

    const describeBody = (arrowArg as ts.ArrowFunction).body as ts.Block;
    expect(describeBody.statements).toHaveLength(2);

    // statements[1]: for (const _law of _laws) { it(`satisfies ${_law.name}`, () => {...}) }
    const forOf = describeBody.statements[1];
    expect(ts.isForOfStatement(forOf)).toBe(true);
    const itStatement = ((forOf as ts.ForOfStatement).statement as ts.Block).statements[0];
    expect(ts.isExpressionStatement(itStatement)).toBe(true);
    const itCall = (itStatement as ts.ExpressionStatement).expression as ts.CallExpression;
    expect((itCall.expression as ts.Identifier).text).toBe("it");

    // it()'s second argument's body should contain the iteration for-loop.
    const itArrow = itCall.arguments[1] as ts.ArrowFunction;
    const itBody = itArrow.body as ts.Block;
    const iterationFor = itBody.statements[0];
    expect(ts.isForStatement(iterationFor)).toBe(true);
  });

  it("builds a dotted arbitrary reference as a property-access chain, not spliced text", () => {
    const args = parseDecoratorArgs(`@laws(myLaws, { arbitrary: myModule.arbFoo })`);
    const { printed } = runAttribute(`const myThing: Foo = {} as any;`, args);
    expect(printed).toContain("myModule.arbFoo.arbitrary()");
  });
});
