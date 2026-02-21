import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";

// Register macros manually
import { transformIntoMacro } from "../packages/mapper/src/macros.js";

function createTestContext(sourceText: string): MacroContextImpl {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    strict: true,
  };

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["test.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "test.ts" ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
  });

  const transformContext: ts.TransformationContext = {
    factory: ts.factory,
    getCompilerOptions: () => options,
    startLexicalEnvironment: () => {},
    suspendLexicalEnvironment: () => {},
    resumeLexicalEnvironment: () => {},
    endLexicalEnvironment: () => undefined,
    hoistFunctionDeclaration: () => {},
    hoistVariableDeclaration: () => {},
    requestEmitHelper: () => {},
    readEmitHelpers: () => undefined,
    enableSubstitution: () => {},
    enableEmitNotification: () => {},
    isSubstitutionEnabled: () => false,
    isEmitNotificationEnabled: () => false,
    onSubstituteNode: (_hint, node) => node,
    onEmitNode: (_hint, node, emitCallback) => emitCallback(_hint, node),
    addDiagnostic: () => {},
  };

  return createMacroContext(program, sourceFile, transformContext);
}

function expandTransformInto(source: string): {
  result: ts.Expression;
  output: string;
} {
  const fullSource =
    "export declare function transformInto<From, To>(source: From, config?: any): To;\n" + source;
  const ctx = createTestContext(fullSource);

  let callExpr: ts.CallExpression | undefined;
  ts.forEachChild(ctx.sourceFile, function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      callExpr = node;
    } else {
      ts.forEachChild(node, visit);
    }
  });

  if (!callExpr) throw new Error("No CallExpression found");

  const result = transformIntoMacro.expand(ctx, callExpr, callExpr.arguments);

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const output = printer.printNode(ts.EmitHint.Unspecified, result, ctx.sourceFile);

  return { result, output };
}

describe("transformInto macro", () => {
  it("should expand to object literal correctly with no config", () => {
    const { output } = expandTransformInto(`
      interface A { x: number; y: string; }
      interface B { x: number; y: string; }
      const a: A = { x: 1, y: "a" };
      transformInto<A, B>(a);
    `);

    expect(output.replace(/\s+/g, "")).toContain("{x:a.x,y:a.y}");
  });

  it("should use rename config", () => {
    const { output } = expandTransformInto(`
      interface A { first_name: string; }
      interface B { firstName: string; }
      const a: A = { first_name: "John" };
      transformInto<A, B>(a, { rename: { firstName: "first_name" } });
    `);

    expect(output.replace(/\s+/g, "")).toContain("{firstName:a.first_name}");
  });

  it("should use const config", () => {
    const { output } = expandTransformInto(`
      interface A { name: string; }
      interface B { name: string; role: string; }
      const a: A = { name: "John" };
      transformInto<A, B>(a, { const: { role: "admin" } });
    `);

    expect(output.replace(/\s+/g, "")).toContain('{name:a.name,role:"admin"}');
  });

  it("should use compute config", () => {
    const { output } = expandTransformInto(`
      interface A { first: string; last: string; }
      interface B { full: string; }
      const a: A = { first: "John", last: "Doe" };
      transformInto<A, B>(a, { compute: { full: (src) => src.first + " " + src.last } });
    `);

    expect(output).toContain('(src) => src.first + " " + src.last');
  });
});
