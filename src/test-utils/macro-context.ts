/**
 * Test utilities for creating MacroContext instances
 */

import * as ts from "typescript";
import type { MacroContext, ComptimeValue } from "../core/types.js";

/** Test context with additional test-specific properties */
export interface TestMacroContext extends MacroContext {
  /** Collected errors during expansion */
  errors: string[];

  /** Collected warnings during expansion */
  warnings: string[];
}

/**
 * Create a test MacroContext from source code string
 */
export function createMacroTestContext(source: string): TestMacroContext {
  const sourceFile = parseSource(source);
  const program = createTestProgram(sourceFile);
  const typeChecker = program.getTypeChecker();

  const errors: string[] = [];
  const warnings: string[] = [];

  let uniqueIdCounter = 0;

  const ctx: TestMacroContext = {
    program,
    typeChecker,
    sourceFile,
    factory: ts.factory,
    transformContext: createTestTransformContext(),
    errors,
    warnings,

    // Node creation utilities
    createIdentifier(name: string): ts.Identifier {
      return ts.factory.createIdentifier(name);
    },

    createNumericLiteral(value: number): ts.NumericLiteral {
      return ts.factory.createNumericLiteral(value);
    },

    createStringLiteral(value: string): ts.StringLiteral {
      return ts.factory.createStringLiteral(value);
    },

    createBooleanLiteral(value: boolean): ts.Expression {
      return value ? ts.factory.createTrue() : ts.factory.createFalse();
    },

    createArrayLiteral(elements: ts.Expression[]): ts.ArrayLiteralExpression {
      return ts.factory.createArrayLiteralExpression(elements);
    },

    createObjectLiteral(
      properties: Array<{ name: string; value: ts.Expression }>
    ): ts.ObjectLiteralExpression {
      return ts.factory.createObjectLiteralExpression(
        properties.map((p) => ts.factory.createPropertyAssignment(p.name, p.value))
      );
    },

    parseExpression(code: string): ts.Expression {
      const tempSource = ts.createSourceFile(
        "temp.ts",
        `const __expr = ${code};`,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      const varStmt = tempSource.statements[0] as ts.VariableStatement;
      const decl = varStmt.declarationList.declarations[0];
      return decl.initializer!;
    },

    parseStatements(code: string): ts.Statement[] {
      const tempSource = ts.createSourceFile(
        "temp.ts",
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      );
      return [...tempSource.statements];
    },

    // Type utilities
    getTypeOf(node: ts.Node): ts.Type {
      return typeChecker.getTypeAtLocation(node);
    },

    getTypeString(node: ts.Node): string {
      const type = typeChecker.getTypeAtLocation(node);
      return typeChecker.typeToString(type);
    },

    isAssignableTo(source: ts.Type, target: ts.Type): boolean {
      return typeChecker.isTypeAssignableTo(source, target);
    },

    getPropertiesOfType(type: ts.Type): ts.Symbol[] {
      return typeChecker.getPropertiesOfType(type);
    },

    getSymbol(node: ts.Node): ts.Symbol | undefined {
      return typeChecker.getSymbolAtLocation(node);
    },

    // Diagnostics
    reportError(node: ts.Node, message: string): void {
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      errors.push(`Error at ${pos.line + 1}:${pos.character + 1}: ${message}`);
    },

    reportWarning(node: ts.Node, message: string): void {
      const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      warnings.push(`Warning at ${pos.line + 1}:${pos.character + 1}: ${message}`);
    },

    // Compile-time evaluation
    evaluate(node: ts.Node): ComptimeValue {
      if (ts.isNumericLiteral(node)) {
        return { kind: "number", value: parseFloat(node.text) };
      }
      if (ts.isStringLiteral(node)) {
        return { kind: "string", value: node.text };
      }
      if (node.kind === ts.SyntaxKind.TrueKeyword) {
        return { kind: "boolean", value: true };
      }
      if (node.kind === ts.SyntaxKind.FalseKeyword) {
        return { kind: "boolean", value: false };
      }
      if (node.kind === ts.SyntaxKind.NullKeyword) {
        return { kind: "null" };
      }
      if (ts.isArrayLiteralExpression(node)) {
        const elements = node.elements.map((e) => ctx.evaluate(e));
        return { kind: "array", elements };
      }
      return { kind: "error", message: "Cannot evaluate at compile time" };
    },

    isComptime(node: ts.Node): boolean {
      return (
        ts.isNumericLiteral(node) ||
        ts.isStringLiteral(node) ||
        node.kind === ts.SyntaxKind.TrueKeyword ||
        node.kind === ts.SyntaxKind.FalseKeyword ||
        node.kind === ts.SyntaxKind.NullKeyword ||
        ts.isArrayLiteralExpression(node)
      );
    },

    // Unique name generation
    generateUniqueName(prefix: string): ts.Identifier {
      return ts.factory.createIdentifier(`${prefix}_${uniqueIdCounter++}`);
    },
  };

  return ctx;
}

/**
 * Parse a source code string into a SourceFile
 */
export function parseSource(source: string): ts.SourceFile {
  return ts.createSourceFile("test.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/**
 * Create a minimal test program
 */
function createTestProgram(sourceFile: ts.SourceFile): ts.Program {
  const compilerHost: ts.CompilerHost = {
    getSourceFile: (fileName) => {
      if (fileName === "test.tsx") return sourceFile;
      return undefined;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => fileName === "test.tsx",
    readFile: () => undefined,
    directoryExists: () => true,
    getDirectories: () => [],
  };

  return ts.createProgram({
    rootNames: ["test.tsx"],
    options: {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      strict: true,
    },
    host: compilerHost,
  });
}

/**
 * Create a minimal transformation context for testing
 */
function createTestTransformContext(): ts.TransformationContext {
  // Create a mock transformation context
  return {
    factory: ts.factory,
    getCompilerOptions: () => ({
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
    }),
    hoistFunctionDeclaration: () => {},
    hoistVariableDeclaration: () => {},
    requestEmitHelper: () => {},
    readEmitHelpers: () => undefined,
    enableSubstitution: () => {},
    enableEmitNotification: () => {},
    isSubstitutionEnabled: () => false,
    isEmitNotificationEnabled: () => false,
    onSubstituteNode: (_: ts.EmitHint, node: ts.Node) => node,
    onEmitNode: () => {},
    startLexicalEnvironment: () => {},
    suspendLexicalEnvironment: () => {},
    resumeLexicalEnvironment: () => {},
    endLexicalEnvironment: () => [],
    addDiagnostic: () => {},
    // Additional methods needed by ts.visitEachChild
    setLexicalEnvironmentFlags: () => {},
    getLexicalEnvironmentFlags: () => 0,
  } as unknown as ts.TransformationContext;
}
