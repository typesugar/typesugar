/**
 * Tests for custom-derive.ts — Public API for defining custom derive macros.
 *
 * Covers:
 * - defineCustomDerive: registry side-effect, callback receives populated
 *   ctx + SimpleTypeInfo, returned statements survive expansion, error path
 *   reports a diagnostic instead of throwing.
 * - defineCustomDeriveAst: same, plus the raw DeriveTypeInfo is forwarded.
 * - defineFieldDerive: per-field callback fires N times, in field order;
 *   preamble/postamble bracket the per-field statements; behaves on 0/1/many
 *   fields.
 * - defineTypeFunctionDerive: the framework wraps the callback result in a
 *   real ts.FunctionDeclaration with the correct name, params, return type,
 *   body, and `export` modifier toggle.
 * - toSimpleTypeInfo: indirectly exercised through every entry point —
 *   asserts shape (name, fields, typeParams, fieldCount, fieldNames,
 *   hasField, getField) for product and sum DeriveTypeInfo inputs.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  createMacroContext,
  globalRegistry,
  type DeriveTypeInfo,
  type DeriveFieldInfo,
  type MacroContext,
} from "@typesugar/core";
import {
  defineCustomDerive,
  defineCustomDeriveAst,
  defineFieldDerive,
  defineTypeFunctionDerive,
  type SimpleTypeInfo,
  type SimpleFieldInfo,
} from "./custom-derive.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let counter = 0;
function uniqueName(base: string): string {
  return `${base}_${process.pid}_${Date.now()}_${counter++}`;
}

function createProgramFromSource(source: string): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "custom-derive-test-"));
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
 * Build a (minimally faithful) DeriveTypeInfo by extracting properties from a
 * real ts.Type. This mirrors the production extractor closely enough for the
 * SimpleTypeInfo conversion under test.
 */
function buildTypeInfoFromSource(
  source: string,
  pickTypeName: string
): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration;
  typeInfo: DeriveTypeInfo;
  cleanup: () => void;
} {
  const { program, sourceFile, cleanup } = createProgramFromSource(source);
  const checker = program.getTypeChecker();

  let target: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration | undefined;
  for (const stmt of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt)) &&
      stmt.name?.text === pickTypeName
    ) {
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
    name: target.name!.text,
    fields,
    typeParameters: target.typeParameters ? Array.from(target.typeParameters) : [],
    type,
    kind: "product",
  };

  return { program, sourceFile, target, typeInfo, cleanup };
}

/**
 * Run a derive macro's `expand` against a real type from source. Returns the
 * statements produced plus collected diagnostics and pretty-printed strings.
 */
function runDerive(
  derive: ReturnType<typeof defineCustomDerive>,
  source: string,
  pickTypeName: string,
  typeInfoOverride?: Partial<DeriveTypeInfo>
): {
  statements: ts.Statement[];
  diagnostics: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]>;
  printed: string[];
} {
  const { program, sourceFile, target, typeInfo, cleanup } = buildTypeInfoFromSource(
    source,
    pickTypeName
  );
  try {
    let stmts: ts.Statement[] = [];
    let diags: ReturnType<ReturnType<typeof createMacroContext>["getDiagnostics"]> = [];
    const printed: string[] = [];
    const merged = { ...typeInfo, ...typeInfoOverride };

    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      stmts = derive.expand(ctx, target, merged);
      const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
      for (const s of stmts) {
        printed.push(printer.printNode(ts.EmitHint.Unspecified, s, sourceFile));
      }
      diags = ctx.getDiagnostics();
      return (sf) => sf;
    };

    ts.transform(sourceFile, [transformerFactory]);
    return { statements: stmts, diagnostics: diags, printed };
  } finally {
    cleanup();
  }
}

// ===========================================================================
// defineCustomDerive — registration + invocation
// ===========================================================================

describe("defineCustomDerive — registration", () => {
  it("registers the macro in the global registry under its name", () => {
    const name = uniqueName("RegisteredDerive");
    const macro = defineCustomDerive(name, (ctx) => {
      void ctx;
      return [];
    });
    expect(globalRegistry.getDerive(name)).toBe(macro);
  });

  it("returns a DeriveMacro of kind 'derive'", () => {
    const name = uniqueName("DeriveKindCheck");
    const macro = defineCustomDerive(name, () => []);
    expect(macro.kind).toBe("derive");
    expect(macro.name).toBe(name);
  });

  it("uses a default description containing the derive name", () => {
    const name = uniqueName("DefaultDesc");
    const macro = defineCustomDerive(name, () => []);
    expect(macro.description).toBe(`Custom derive macro: ${name}`);
  });

  it("honors a user-supplied description", () => {
    const name = uniqueName("CustomDesc");
    const macro = defineCustomDerive(name, () => [], { description: "MyDescription" });
    expect(macro.description).toBe("MyDescription");
  });

  it("forwards the module option to the registered macro", () => {
    const name = uniqueName("ModuleOpt");
    const macro = defineCustomDerive(name, () => [], { module: "my-pkg" });
    expect(macro.module).toBe("my-pkg");
  });
});

describe("defineCustomDerive — callback invocation", () => {
  it("passes a populated MacroContext (with factory + reportError)", () => {
    const name = uniqueName("CtxShape");
    let captured: MacroContext | undefined;
    const macro = defineCustomDerive(name, (ctx) => {
      captured = ctx;
      return [];
    });
    runDerive(macro, "interface Point { x: number; }", "Point");
    expect(captured).toBeDefined();
    expect(captured!.factory).toBe(ts.factory);
    expect(typeof captured!.reportError).toBe("function");
  });

  it("converts DeriveTypeInfo to SimpleTypeInfo: name + fieldCount + fieldNames", () => {
    const name = uniqueName("SimpleShape");
    let info: SimpleTypeInfo | undefined;
    const macro = defineCustomDerive(name, (_ctx, i) => {
      info = i;
      return [];
    });
    runDerive(macro, "interface Point { x: number; y: number; }", "Point");
    expect(info).toBeDefined();
    expect(info!.name).toBe("Point");
    expect(info!.fieldCount).toBe(2);
    expect(info!.fieldNames).toEqual(["x", "y"]);
  });

  it("SimpleTypeInfo.fields carries name/type/optional/readonly flags", () => {
    const name = uniqueName("FieldFlags");
    let info: SimpleTypeInfo | undefined;
    const macro = defineCustomDerive(name, (_ctx, i) => {
      info = i;
      return [];
    });
    runDerive(macro, `interface Mixed { readonly id: number; label?: string; }`, "Mixed");
    expect(info).toBeDefined();
    const id = info!.getField("id")!;
    const label = info!.getField("label")!;
    expect(id.type).toBe("number");
    expect(id.readonly).toBe(true);
    expect(id.optional).toBe(false);
    // Optional fields surface in typeToString as `T | undefined`.
    expect(label.type).toBe("string | undefined");
    expect(label.optional).toBe(true);
    expect(label.readonly).toBe(false);
  });

  it("hasField returns true for present fields and false for missing", () => {
    const name = uniqueName("HasField");
    let info: SimpleTypeInfo | undefined;
    const macro = defineCustomDerive(name, (_ctx, i) => {
      info = i;
      return [];
    });
    runDerive(macro, `interface P { a: number; }`, "P");
    expect(info!.hasField("a")).toBe(true);
    expect(info!.hasField("missing")).toBe(false);
  });

  it("getField returns the matching SimpleFieldInfo or undefined", () => {
    const name = uniqueName("GetField");
    let info: SimpleTypeInfo | undefined;
    const macro = defineCustomDerive(name, (_ctx, i) => {
      info = i;
      return [];
    });
    runDerive(macro, `interface P { a: number; }`, "P");
    const a = info!.getField("a");
    expect(a).toBeDefined();
    expect(a!.name).toBe("a");
    expect(info!.getField("absent")).toBeUndefined();
  });

  it("SimpleTypeInfo.typeParams reflects declared type parameter names", () => {
    const name = uniqueName("TypeParams");
    let info: SimpleTypeInfo | undefined;
    const macro = defineCustomDerive(name, (_ctx, i) => {
      info = i;
      return [];
    });
    runDerive(macro, `interface Box<T, U> { value: T; tag: U; }`, "Box");
    expect(info!.typeParams).toEqual(["T", "U"]);
  });

  it("handles a type with zero fields (empty fieldCount + arrays)", () => {
    const name = uniqueName("EmptyFields");
    let info: SimpleTypeInfo | undefined;
    const macro = defineCustomDerive(name, (_ctx, i) => {
      info = i;
      return [];
    });
    runDerive(macro, `interface Empty {}`, "Empty");
    expect(info!.fieldCount).toBe(0);
    expect(info!.fieldNames).toEqual([]);
    expect(info!.fields).toEqual([]);
  });

  it("returned ts.Statement[] is the expansion result verbatim", () => {
    const name = uniqueName("VerbatimReturn");
    const macro = defineCustomDerive(name, (ctx, i) => {
      const f = ctx.factory;
      const decl = f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [
            f.createVariableDeclaration(
              `marker_${i.name}`,
              undefined,
              undefined,
              f.createStringLiteral(i.name)
            ),
          ],
          ts.NodeFlags.Const
        )
      );
      return [decl];
    });
    const { statements, printed, diagnostics } = runDerive(
      macro,
      `interface Thing { v: number; }`,
      "Thing"
    );
    expect(diagnostics).toEqual([]);
    expect(statements.length).toBe(1);
    expect(ts.isVariableStatement(statements[0])).toBe(true);
    expect(printed[0]).toContain("marker_Thing");
    expect(printed[0]).toContain(`"Thing"`);
  });

  it("reports a diagnostic and returns [] when the callback throws", () => {
    const name = uniqueName("ThrowingCallback");
    const macro = defineCustomDerive(name, () => {
      throw new Error("boom in callback");
    });
    const { statements, diagnostics } = runDerive(macro, `interface Bad { x: number; }`, "Bad");
    expect(statements).toEqual([]);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain(`Custom derive '${name}' failed`);
    expect(diagnostics[0].message).toContain("boom in callback");
  });

  it("wraps non-Error throws into the diagnostic message", () => {
    const name = uniqueName("ThrowString");
    const macro = defineCustomDerive(name, () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "literal string";
    });
    const { diagnostics } = runDerive(macro, `interface S { x: number; }`, "S");
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].message).toContain("literal string");
  });
});

// ===========================================================================
// defineCustomDeriveAst — registration + raw info forwarding
// ===========================================================================

describe("defineCustomDeriveAst", () => {
  it("registers the macro in the global registry", () => {
    const name = uniqueName("AstRegistered");
    const macro = defineCustomDeriveAst(name, () => []);
    expect(globalRegistry.getDerive(name)).toBe(macro);
    expect(macro.kind).toBe("derive");
  });

  it("uses the AST-flavored default description", () => {
    const name = uniqueName("AstDesc");
    const macro = defineCustomDeriveAst(name, () => []);
    expect(macro.description).toBe(`Custom derive macro (AST): ${name}`);
  });

  it("passes both SimpleTypeInfo and the original DeriveTypeInfo to the callback", () => {
    const name = uniqueName("AstRawInfo");
    let simple: SimpleTypeInfo | undefined;
    let raw: DeriveTypeInfo | undefined;
    const macro = defineCustomDeriveAst(name, (_ctx, s, r) => {
      simple = s;
      raw = r;
      return [];
    });
    runDerive(macro, `interface AstThing { a: number; b: string; }`, "AstThing");

    // SimpleTypeInfo derived shape
    expect(simple!.name).toBe("AstThing");
    expect(simple!.fieldNames).toEqual(["a", "b"]);

    // Raw info: shape preserved + carries fields with ts.Type values
    expect(raw!.name).toBe("AstThing");
    expect(raw!.kind).toBe("product");
    expect(raw!.fields.length).toBe(2);
    expect(typeof raw!.fields[0].typeString).toBe("string");
    expect(raw!.fields[0].type).toBeDefined();
  });

  it("reports a diagnostic tagged '(AST)' when the callback throws", () => {
    const name = uniqueName("AstThrow");
    const macro = defineCustomDeriveAst(name, () => {
      throw new Error("ast boom");
    });
    const { statements, diagnostics } = runDerive(
      macro,
      `interface AstBad { x: number; }`,
      "AstBad"
    );
    expect(statements).toEqual([]);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].message).toContain(`Custom derive '${name}' (AST) failed`);
    expect(diagnostics[0].message).toContain("ast boom");
  });

  it("passes sum-type DeriveTypeInfo through to the callback unchanged", () => {
    const name = uniqueName("AstSum");
    let raw: DeriveTypeInfo | undefined;
    const macro = defineCustomDeriveAst(name, (_ctx, _s, r) => {
      raw = r;
      return [];
    });

    // Override into sum: SimpleTypeInfo only reads `fields` + `typeParameters`,
    // so the raw forwarding path is what we're checking here.
    runDerive(macro, `interface Anchor { v: number; }`, "Anchor", {
      kind: "sum",
      discriminant: "kind",
      variants: [
        { tag: "a", typeName: "VA", fields: [] },
        { tag: "b", typeName: "VB", fields: [] },
      ],
    });
    expect(raw!.kind).toBe("sum");
    expect(raw!.discriminant).toBe("kind");
    expect(raw!.variants).toHaveLength(2);
  });
});

// ===========================================================================
// defineFieldDerive
// ===========================================================================

describe("defineFieldDerive", () => {
  it("invokes the per-field callback once per field, with the type name", () => {
    const name = uniqueName("PerField");
    const seen: Array<{ typeName: string; field: SimpleFieldInfo }> = [];
    const macro = defineFieldDerive(name, (_ctx, typeName, field) => {
      seen.push({ typeName, field });
      return [];
    });
    runDerive(macro, `interface P { x: number; y: string; z: boolean; }`, "P");
    expect(seen.length).toBe(3);
    expect(seen.map((s) => s.field.name)).toEqual(["x", "y", "z"]);
    expect(seen.every((s) => s.typeName === "P")).toBe(true);
  });

  it("emits no statements (and skips field callback) for a zero-field type", () => {
    const name = uniqueName("ZeroField");
    let calls = 0;
    const macro = defineFieldDerive(name, () => {
      calls++;
      return [ts.factory.createEmptyStatement()];
    });
    const { statements } = runDerive(macro, `interface Empty {}`, "Empty");
    expect(calls).toBe(0);
    expect(statements).toEqual([]);
  });

  it("preamble runs before per-field statements and postamble after", () => {
    const name = uniqueName("PrePost");
    const order: string[] = [];
    const macro = defineFieldDerive(
      name,
      (ctx, _typeName, field) => {
        order.push(`field:${field.name}`);
        return [
          ctx.factory.createExpressionStatement(ctx.factory.createStringLiteral(`f:${field.name}`)),
        ];
      },
      {
        preamble: (ctx, info) => {
          order.push(`pre:${info.name}`);
          return [ctx.factory.createExpressionStatement(ctx.factory.createStringLiteral("PRE"))];
        },
        postamble: (ctx, info) => {
          order.push(`post:${info.name}`);
          return [ctx.factory.createExpressionStatement(ctx.factory.createStringLiteral("POST"))];
        },
      }
    );

    const { statements, printed } = runDerive(macro, `interface Q { a: number; b: number; }`, "Q");

    // 1 preamble + 2 field stmts + 1 postamble.
    expect(statements.length).toBe(4);
    expect(printed[0]).toContain(`"PRE"`);
    expect(printed[1]).toContain(`"f:a"`);
    expect(printed[2]).toContain(`"f:b"`);
    expect(printed[3]).toContain(`"POST"`);

    // Callback execution order is preamble → fields → postamble.
    expect(order).toEqual(["pre:Q", "field:a", "field:b", "post:Q"]);
  });

  it("preamble still runs for a zero-field type even though no field callbacks fire", () => {
    const name = uniqueName("PreOnlyEmpty");
    let preCalls = 0;
    let postCalls = 0;
    let fieldCalls = 0;
    const macro = defineFieldDerive(
      name,
      () => {
        fieldCalls++;
        return [];
      },
      {
        preamble: (ctx) => {
          preCalls++;
          return [ctx.factory.createExpressionStatement(ctx.factory.createStringLiteral("P"))];
        },
        postamble: (ctx) => {
          postCalls++;
          return [ctx.factory.createExpressionStatement(ctx.factory.createStringLiteral("Q"))];
        },
      }
    );
    const { statements } = runDerive(macro, `interface NoFields {}`, "NoFields");
    expect(preCalls).toBe(1);
    expect(postCalls).toBe(1);
    expect(fieldCalls).toBe(0);
    expect(statements.length).toBe(2);
  });

  it("returns multiple statements per field correctly (flattening)", () => {
    const name = uniqueName("FlatMulti");
    const macro = defineFieldDerive(name, (ctx, _typeName, field) => [
      ctx.factory.createExpressionStatement(ctx.factory.createStringLiteral(`A:${field.name}`)),
      ctx.factory.createExpressionStatement(ctx.factory.createStringLiteral(`B:${field.name}`)),
    ]);
    const { statements, printed } = runDerive(macro, `interface R { p: number; q: number; }`, "R");
    expect(statements.length).toBe(4); // 2 fields * 2 stmts each
    expect(printed[0]).toContain(`"A:p"`);
    expect(printed[1]).toContain(`"B:p"`);
    expect(printed[2]).toContain(`"A:q"`);
    expect(printed[3]).toContain(`"B:q"`);
  });

  it("propagates module/description options to the underlying registration", () => {
    const name = uniqueName("FieldOpts");
    const macro = defineFieldDerive(name, () => [], {
      module: "test-mod",
      description: "Field-flavored derive",
    });
    expect(macro.module).toBe("test-mod");
    expect(macro.description).toBe("Field-flavored derive");
    expect(globalRegistry.getDerive(name)).toBe(macro);
  });
});

// ===========================================================================
// defineTypeFunctionDerive
// ===========================================================================

describe("defineTypeFunctionDerive", () => {
  it("wraps the callback shape into a ts.FunctionDeclaration", () => {
    const name = uniqueName("FnShape");
    const macro = defineTypeFunctionDerive(name, (_ctx, info) => ({
      functionName: `check${info.name}`,
      params: [
        { name: "value", type: ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword) },
      ],
      returnType: ts.factory.createTypePredicateNode(
        undefined,
        ts.factory.createIdentifier("value"),
        ts.factory.createTypeReferenceNode(info.name, undefined)
      ),
      body: [ts.factory.createReturnStatement(ts.factory.createTrue())],
    }));

    const { statements, printed, diagnostics } = runDerive(
      macro,
      `interface Shape { v: number; }`,
      "Shape"
    );

    expect(diagnostics).toEqual([]);
    expect(statements.length).toBe(1);
    expect(ts.isFunctionDeclaration(statements[0])).toBe(true);

    const fn = statements[0] as ts.FunctionDeclaration;
    expect(fn.name?.text).toBe("checkShape");
    expect(fn.parameters.length).toBe(1);
    expect(ts.isIdentifier(fn.parameters[0].name)).toBe(true);
    expect((fn.parameters[0].name as ts.Identifier).text).toBe("value");
    expect(fn.parameters[0].type?.kind).toBe(ts.SyntaxKind.UnknownKeyword);

    // Return type is `value is Shape` (TypePredicate).
    expect(fn.type).toBeDefined();
    expect(ts.isTypePredicateNode(fn.type!)).toBe(true);

    // Body is a Block with one ReturnStatement.
    expect(fn.body).toBeDefined();
    expect(fn.body!.statements.length).toBe(1);
    expect(ts.isReturnStatement(fn.body!.statements[0])).toBe(true);
    expect(printed[0]).toContain("function checkShape");
    expect(printed[0]).toContain("value is Shape");
  });

  it("adds an `export` modifier when `exported: true`", () => {
    const name = uniqueName("FnExported");
    const macro = defineTypeFunctionDerive(name, (_ctx, info) => ({
      functionName: `e${info.name}`,
      params: [],
      returnType: ts.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
      body: [],
      exported: true,
    }));
    const { statements, printed } = runDerive(macro, `interface T { v: number; }`, "T");
    const fn = statements[0] as ts.FunctionDeclaration;
    const mods = fn.modifiers ?? [];
    expect(mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
    expect(printed[0].startsWith("export function")).toBe(true);
  });

  it("omits the `export` modifier by default", () => {
    const name = uniqueName("FnNotExported");
    const macro = defineTypeFunctionDerive(name, (_ctx, info) => ({
      functionName: `i${info.name}`,
      params: [],
      returnType: ts.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
      body: [],
    }));
    const { statements, printed } = runDerive(macro, `interface T2 { v: number; }`, "T2");
    const fn = statements[0] as ts.FunctionDeclaration;
    const mods = fn.modifiers ?? [];
    expect(mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).toBe(false);
    expect(printed[0].startsWith("export ")).toBe(false);
  });

  it("emits multiple parameters in declared order with their type nodes", () => {
    const name = uniqueName("FnMultiParams");
    const macro = defineTypeFunctionDerive(name, () => ({
      functionName: "manyArgs",
      params: [
        { name: "a", type: ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword) },
        { name: "b", type: ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword) },
        { name: "c", type: ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword) },
      ],
      returnType: ts.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
      body: [],
    }));
    const { statements } = runDerive(macro, `interface U { v: number; }`, "U");
    const fn = statements[0] as ts.FunctionDeclaration;
    expect(fn.parameters.map((p) => (p.name as ts.Identifier).text)).toEqual(["a", "b", "c"]);
    expect(fn.parameters[0].type?.kind).toBe(ts.SyntaxKind.NumberKeyword);
    expect(fn.parameters[1].type?.kind).toBe(ts.SyntaxKind.StringKeyword);
    expect(fn.parameters[2].type?.kind).toBe(ts.SyntaxKind.BooleanKeyword);
  });

  it("creates a multi-line block body containing all supplied statements", () => {
    const name = uniqueName("FnBody");
    const macro = defineTypeFunctionDerive(name, (ctx) => ({
      functionName: "doStuff",
      params: [],
      returnType: ctx.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
      body: [
        ctx.factory.createExpressionStatement(ctx.factory.createStringLiteral("one")),
        ctx.factory.createExpressionStatement(ctx.factory.createStringLiteral("two")),
        ctx.factory.createReturnStatement(undefined),
      ],
    }));
    const { statements } = runDerive(macro, `interface V { v: number; }`, "V");
    const fn = statements[0] as ts.FunctionDeclaration;
    expect(fn.body).toBeDefined();
    expect(fn.body!.statements.length).toBe(3);
    // multiLine flag — the factory call passes `true` for the block.
    expect((fn.body as ts.Block).multiLine).toBe(true);
  });
});
