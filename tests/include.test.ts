/**
 * Tests for compile-time file I/O macros (includeStr, includeBytes, includeJson)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MacroContextImpl, createMacroContext } from "../src/core/context.js";
import {
  includeStrMacro,
  includeBytesMacro,
  includeJsonMacro,
  getFileDependencies,
  clearFileDependencies,
} from "../src/macros/include.js";

describe("compile-time file I/O macros", () => {
  let ctx: MacroContextImpl;
  let tmpDir: string;
  let printer: ts.Printer;

  function printExpr(node: ts.Expression): string {
    return printer.printNode(ts.EmitHint.Expression, node, ctx.sourceFile);
  }

  beforeEach(() => {
    // Create a temp directory with test files
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typemacro-test-"));

    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "Hello, World!");
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({ name: "test", version: 1, items: [1, 2, 3] })
    );
    fs.writeFileSync(path.join(tmpDir, "data.bin"), Buffer.from([0x48, 0x65, 0x6c]));

    const sourceFilePath = path.join(tmpDir, "test.ts");
    const sourceText = "const x = 1;";
    const sourceFile = ts.createSourceFile(
      sourceFilePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
    };

    const host = ts.createCompilerHost(options);
    const program = ts.createProgram([sourceFilePath], options, {
      ...host,
      getCurrentDirectory: () => tmpDir,
      getSourceFile: (name) =>
        name === sourceFilePath ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
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

    ctx = createMacroContext(program, sourceFile, transformContext);
    printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    clearFileDependencies();
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("includeStr", () => {
    it("should embed file contents as a string literal", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("includeStr"),
        undefined,
        [ts.factory.createStringLiteral("./hello.txt")]
      );

      const result = includeStrMacro.expand(ctx, callExpr, [
        ts.factory.createStringLiteral("./hello.txt"),
      ]);

      expect(ts.isStringLiteral(result)).toBe(true);
      expect((result as ts.StringLiteral).text).toBe("Hello, World!");
    });

    it("should record file dependency", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("includeStr"),
        undefined,
        [ts.factory.createStringLiteral("./hello.txt")]
      );

      includeStrMacro.expand(ctx, callExpr, [ts.factory.createStringLiteral("./hello.txt")]);

      const deps = getFileDependencies();
      expect(deps.size).toBe(1);
      expect([...deps][0]).toContain("hello.txt");
    });

    it("should report error for missing file", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("includeStr"),
        undefined,
        [ts.factory.createStringLiteral("./nonexistent.txt")]
      );

      includeStrMacro.expand(ctx, callExpr, [ts.factory.createStringLiteral("./nonexistent.txt")]);

      const diags = ctx.getDiagnostics();
      expect(diags.length).toBeGreaterThan(0);
      expect(diags[0].message).toContain("Cannot read file");
    });
  });

  describe("includeJson", () => {
    it("should parse JSON and embed as object literal", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("includeJson"),
        undefined,
        [ts.factory.createStringLiteral("./config.json")]
      );

      const result = includeJsonMacro.expand(ctx, callExpr, [
        ts.factory.createStringLiteral("./config.json"),
      ]);

      expect(ts.isObjectLiteralExpression(result)).toBe(true);
      const text = printExpr(result);
      expect(text).toContain("name");
      expect(text).toContain('"test"');
      expect(text).toContain("version");
    });
  });

  describe("includeBytes", () => {
    it("should embed file as Uint8Array", () => {
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("includeBytes"),
        undefined,
        [ts.factory.createStringLiteral("./data.bin")]
      );

      const result = includeBytesMacro.expand(ctx, callExpr, [
        ts.factory.createStringLiteral("./data.bin"),
      ]);

      expect(ts.isNewExpression(result)).toBe(true);
      const text = printExpr(result);
      expect(text).toContain("Uint8Array");
      expect(text).toContain("72"); // 0x48 = 72
      expect(text).toContain("101"); // 0x65 = 101
      expect(text).toContain("108"); // 0x6c = 108
    });
  });
});
