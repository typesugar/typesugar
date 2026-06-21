/**
 * Tests for compile-time file I/O macros (includeStr, includeBytes, includeJson)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";
import {
  includeStrMacro,
  includeBytesMacro,
  includeJsonMacro,
  getFileDependencies,
  clearFileDependencies,
} from "@typesugar/macros";

describe("compile-time file I/O macros", () => {
  let ctx: MacroContextImpl;
  let tmpDir: string;
  let printer: ts.Printer;
  let program: ts.Program;
  let sourceFile: ts.SourceFile;
  let transformContext: ts.TransformationContext;

  function printExpr(node: ts.Expression): string {
    return printer.printNode(ts.EmitHint.Expression, node, ctx.sourceFile);
  }

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-test-"));

    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "Hello, World!");
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({ name: "test", version: 1, items: [1, 2, 3] })
    );
    fs.writeFileSync(path.join(tmpDir, "data.bin"), Buffer.from([0x48, 0x65, 0x6c]));

    const sourceFilePath = path.join(tmpDir, "test.ts");
    const sourceText = "const x = 1;";
    sourceFile = ts.createSourceFile(
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
    program = ts.createProgram([sourceFilePath], options, {
      ...host,
      getCurrentDirectory: () => tmpDir,
      getSourceFile: (name) =>
        name === sourceFilePath ? sourceFile : host.getSourceFile(name, ts.ScriptTarget.Latest),
    });

    transformContext = {
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

    printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    ctx = createMacroContext(program, sourceFile, transformContext);
    clearFileDependencies();
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
      expect(diags[0].message).toContain("Failed to read file");
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

  // ===========================================================================
  // Red-team: path traversal (F2 in docs/SECURITY-REVIEW.md)
  //
  // A hostile dependency can only influence the *path string* passed to an
  // include macro. These tests assert the boundary check blocks every way of
  // escaping the project root. `resolveRelativePath` throws synchronously; the
  // transformer catches that and surfaces it as a diagnostic (see
  // transformer.ts: `Macro expansion failed`), so compilation fails loudly
  // rather than embedding the file.
  // ===========================================================================
  describe("security: path traversal (F2)", () => {
    // Stage a secret OUTSIDE the project root so an escape would be observable.
    let secretPath: string;
    beforeAll(() => {
      secretPath = path.join(os.tmpdir(), `typesugar-secret-${path.basename(tmpDir)}.txt`);
      fs.writeFileSync(secretPath, "TOP_SECRET_CONTENTS");
    });
    afterAll(() => {
      fs.rmSync(secretPath, { force: true });
    });

    function callWith(arg: string): () => ts.Expression {
      const node = ts.factory.createStringLiteral(arg);
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("includeStr"),
        undefined,
        [node]
      );
      return () => includeStrMacro.expand(ctx, callExpr, [node]);
    }

    it("blocks relative traversal that escapes the project root", () => {
      expect(callWith("../../../../etc/passwd")).toThrow(/Security|outside the project root/);
    });

    it("blocks traversal aimed at the staged out-of-root secret", () => {
      // ../<basename of secret> from the source dir resolves to the secret file.
      const rel = path.relative(tmpDir, secretPath);
      expect(rel.startsWith("..")).toBe(true); // sanity: the path really escapes
      expect(callWith(rel)).toThrow(/Security|outside the project root/);
    });

    it("blocks a POSIX absolute path", () => {
      expect(callWith("/etc/passwd")).toThrow(/Security: absolute paths/);
    });

    it("blocks an absolute path to the staged secret", () => {
      expect(callWith(secretPath)).toThrow(/Security: absolute paths/);
    });

    it("blocks traversal even when it re-enters via a sibling dir", () => {
      // ./../<dir>/../../etc/passwd — collapses to an escape after normalization.
      expect(callWith("./sub/../../../../etc/passwd")).toThrow(/Security|outside the project root/);
    });

    it("does not embed secret contents when an escape is attempted", () => {
      // Belt-and-suspenders: confirm the secret never leaks into output even if
      // the throw contract above ever regressed to a return.
      let text: string | undefined;
      try {
        text = printExpr(callWith(secretPath)());
      } catch {
        text = undefined;
      }
      expect(text ?? "").not.toContain("TOP_SECRET_CONTENTS");
    });

    it("still allows legitimate relative paths that stay in-root", () => {
      // Positive control: `.`-laden but in-bounds paths must keep working.
      const node = ts.factory.createStringLiteral("./sub/../hello.txt");
      const callExpr = ts.factory.createCallExpression(
        ts.factory.createIdentifier("includeStr"),
        undefined,
        [node]
      );
      const result = includeStrMacro.expand(ctx, callExpr, [node]);
      expect(ts.isStringLiteral(result)).toBe(true);
      expect((result as ts.StringLiteral).text).toBe("Hello, World!");
    });

    it("applies the same boundary to includeBytes and includeJson", () => {
      const node = ts.factory.createStringLiteral("/etc/passwd");
      const bytesCall = ts.factory.createCallExpression(
        ts.factory.createIdentifier("includeBytes"),
        undefined,
        [node]
      );
      const jsonCall = ts.factory.createCallExpression(
        ts.factory.createIdentifier("includeJson"),
        undefined,
        [node]
      );
      expect(() => includeBytesMacro.expand(ctx, bytesCall, [node])).toThrow(
        /Security: absolute paths/
      );
      expect(() => includeJsonMacro.expand(ctx, jsonCall, [node])).toThrow(
        /Security: absolute paths/
      );
    });
  });
});
