/**
 * Tests for PEP-005 Wave 3: Type Confidence Detection
 *
 * Verifies that ctx.isTypeReliable() and ctx.assertTypeReliable() correctly
 * detect unreliable types (implicit any, never, error) and that macro
 * integration sites emit appropriate warnings.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as ts from "typescript";
import { MacroContextImpl, createMacroContext } from "@typesugar/core";

function createCtxForSource(sourceText: string): MacroContextImpl {
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
    noImplicitAny: true,
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

describe("type confidence detection", () => {
  describe("isTypeReliable", () => {
    it("returns false for any type", () => {
      const ctx = createCtxForSource("const x: any = 42;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      expect(ctx.isTypeReliable(type)).toBe(false);
    });

    it("returns true for number type", () => {
      const ctx = createCtxForSource("const x: number = 42;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    it("returns true for string type", () => {
      const ctx = createCtxForSource('const x: string = "hello";');
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    it("returns true for object types", () => {
      const ctx = createCtxForSource("interface Foo { x: number } declare const f: Foo;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[1] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    it("returns true for unknown type (intentional)", () => {
      const ctx = createCtxForSource("const x: unknown = 42;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    it("returns false for never type", () => {
      const ctx = createCtxForSource("const x: never = undefined as never;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      expect(ctx.isTypeReliable(type)).toBe(false);
    });

    it("returns true for boolean type", () => {
      const ctx = createCtxForSource("const x: boolean = true;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    it("returns true for union types", () => {
      const ctx = createCtxForSource("const x: string | number = 42;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      expect(ctx.isTypeReliable(type)).toBe(true);
    });

    it("returns true for array types", () => {
      const ctx = createCtxForSource("const x: number[] = [1, 2, 3];");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.typeChecker.getTypeAtLocation(varDecl);
      expect(ctx.isTypeReliable(type)).toBe(true);
    });
  });

  describe("assertTypeReliable", () => {
    it("returns type for reliable types", () => {
      const ctx = createCtxForSource("const x: number = 42;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.assertTypeReliable(varDecl, "test operation");
      expect(type).not.toBeNull();
      expect(type!.flags & ts.TypeFlags.Number).toBeTruthy();
    });

    it("returns null and emits warning for any type", () => {
      const ctx = createCtxForSource("const x: any = 42;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.assertTypeReliable(varDecl, "derive Eq");
      expect(type).toBeNull();

      const warnings = ctx.getDiagnostics().filter((d) => d.severity === "warning");
      expect(warnings.length).toBe(1);
      expect(warnings[0].message).toContain("typesugar skipped derive Eq");
      expect(warnings[0].message).toContain("could not be resolved");
      expect(warnings[0].message).toContain("Fix upstream type errors first");
    });

    it("returns null and emits warning for never type", () => {
      const ctx = createCtxForSource("const x: never = undefined as never;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const type = ctx.assertTypeReliable(varDecl, "specialize");
      expect(type).toBeNull();

      const warnings = ctx.getDiagnostics().filter((d) => d.severity === "warning");
      expect(warnings.length).toBe(1);
      expect(warnings[0].message).toContain("typesugar skipped specialize");
    });

    it("includes node text in the diagnostic message", () => {
      const ctx = createCtxForSource("const myVariable: any = 42;");
      const sourceFile = ctx.sourceFile;
      const varDecl = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      ctx.assertTypeReliable(varDecl, "operator rewrite");

      const warnings = ctx.getDiagnostics().filter((d) => d.severity === "warning");
      expect(warnings.length).toBe(1);
      expect(warnings[0].message).toContain("myVariable");
    });
  });

  describe("multiple diagnostics", () => {
    it("does not emit warnings for reliable types even when called multiple times", () => {
      const ctx = createCtxForSource("const x: number = 1; const y: string = 'a';");
      const sourceFile = ctx.sourceFile;

      const varDecl1 = (sourceFile.statements[0] as ts.VariableStatement)
        .declarationList.declarations[0];
      const varDecl2 = (sourceFile.statements[1] as ts.VariableStatement)
        .declarationList.declarations[0];

      expect(ctx.assertTypeReliable(varDecl1, "op1")).not.toBeNull();
      expect(ctx.assertTypeReliable(varDecl2, "op2")).not.toBeNull();

      const warnings = ctx.getDiagnostics().filter((d) => d.severity === "warning");
      expect(warnings.length).toBe(0);
    });
  });
});
