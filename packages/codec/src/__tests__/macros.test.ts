/**
 * Tests for @typesugar/codec macro registration and @codec expansion
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { createMacroContext } from "@typesugar/core";
import { codecMacro, register } from "../macros.js";

describe("codec macros", () => {
  it("register exports and runs without error", () => {
    expect(typeof register).toBe("function");
    expect(() => register()).not.toThrow();
  });

  it("codecMacro is defined with correct metadata", () => {
    expect(codecMacro.name).toBe("codec");
    expect(codecMacro.module).toBe("@typesugar/codec");
    expect(codecMacro.validTargets).toContain("interface");
    expect(codecMacro.validTargets).toContain("class");
  });
});

describe("@codec macro expansion", () => {
  function createTestContext(sourceText: string) {
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
      experimentalDecorators: true,
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
    };

    return createMacroContext(program, sourceFile, transformContext);
  }

  function expandCodec(source: string): { output: string; nodes: ts.Node[] } {
    const fullSource = `
      import { defineSchema } from "@typesugar/codec";
      ${source}
    `;
    const ctx = createTestContext(fullSource);

    let decl: ts.ClassDeclaration | ts.InterfaceDeclaration | undefined;
    function visit(node: ts.Node) {
      if (ts.isClassDeclaration(node)) {
        decl = node;
      } else if (ts.isInterfaceDeclaration(node)) {
        decl = node;
      } else {
        ts.forEachChild(node, visit);
      }
    }
    ts.forEachChild(ctx.sourceFile, visit);

    if (!decl) throw new Error("No class/interface found");
    const dec = ts.factory.createDecorator(
      ts.factory.createCallExpression(ts.factory.createIdentifier("codec"), undefined, [])
    );

    const result = codecMacro.expand(ctx, dec, decl, []);
    const nodes = Array.isArray(result) ? result : [result];
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const output = nodes
      .map((n) => printer.printNode(ts.EmitHint.Unspecified, n, ctx.sourceFile))
      .join("\n");

    return { output, nodes };
  }

  it("expands @codec on class to include defineSchema call", () => {
    const { output } = expandCodec(`
class Product {
  id: number;
  name: string;
}
    `);

    expect(output).toContain("ProductSchema");
    expect(output).toContain("defineSchema");
    expect(output).toContain('"Product"');
  });
});
