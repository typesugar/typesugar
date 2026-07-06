/**
 * Macro-expansion tests for `@derive(Read)` / `@derive(Write)` in
 * ../src/derive-typeclasses.ts.
 *
 * These invoke the derive macros' `expand()` directly against a real
 * ts.Program (so the type checker resolves field types genuinely, rather
 * than being hand-rolled), and assert on the generated AST shape.
 *
 * This exercises the AST-purity migration (PEP-057): `getGetInstanceForType`/
 * `getPutInstanceForType` now return `ts.Expression` directly instead of
 * building `Get.foo(...)`-shaped strings that were re-parsed via
 * `ctx.parseExpression`.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, type DeriveTypeInfo, type DeriveFieldInfo } from "@typesugar/core";
import { deriveReadMacro, deriveWriteMacro } from "../src/derive-typeclasses.js";

// ---------------------------------------------------------------------------
// Helpers (same shape as packages/macros/src/custom-derive.test.ts)
// ---------------------------------------------------------------------------

function createProgramFromSource(source: string): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "derive-typeclasses-test-"));
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

/**
 * Build a DeriveTypeInfo by extracting real field types from a ts.Program,
 * mirroring the production extractor (transformer-core's extractTypeInfo)
 * closely enough for these derive macros (which only read `.type`,
 * `.name`, `.symbol`, and `.kind === "product"`).
 */
function buildTypeInfoFromSource(
  source: string,
  pickTypeName: string
): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  target: ts.InterfaceDeclaration;
  typeInfo: DeriveTypeInfo;
  cleanup: () => void;
} {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);
  const checker = program.getTypeChecker();

  let target: ts.InterfaceDeclaration | undefined;
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === pickTypeName) {
      target = stmt;
      break;
    }
  }
  if (!target) {
    cleanup();
    throw new Error(`Type ${pickTypeName} not found`);
  }

  const type = checker.getTypeAtLocation(target);
  const fields: DeriveFieldInfo[] = [];
  for (const prop of checker.getPropertiesOfType(type)) {
    const decl = prop.getDeclarations()?.[0];
    if (!decl) continue;
    const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
    const readonly =
      ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)
        ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
        : false;
    fields.push({
      name: prop.name,
      typeString: checker.typeToString(propType),
      type: propType,
      optional,
      readonly,
      symbol: prop,
    });
  }

  const typeInfo: DeriveTypeInfo = {
    name: target.name.text,
    fields,
    typeParameters: target.typeParameters ? Array.from(target.typeParameters) : [],
    type,
    kind: "product",
  };

  return { program, sourceFile, target, typeInfo, cleanup };
}

/** Run a derive macro's `expand` against a real type from source. */
function runDerive(
  derive: typeof deriveReadMacro | typeof deriveWriteMacro,
  source: string,
  pickTypeName: string
): {
  statements: ts.Statement[];
  printed: string[];
} {
  const { program, sourceFile, target, typeInfo, cleanup } = buildTypeInfoFromSource(
    source,
    pickTypeName
  );
  try {
    let stmts: ts.Statement[] = [];
    const printed: string[] = [];

    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      stmts = derive.expand(ctx, target, typeInfo);
      const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
      for (const s of stmts) {
        printed.push(printer.printNode(ts.EmitHint.Unspecified, s, sourceFile));
      }
      return (sf) => sf;
    };

    ts.transform(sourceFile, [transformerFactory]);
    return { statements: stmts, printed };
  } finally {
    cleanup();
  }
}

const PERSON_SOURCE = `
interface Person {
  id: number;
  name: string;
  createdAt: Date;
  nickname: string | null;
}
`;

// ===========================================================================
// @derive(Read)
// ===========================================================================

describe("deriveReadMacro.expand", () => {
  it("generates a Read.make(...) call with a Get expression per field", () => {
    const { printed } = runDerive(deriveReadMacro, PERSON_SOURCE, "Person");
    expect(printed.length).toBeGreaterThan(0);
    const [readInstance] = printed;
    expect(readInstance).toContain("Read.make(");
    expect(readInstance).toContain("get: Get.number");
    expect(readInstance).toContain("get: Get.string");
    expect(readInstance).toContain("get: Get.date");
  });

  it("generates Get.nullable(Get.string) for a `T | null` field, as a real AST call", () => {
    const { statements } = runDerive(deriveReadMacro, PERSON_SOURCE, "Person");
    const readInstance = statements[0] as ts.VariableStatement;
    const decl = readInstance.declarationList.declarations[0];
    const call = decl.initializer as ts.CallExpression; // Read.make(mappingsArray, ctor)
    const mappingsArray = call.arguments[0] as ts.ArrayLiteralExpression;

    const nicknameEntry = mappingsArray.elements.find((el) => {
      const obj = el as ts.ObjectLiteralExpression;
      const fieldProp = obj.properties.find(
        (p) =>
          ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === "field"
      ) as ts.PropertyAssignment | undefined;
      return (
        fieldProp !== undefined &&
        ts.isStringLiteral(fieldProp.initializer) &&
        fieldProp.initializer.text === "nickname"
      );
    }) as ts.ObjectLiteralExpression;
    expect(nicknameEntry).toBeDefined();

    const getProp = nicknameEntry.properties.find(
      (p) =>
        ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === "get"
    ) as ts.PropertyAssignment;
    const getExpr = getProp.initializer;

    // Must be a genuine CallExpression AST node (Get.nullable(Get.string)),
    // not a re-parsed synthetic tree from a printed string.
    expect(ts.isCallExpression(getExpr)).toBe(true);
    const callExpr = getExpr as ts.CallExpression;
    expect(ts.isPropertyAccessExpression(callExpr.expression)).toBe(true);
    const callee = callExpr.expression as ts.PropertyAccessExpression;
    expect(ts.isIdentifier(callee.expression) && callee.expression.text).toBe("Get");
    expect(callee.name.text).toBe("nullable");
    expect(callExpr.arguments.length).toBe(1);
    expect(ts.isPropertyAccessExpression(callExpr.arguments[0])).toBe(true);

    const nullableProp = nicknameEntry.properties.find(
      (p) =>
        ts.isPropertyAssignment(p) &&
        p.name &&
        ts.isIdentifier(p.name) &&
        p.name.text === "nullable"
    ) as ts.PropertyAssignment;
    expect(nullableProp.initializer.kind).toBe(ts.SyntaxKind.TrueKeyword);
  });

  it("reports an error and returns [] for an unsupported field type", () => {
    const src = `interface Bad { fn: () => void; }`;
    const { statements } = runDerive(deriveReadMacro, src, "Bad");
    expect(statements).toEqual([]);
  });
});

// ===========================================================================
// @derive(Write)
// ===========================================================================

describe("deriveWriteMacro.expand", () => {
  it("generates a Write.make(...) call with a Put expression extractor per field", () => {
    const { printed } = runDerive(deriveWriteMacro, PERSON_SOURCE, "Person");
    expect(printed.length).toBeGreaterThan(0);
    const [writeInstance] = printed;
    expect(writeInstance).toContain("Write.make(");
    expect(writeInstance).toContain("Put.number.put(value.id)");
    expect(writeInstance).toContain("Put.string.put(value.name)");
    expect(writeInstance).toContain("Put.date.put(value.createdAt)");
    expect(writeInstance).toContain("Put.nullable(Put.string).put(value.nickname)");
  });

  it("builds Put.nullable(Put.string).put(value.nickname) as a real AST call chain", () => {
    const { statements } = runDerive(deriveWriteMacro, PERSON_SOURCE, "Person");
    const writeInstance = statements[0] as ts.VariableStatement;
    const decl = writeInstance.declarationList.declarations[0];
    const call = decl.initializer as ts.CallExpression; // Write.make(columns, extractors)
    const extractorsArray = call.arguments[1] as ts.ArrayLiteralExpression;

    // Fields in declared order: id, name, createdAt, nickname.
    const nicknameExtractor = extractorsArray.elements[3] as ts.ArrowFunction;
    const body = nicknameExtractor.body as ts.CallExpression; // <put-expr>.put(value.nickname)

    expect(ts.isCallExpression(body)).toBe(true);
    expect(ts.isPropertyAccessExpression(body.expression)).toBe(true);
    const putMethodAccess = body.expression as ts.PropertyAccessExpression;
    expect(putMethodAccess.name.text).toBe("put");

    // The receiver must be a genuine CallExpression node (Put.nullable(Put.string)),
    // not text re-parsed from a template string.
    const putInstanceExpr = putMethodAccess.expression;
    expect(ts.isCallExpression(putInstanceExpr)).toBe(true);
    const putCall = putInstanceExpr as ts.CallExpression;
    const putCallee = putCall.expression as ts.PropertyAccessExpression;
    expect(ts.isIdentifier(putCallee.expression) && putCallee.expression.text).toBe("Put");
    expect(putCallee.name.text).toBe("nullable");
    expect(putCall.arguments.length).toBe(1);
    expect(ts.isPropertyAccessExpression(putCall.arguments[0])).toBe(true);
  });

  it("reports an error and returns [] for an unsupported field type", () => {
    const src = `interface Bad { fn: () => void; }`;
    const { statements } = runDerive(deriveWriteMacro, src, "Bad");
    expect(statements).toEqual([]);
  });
});
