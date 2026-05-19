/**
 * Tests for config-when.ts — config.when expression and attribute macros.
 *
 * Covers:
 * - configWhenMacro (expression):
 *   * Condition true → returns the wrapped expression / invokes arrow.
 *   * Condition false → returns `undefined` identifier.
 *   * Condition false with else branch → returns the else expression.
 *   * Missing config key (falsy default).
 *   * Nested-path access (`features.x.y`).
 *   * Boolean / string / number value evaluation.
 *   * Equality predicates (`contracts.mode == 'full'`).
 *   * Arity errors (too few / too many args).
 *   * Non-string-literal condition error.
 * - configWhenAttrMacro (attribute):
 *   * Function declaration: kept (decorator stripped) when true; empty stmt when false.
 *   * Class declaration: same.
 *   * Variable statement: same.
 *   * Arity error (zero or two args).
 *   * Non-string-literal condition error.
 * - State isolation: config.reset() in beforeEach/afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, config } from "@typesugar/core";
import { configWhenMacro, configWhenAttrMacro } from "./config-when.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgramFromSource(source: string): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-when-test-"));
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
  const program = ts.createProgram([filePath], options, host);
  const sourceFile = program.getSourceFile(filePath)!;

  return {
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function findFirst<T extends ts.Node>(root: ts.Node, pred: (n: ts.Node) => n is T): T | undefined {
  let found: T | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (pred(n)) {
      found = n;
      return;
    }
    n.forEachChild(visit);
  };
  visit(root);
  return found;
}

/**
 * Build a source file containing `configWhen(...)` as a call expression, then
 * invoke configWhenMacro.expand on the parsed call. Returns the expanded
 * expression plus diagnostics.
 */
function runExpressionMacro(source: string): {
  expanded: ts.Expression;
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
  printed: string;
} {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);
  try {
    const callExpr = findFirst(
      sourceFile,
      (n): n is ts.CallExpression =>
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "configWhen"
    );
    if (!callExpr) throw new Error("configWhen call not found in source");

    let expanded: ts.Expression = ts.factory.createVoidZero();
    let diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    let printed = "";

    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      expanded = configWhenMacro.expand(ctx, callExpr, callExpr.arguments);
      diagnostics = ctx.getDiagnostics();
      printed = printer.printNode(ts.EmitHint.Unspecified, expanded, sourceFile);
      return (sf) => sf;
    };

    ts.transform(sourceFile, [transformerFactory]);
    return { expanded, diagnostics, printed };
  } finally {
    cleanup();
  }
}

/**
 * Run the attribute macro. Picks the first declaration matching `pick` and
 * runs expand against a synthesised decorator with the given args.
 */
function runAttributeMacro(
  source: string,
  pick: (sf: ts.SourceFile) => ts.Node | undefined,
  argFactories: ((factory: ts.NodeFactory) => ts.Expression)[]
): {
  nodes: ts.Node[];
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
  printed: string[];
} {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);
  try {
    const target = pick(sourceFile);
    if (!target) throw new Error("Test target not found");

    let collected: ts.Node[] = [];
    let diags: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const printed: string[] = [];

    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      const args = argFactories.map((f) => f(ctx.factory));
      const dummyDecorator = ctx.factory.createDecorator(
        ctx.factory.createCallExpression(
          ctx.factory.createPropertyAccessExpression(
            ctx.factory.createIdentifier("config"),
            ctx.factory.createIdentifier("when")
          ),
          undefined,
          args
        )
      );
      const result = configWhenAttrMacro.expand(ctx, dummyDecorator, target, args);
      collected = Array.isArray(result) ? result : [result];
      for (const n of collected) {
        printed.push(printer.printNode(ts.EmitHint.Unspecified, n, sourceFile));
      }
      diags = ctx.getDiagnostics();
      return (sf) => sf;
    };

    ts.transform(sourceFile, [transformerFactory]);
    return { nodes: collected, diagnostics: diags, printed };
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// State isolation: reset config before/after each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  config.reset();
});

afterEach(() => {
  config.reset();
});

// ===========================================================================
// macro metadata
// ===========================================================================

describe("macro metadata", () => {
  it("configWhenMacro is an expression macro named 'config.when'", () => {
    expect(configWhenMacro.kind).toBe("expression");
    expect(configWhenMacro.name).toBe("config.when");
    expect(configWhenMacro.module).toBe("@typesugar/core");
    expect(configWhenMacro.exportName).toBe("when");
  });

  it("configWhenAttrMacro is an attribute macro with class/function/method/property targets", () => {
    expect(configWhenAttrMacro.kind).toBe("attribute");
    expect(configWhenAttrMacro.name).toBe("config.when");
    expect(configWhenAttrMacro.validTargets).toEqual(["class", "method", "property", "function"]);
  });
});

// ===========================================================================
// configWhenMacro — expression form
// ===========================================================================

describe("configWhenMacro (expression)", () => {
  it("returns the then expression when the boolean condition is true", () => {
    config.set({ debug: true });
    const source = `const r = configWhen("debug", 42, 7);`;
    const { expanded, diagnostics, printed } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect(ts.isNumericLiteral(expanded)).toBe(true);
    expect((expanded as ts.NumericLiteral).text).toBe("42");
    expect(printed).toBe("42");
  });

  it("returns the else expression when the condition is false", () => {
    config.set({ debug: false });
    const source = `const r = configWhen("debug", 42, 7);`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect(ts.isNumericLiteral(expanded)).toBe(true);
    expect((expanded as ts.NumericLiteral).text).toBe("7");
  });

  it("returns the identifier `undefined` when the condition is false and no else branch supplied", () => {
    config.set({ debug: false });
    const source = `const r = configWhen("debug", 42);`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect(ts.isIdentifier(expanded)).toBe(true);
    expect((expanded as ts.Identifier).text).toBe("undefined");
  });

  it("treats a missing config key as falsy (no diagnostic, returns undefined)", () => {
    const source = `const r = configWhen("missing.key", 1);`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect(ts.isIdentifier(expanded)).toBe(true);
    expect((expanded as ts.Identifier).text).toBe("undefined");
  });

  it("supports nested dotted paths in the condition", () => {
    // features is typed as Record<string, boolean>; use it for nested truthy.
    config.set({ features: { experimental: true } });
    const source = `const r = configWhen("features.experimental", "on", "off");`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect(ts.isStringLiteral(expanded)).toBe(true);
    expect((expanded as ts.StringLiteral).text).toBe("on");
  });

  it("treats string config values as truthy", () => {
    config.set({ mode: "production" } as never);
    const source = `const r = configWhen("mode", 1, 2);`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect((expanded as ts.NumericLiteral).text).toBe("1");
  });

  it("treats numeric zero as falsy", () => {
    config.set({ count: 0 } as never);
    const source = `const r = configWhen("count", 1, 2);`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect((expanded as ts.NumericLiteral).text).toBe("2");
  });

  it("supports equality predicates (== 'value')", () => {
    config.set({ contracts: { mode: "full" } });
    const source = `const r = configWhen("contracts.mode == 'full'", "verbose", "quiet");`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect((expanded as ts.StringLiteral).text).toBe("verbose");
  });

  it("invokes an arrow-function then-branch when the condition is true", () => {
    config.set({ debug: true });
    const source = `const r = configWhen("debug", () => 99);`;
    const { expanded, diagnostics, printed } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect(ts.isCallExpression(expanded)).toBe(true);
    const call = expanded as ts.CallExpression;
    expect(ts.isParenthesizedExpression(call.expression)).toBe(true);
    expect(call.arguments.length).toBe(0);
    expect(printed.replace(/\s+/g, "")).toBe("(()=>99)()");
  });

  it("invokes an arrow-function else-branch when the condition is false", () => {
    config.set({ debug: false });
    const source = `const r = configWhen("debug", 1, () => 99);`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics).toEqual([]);
    expect(ts.isCallExpression(expanded)).toBe(true);
    expect(ts.isParenthesizedExpression((expanded as ts.CallExpression).expression)).toBe(true);
  });

  it("reports an error and returns the original call when too few arguments are given", () => {
    const source = `const r = configWhen("debug");`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/2-3 arguments/);
    // Returns the original CallExpression untouched.
    expect(ts.isCallExpression(expanded)).toBe(true);
  });

  it("reports an error and returns the original call when too many arguments are given", () => {
    const source = `const r = configWhen("debug", 1, 2, 3);`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(ts.isCallExpression(expanded)).toBe(true);
  });

  it("reports an error when the condition argument is not a string literal", () => {
    const source = `const cond = "debug"; const r = configWhen(cond, 1, 2);`;
    const { expanded, diagnostics } = runExpressionMacro(source);

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/string literal/);
    expect(ts.isCallExpression(expanded)).toBe(true);
  });
});

// ===========================================================================
// configWhenAttrMacro — attribute form
// ===========================================================================

describe("configWhenAttrMacro (attribute)", () => {
  it("keeps a function declaration (decorator stripped) when the condition is true", () => {
    config.set({ debug: true });
    const source = `function hello(): number { return 1; }`;
    const { nodes, diagnostics, printed } = runAttributeMacro(
      source,
      (sf) => sf.statements.find(ts.isFunctionDeclaration),
      [(f) => f.createStringLiteral("debug")]
    );

    expect(diagnostics).toEqual([]);
    expect(nodes.length).toBe(1);
    expect(ts.isFunctionDeclaration(nodes[0])).toBe(true);
    // Stripping a decorator that was never attached is a no-op; the resulting
    // declaration must still be a function called `hello`.
    expect((nodes[0] as ts.FunctionDeclaration).name?.text).toBe("hello");
    expect(printed[0]).toContain("hello");
  });

  it("replaces a function declaration with an empty statement when the condition is false", () => {
    config.set({ debug: false });
    const source = `function hello(): number { return 1; }`;
    const { nodes, diagnostics } = runAttributeMacro(
      source,
      (sf) => sf.statements.find(ts.isFunctionDeclaration),
      [(f) => f.createStringLiteral("debug")]
    );

    expect(diagnostics).toEqual([]);
    expect(nodes.length).toBe(1);
    expect(nodes[0].kind).toBe(ts.SyntaxKind.EmptyStatement);
  });

  it("keeps a class declaration when the condition is true", () => {
    config.set({ features: { experimental: true } });
    const source = `class Widget { x = 1; }`;
    const { nodes, diagnostics } = runAttributeMacro(
      source,
      (sf) => sf.statements.find(ts.isClassDeclaration),
      [(f) => f.createStringLiteral("features.experimental")]
    );

    expect(diagnostics).toEqual([]);
    expect(nodes.length).toBe(1);
    expect(ts.isClassDeclaration(nodes[0])).toBe(true);
    expect((nodes[0] as ts.ClassDeclaration).name?.text).toBe("Widget");
  });

  it("replaces a class declaration with an empty statement when the condition is false", () => {
    config.set({ features: { experimental: false } });
    const source = `class Widget { x = 1; }`;
    const { nodes, diagnostics } = runAttributeMacro(
      source,
      (sf) => sf.statements.find(ts.isClassDeclaration),
      [(f) => f.createStringLiteral("features.experimental")]
    );

    expect(diagnostics).toEqual([]);
    expect(nodes.length).toBe(1);
    expect(nodes[0].kind).toBe(ts.SyntaxKind.EmptyStatement);
  });

  it("keeps a variable statement when the condition is true", () => {
    config.set({ debug: true });
    const source = `const x = 42;`;
    const { nodes, diagnostics } = runAttributeMacro(
      source,
      (sf) => sf.statements.find(ts.isVariableStatement),
      [(f) => f.createStringLiteral("debug")]
    );

    expect(diagnostics).toEqual([]);
    expect(nodes.length).toBe(1);
    // stripDecorator on a variable statement that has no decorators returns
    // the original node untouched.
    expect(ts.isVariableStatement(nodes[0])).toBe(true);
  });

  it("replaces a variable statement with an empty statement when the condition is false", () => {
    config.set({ debug: false });
    const source = `const x = 42;`;
    const { nodes, diagnostics } = runAttributeMacro(
      source,
      (sf) => sf.statements.find(ts.isVariableStatement),
      [(f) => f.createStringLiteral("debug")]
    );

    expect(diagnostics).toEqual([]);
    expect(nodes.length).toBe(1);
    expect(nodes[0].kind).toBe(ts.SyntaxKind.EmptyStatement);
  });

  it("reports an error and returns the original target when arity is wrong (zero args)", () => {
    const source = `function hello(): number { return 1; }`;
    const { nodes, diagnostics } = runAttributeMacro(
      source,
      (sf) => sf.statements.find(ts.isFunctionDeclaration),
      []
    );

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/one argument/);
    expect(nodes.length).toBe(1);
    expect(ts.isFunctionDeclaration(nodes[0])).toBe(true);
  });

  it("reports an error and returns the original target when arity is wrong (two args)", () => {
    const source = `function hello(): number { return 1; }`;
    const { nodes, diagnostics } = runAttributeMacro(
      source,
      (sf) => sf.statements.find(ts.isFunctionDeclaration),
      [(f) => f.createStringLiteral("debug"), (f) => f.createStringLiteral("extra")]
    );

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(nodes.length).toBe(1);
    expect(ts.isFunctionDeclaration(nodes[0])).toBe(true);
  });

  it("reports an error when the condition argument is not a string literal", () => {
    const source = `function hello(): number { return 1; }`;
    const { nodes, diagnostics } = runAttributeMacro(
      source,
      (sf) => sf.statements.find(ts.isFunctionDeclaration),
      [(f) => f.createIdentifier("someVar")]
    );

    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/string literal/);
    expect(nodes.length).toBe(1);
    expect(ts.isFunctionDeclaration(nodes[0])).toBe(true);
  });
});
