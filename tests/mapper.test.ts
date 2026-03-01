import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";

// Register macros manually
import { transformIntoMacro } from "../packages/mapper/src/macros.js";

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  strict: true,
};

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

function createTestContext(sourceText: string): MacroContextImpl {
  const sourceFile = ts.createSourceFile(
    "test.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const host = ts.createCompilerHost(options);
  const program = ts.createProgram(["test.ts"], options, {
    ...host,
    getSourceFile: (name) =>
      name === "test.ts" ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
  });

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

  it("should use ignore.target to skip target fields from output", () => {
    const { output } = expandTransformInto(`
      interface Source { id: number; name: string; }
      interface Target { id: number; name: string; internalCode: string; debugInfo: string; }
      const s: Source = { id: 1, name: "x" };
      transformInto<Source, Target>(s, { ignore: { target: ["internalCode", "debugInfo"] } });
    `);

    // Target has 4 fields but ignore.target skips internalCode and debugInfo
    // Output should only include id and name (the other two have no mapping anyway)
    expect(output.replace(/\s+/g, "")).toContain("{id:s.id,name:s.name}");
    expect(output).not.toContain("internalCode");
    expect(output).not.toContain("debugInfo");
  });

  it("should use ignore.target to omit specific target fields from output", () => {
    const { output } = expandTransformInto(`
      interface Source { a: number; b: string; }
      interface Target { a: number; b: string; skipMe: string; }
      const s: Source = { a: 1, b: "x" };
      transformInto<Source, Target>(s, { ignore: { target: ["skipMe"] }, const: { skipMe: "ignored" } });
    `);

    // With ignore.target: ["skipMe"], we skip skipMe even though we have const for it
    // So output should NOT include skipMe
    expect(output.replace(/\s+/g, "")).toContain("{a:s.a,b:s.b}");
    expect(output).not.toContain("skipMe");
  });
});
