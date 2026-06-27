/**
 * Tests for hkt.ts — Higher-Kinded Types parsing, detection, and expansion
 *
 * Covers:
 * - parseTypeConstructor: pure string parsing for type-constructor strings
 * - kindParamRegistry: registration/lookup of kind parameters
 * - isKindAnnotation/getKindArity/getKindParamName: predicates on
 *   TypeParameterDeclaration AST nodes (operate on source-text slices)
 * - isKindApplication: predicate on TypeReferenceNode AST nodes
 * - transformHKTDeclaration: F<A> -> $<F, A> rewriting in interfaces/type aliases
 * - hktAttribute.expand:
 *     - Tier 3 (`_` placeholder in RHS) → TypeFunction interface emitting
 *       this["__kind__"] for the marker
 *     - Tier 2 (parameterized type alias / interface) → companion `*F` interface
 *     - Legacy (interface with F<_> kind params)
 *     - Error reporting for malformed inputs
 *
 * Test inputs are built with ts.factory.* and parsed real source via
 * ts.createProgram (CLAUDE.md: prefer AST construction over string codegen).
 *
 * Findings documented:
 * - `isKindAnnotation` / `getKindArity` rely on slicing
 *   `param.getStart()..param.getEnd()` from the underlying source text, but
 *   real TypeScript parses `interface I<F<_>>` as the single param "F" (the
 *   `<_>` is a syntax error not included in the type-param range). To make
 *   these predicates fire we synthesize a TypeParameterDeclaration with a
 *   text range pointing at a custom source string containing "F<_>".
 * - `countUnderscoreMarkers` (used by Tier 3 expansion) recurses with
 *   `ts.forEachChild` + `ts.isTypeNode` filter; this MISSES `_` markers
 *   nested inside TypeLiteral PropertySignatures (PropertySignature is a
 *   TypeElement, not a TypeNode). So `type ObjF = { value: _ }` is not
 *   detected as Tier 3 — it falls through to Tier 2 because it has no
 *   type params, then errors with TS9302. Bug recorded as a `.todo` test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import {
  parseTypeConstructor,
  kindParamRegistry,
  isKindAnnotation,
  getKindArity,
  getKindParamName,
  isKindApplication,
  transformHKTDeclaration,
  hktAttribute,
  type KindParamInfo,
} from "./hkt.js";

// ============================================================================
// Helpers
// ============================================================================

function createSourceFile(content: string, fileName = "test.ts"): ts.SourceFile {
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
}

/**
 * Create a real ts.Program + MacroContext from source. The callback runs
 * inside a ts.transform pass so a real TransformationContext is available.
 */
function withMacroContext<T>(
  source: string,
  fn: (ctx: ReturnType<typeof createMacroContext>, sf: ts.SourceFile) => T
): T {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hkt-test-"));
  const filePath = path.join(tmpDir, "test.ts");
  fs.writeFileSync(filePath, source);

  try {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    };
    const host = ts.createCompilerHost(options);
    const origGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, lv, onError, shouldCreate) => {
      const sf = origGetSourceFile(fileName, lv, onError, shouldCreate);
      if (sf && fileName === filePath) {
        return ts.createSourceFile(fileName, sf.text, lv, true);
      }
      return sf;
    };
    const program = ts.createProgram([filePath], options, host);
    const sourceFile = program.getSourceFile(filePath)!;

    let result!: T;
    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      result = fn(ctx, sourceFile);
      return (sf) => sf;
    };
    ts.transform(sourceFile, [transformerFactory]);
    return result;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Run a callback with `ctx.reportError` intercepted. Restores the original
 * method afterwards. Works on MacroContextImpl (class methods on prototype).
 */
function captureReportError<T>(
  ctx: { reportError: (n: ts.Node, msg: string) => void },
  fn: () => T
): { result: T; errors: string[] } {
  const errors: string[] = [];
  const original = ctx.reportError.bind(ctx);
  ctx.reportError = (_n: ts.Node, msg: string) => {
    errors.push(msg);
  };
  try {
    const result = fn();
    return { result, errors };
  } finally {
    ctx.reportError = original;
  }
}

/** Find the first interface declaration in a source file. */
function findInterface(sf: ts.SourceFile, name?: string): ts.InterfaceDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && (!name || stmt.name.text === name)) return stmt;
  }
  return undefined;
}

/** Find the first type alias declaration in a source file. */
function findTypeAlias(sf: ts.SourceFile, name?: string): ts.TypeAliasDeclaration | undefined {
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && (!name || stmt.name.text === name)) return stmt;
  }
  return undefined;
}

/** Print a node to a string for shape assertions. */
function print(node: ts.Node, sf?: ts.SourceFile): string {
  const printer = ts.createPrinter({ removeComments: true });
  const file = sf ?? ts.createSourceFile("x.ts", "", ts.ScriptTarget.Latest, false);
  return printer.printNode(ts.EmitHint.Unspecified, node, file);
}

/**
 * Synthesize a TypeParameterDeclaration whose `getStart..getEnd` slice over
 * an attached SourceFile produces the given `textSlice`. Used to test
 * `isKindAnnotation` / `getKindArity` which inspect the raw source text in
 * the type-param range — see findings note at the top of this file.
 */
function synthTypeParam(textSlice: string, paramName = "F"): ts.TypeParameterDeclaration {
  const sf = ts.createSourceFile("synth.ts", textSlice, ts.ScriptTarget.Latest, true);
  const tp = ts.factory.createTypeParameterDeclaration(
    undefined,
    ts.factory.createIdentifier(paramName)
  );
  ts.setTextRange(tp, { pos: 0, end: textSlice.length });
  Object.defineProperty(tp, "parent", { value: sf, writable: true, configurable: true });
  return tp;
}

// ============================================================================
// parseTypeConstructor — pure string parser
// ============================================================================

describe("parseTypeConstructor", () => {
  it("returns no fixedArgs for a bare type name", () => {
    expect(parseTypeConstructor("Option")).toEqual({ base: "Option", fixedArgs: [] });
  });

  it("returns base and fixedArgs for one type argument", () => {
    expect(parseTypeConstructor("Either<string>")).toEqual({
      base: "Either",
      fixedArgs: ["string"],
    });
  });

  it("splits multiple top-level type args", () => {
    expect(parseTypeConstructor("Map<string, number>")).toEqual({
      base: "Map",
      fixedArgs: ["string", "number"],
    });
  });

  it("preserves nested generics in fixed args", () => {
    expect(parseTypeConstructor("Map<string, Array<number>>")).toEqual({
      base: "Map",
      fixedArgs: ["string", "Array<number>"],
    });
  });

  it("preserves deeply nested generics", () => {
    expect(parseTypeConstructor("Either<Option<A>, B>")).toEqual({
      base: "Either",
      fixedArgs: ["Option<A>", "B"],
    });
  });

  it("treats a non-generic primitive name as base with no args", () => {
    expect(parseTypeConstructor("number")).toEqual({ base: "number", fixedArgs: [] });
  });

  it("strips whitespace around base name", () => {
    expect(parseTypeConstructor("  Option  ")).toEqual({ base: "Option", fixedArgs: [] });
  });

  it("returns empty fixedArgs when angle brackets are empty", () => {
    expect(parseTypeConstructor("Option<>")).toEqual({ base: "Option", fixedArgs: [] });
  });

  it("treats malformed input with unmatched open bracket as no args", () => {
    expect(parseTypeConstructor("Option<unfinished")).toEqual({
      base: "Option",
      fixedArgs: [],
    });
  });
});

// ============================================================================
// kindParamRegistry
// ============================================================================

describe("kindParamRegistry", () => {
  beforeEach(() => {
    // Clear keys we are about to set so tests are independent without
    // wiping unrelated entries other test files may rely on.
    kindParamRegistry.delete("Foo.F");
    kindParamRegistry.delete("Bar.G");
  });

  it("registers and looks up a kind param by SourceType.ParamName", () => {
    const info: KindParamInfo = { name: "F", arity: 1, sourceType: "Foo" };
    kindParamRegistry.set("Foo.F", info);
    expect(kindParamRegistry.get("Foo.F")).toEqual(info);
  });

  it("returns undefined for unregistered keys", () => {
    expect(kindParamRegistry.get("NonExistent.X")).toBeUndefined();
  });

  it("delete removes an entry", () => {
    kindParamRegistry.set("Bar.G", { name: "G", arity: 2, sourceType: "Bar" });
    expect(kindParamRegistry.has("Bar.G")).toBe(true);
    kindParamRegistry.delete("Bar.G");
    expect(kindParamRegistry.has("Bar.G")).toBe(false);
  });
});

// ============================================================================
// isKindAnnotation / getKindArity / getKindParamName
// ============================================================================

describe("isKindAnnotation", () => {
  it("returns true for a type-param slice containing <_>", () => {
    expect(isKindAnnotation(synthTypeParam("F<_>"))).toBe(true);
  });

  it("returns true for a slice with arity-2 <_, _>", () => {
    expect(isKindAnnotation(synthTypeParam("F<_, _>"))).toBe(true);
  });

  it("returns true for arity-3 <_, _, _>", () => {
    expect(isKindAnnotation(synthTypeParam("F<_, _, _>"))).toBe(true);
  });

  it("returns false for a plain type parameter without <_>", () => {
    const sf = createSourceFile(`interface I<A> {}`);
    const iface = findInterface(sf)!;
    expect(isKindAnnotation(iface.typeParameters![0])).toBe(false);
  });

  it("returns false for a constrained type parameter without underscores", () => {
    const sf = createSourceFile(`interface I<A extends string> {}`);
    const iface = findInterface(sf)!;
    expect(isKindAnnotation(iface.typeParameters![0])).toBe(false);
  });

  it("documents the parse-time limitation: 'interface I<F<_>>' is parsed as just 'F' so <_> never appears in the type-param's source range", () => {
    // This is real TypeScript parsing behavior — <_> is a parse error so the
    // type parameter's getStart()..getEnd() covers only "F". Production
    // detection relies on the preprocessor running before parsing.
    const sf = createSourceFile(`interface I<F<_>> {}`);
    const iface = findInterface(sf)!;
    const tp = iface.typeParameters![0];
    const slice = sf.text.slice(tp.getStart(), tp.getEnd());
    expect(slice).toBe("F");
    expect(isKindAnnotation(tp)).toBe(false);
  });
});

describe("getKindArity", () => {
  it("returns 1 for a slice F<_>", () => {
    expect(getKindArity(synthTypeParam("F<_>"))).toBe(1);
  });

  it("returns 2 for F<_, _>", () => {
    expect(getKindArity(synthTypeParam("F<_, _>"))).toBe(2);
  });

  it("returns 3 for F<_, _, _>", () => {
    expect(getKindArity(synthTypeParam("F<_, _, _>"))).toBe(3);
  });

  it("returns 0 for a plain type parameter without underscores", () => {
    const sf = createSourceFile(`interface I<A> {}`);
    const iface = findInterface(sf)!;
    expect(getKindArity(iface.typeParameters![0])).toBe(0);
  });
});

describe("getKindParamName", () => {
  it("returns the type parameter identifier text", () => {
    expect(getKindParamName(synthTypeParam("F<_>", "F"))).toBe("F");
  });

  it("returns custom param name", () => {
    expect(getKindParamName(synthTypeParam("G<_>", "G"))).toBe("G");
  });
});

// ============================================================================
// isKindApplication
// ============================================================================

describe("isKindApplication", () => {
  const f = ts.factory;

  it("returns true for F<A> when F is a kind param", () => {
    const node = f.createTypeReferenceNode("F", [f.createTypeReferenceNode("A")]);
    expect(isKindApplication(node, new Set(["F"]))).toBe(true);
  });

  it("returns false for F when F has no type arguments", () => {
    const node = f.createTypeReferenceNode("F");
    expect(isKindApplication(node, new Set(["F"]))).toBe(false);
  });

  it("returns false when the type name is not a kind param", () => {
    const node = f.createTypeReferenceNode("G", [f.createTypeReferenceNode("A")]);
    expect(isKindApplication(node, new Set(["F"]))).toBe(false);
  });

  it("returns false for a qualified name (not a bare identifier)", () => {
    const qualifiedName = f.createQualifiedName(f.createIdentifier("ns"), f.createIdentifier("F"));
    const node = f.createTypeReferenceNode(qualifiedName, [f.createTypeReferenceNode("A")]);
    expect(isKindApplication(node, new Set(["F"]))).toBe(false);
  });
});

// ============================================================================
// transformHKTDeclaration — F<A> → $<F, A> rewriting
// ============================================================================

describe("transformHKTDeclaration", () => {
  it("rewrites F<A> to $<F, A> when kind params are synthesized into the interface", () => {
    // Build an interface AST where the F type parameter has a manually-set
    // text range covering "F<_>" so isKindAnnotation returns true. All type
    // parameters must have a `parent` so getSourceFile() works during the
    // detection scan; we attach a synthetic SourceFile to each.
    const synthSF = ts.createSourceFile("synth.ts", `F<_>,A,B`, ts.ScriptTarget.Latest, true);
    const setParent = (n: ts.Node) =>
      Object.defineProperty(n, "parent", { value: synthSF, writable: true, configurable: true });

    const f = ts.factory;
    const tpF = f.createTypeParameterDeclaration(undefined, "F");
    ts.setTextRange(tpF, { pos: 0, end: 4 });
    setParent(tpF);
    const tpA = f.createTypeParameterDeclaration(undefined, "A");
    ts.setTextRange(tpA, { pos: 5, end: 6 });
    setParent(tpA);
    const tpB = f.createTypeParameterDeclaration(undefined, "B");
    ts.setTextRange(tpB, { pos: 7, end: 8 });
    setParent(tpB);

    // interface Functor<F, A, B> { map(fa: F<A>): F<B>; }
    const fa = f.createParameterDeclaration(
      undefined,
      undefined,
      "fa",
      undefined,
      f.createTypeReferenceNode("F", [f.createTypeReferenceNode("A")]),
      undefined
    );
    const mapMethod = f.createMethodSignature(
      undefined,
      "map",
      undefined,
      undefined,
      [fa],
      f.createTypeReferenceNode("F", [f.createTypeReferenceNode("B")])
    );
    const iface = f.createInterfaceDeclaration(undefined, "Functor", [tpF, tpA, tpB], undefined, [
      mapMethod,
    ]);

    withMacroContext(`// placeholder\n`, (ctx) => {
      const out = transformHKTDeclaration(ctx, iface) as ts.InterfaceDeclaration;
      const text = print(out);
      expect(text).toContain("$<F, A>");
      expect(text).toContain("$<F, B>");
    });
  });

  it("is a no-op when the declaration has no type parameters", () => {
    const src = `interface Plain { x: number; }`;
    withMacroContext(src, (ctx, sf) => {
      const iface = findInterface(sf, "Plain")!;
      const out = transformHKTDeclaration(ctx, iface);
      expect(out).toBe(iface);
    });
  });

  it("is a no-op when there are type params but none have kind annotations", () => {
    const src = `interface Box<A> { value: A; }`;
    withMacroContext(src, (ctx, sf) => {
      const iface = findInterface(sf, "Box")!;
      const out = transformHKTDeclaration(ctx, iface);
      // No kind params discovered → returned unchanged.
      expect(out).toBe(iface);
    });
  });

  it("registers a synthesized kind param into kindParamRegistry", () => {
    const synthSF = ts.createSourceFile("synth.ts", `F<_>`, ts.ScriptTarget.Latest, true);
    const f = ts.factory;
    const tpF = f.createTypeParameterDeclaration(undefined, "F");
    ts.setTextRange(tpF, { pos: 0, end: 4 });
    Object.defineProperty(tpF, "parent", { value: synthSF, writable: true, configurable: true });
    const iface = f.createInterfaceDeclaration(undefined, "MyTC", [tpF], undefined, []);

    // Clear any stale entry, then transform and check registry.
    kindParamRegistry.delete("MyTC.F");
    withMacroContext(`// placeholder\n`, (ctx) => {
      transformHKTDeclaration(ctx, iface);
    });
    const info = kindParamRegistry.get("MyTC.F");
    expect(info).toBeDefined();
    expect(info!.name).toBe("F");
    expect(info!.arity).toBe(1);
    expect(info!.sourceType).toBe("MyTC");
    kindParamRegistry.delete("MyTC.F");
  });
});

// ============================================================================
// hktAttribute.expand — Tier 3 (`_` placeholder in RHS)
// ============================================================================

describe("hktAttribute.expand — Tier 3 (`_` placeholder in RHS)", () => {
  it("emits a TypeFunction interface for `type ArrayF = Array<_>`", () => {
    const src = `/** @hkt */ type ArrayF = Array<_>;`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "ArrayF")!;
      const dummyDecorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, dummyDecorator, alias, []);
      const node = Array.isArray(result) ? result[0] : result;
      expect(ts.isInterfaceDeclaration(node)).toBe(true);
      const iface = node as ts.InterfaceDeclaration;
      expect(iface.name.text).toBe("ArrayF");

      // heritage clause: extends TypeFunction
      expect(iface.heritageClauses).toBeDefined();
      expect(iface.heritageClauses!.length).toBe(1);
      expect(iface.heritageClauses![0].token).toBe(ts.SyntaxKind.ExtendsKeyword);
      const heritage = iface.heritageClauses![0].types[0];
      expect((heritage.expression as ts.Identifier).text).toBe("TypeFunction");

      // members: readonly __kind__: unknown, readonly _: Array<this["__kind__"]>
      expect(iface.members.length).toBe(2);
      const text = print(iface, sf);
      expect(text).toContain("readonly __kind__: unknown");
      expect(text).toContain('this["__kind__"]');
      expect(text).toContain("Array<");
    });
  });

  it("preserves the export modifier on the generated interface", () => {
    const src = `/** @hkt */ export type ArrayF = Array<_>;`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "ArrayF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const node = Array.isArray(result) ? result[0] : result;
      const iface = node as ts.InterfaceDeclaration;
      const mods = iface.modifiers ?? [];
      expect(mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
    });
  });

  it("replaces `_` inside a Map<K, _> RHS via AST walk and preserves type params", () => {
    const src = `/** @hkt */ type MapF<K> = Map<K, _>;`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "MapF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const node = Array.isArray(result) ? result[0] : result;
      const iface = node as ts.InterfaceDeclaration;
      const text = print(iface, sf);
      expect(text).toContain("Map<K,");
      expect(text).toContain('this["__kind__"]');
      // K should be preserved as a type parameter on the generated interface.
      expect(iface.typeParameters).toBeDefined();
      expect(iface.typeParameters![0].name.text).toBe("K");
    });
  });

  it("replaces `_` inside a UnionType", () => {
    const src = `/** @hkt */ type OptU = _ | null;`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "OptU")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const text = print(Array.isArray(result) ? result[0] : result, sf);
      expect(text).toContain('this["__kind__"]');
      expect(text).toContain("| null");
    });
  });

  it("replaces `_` inside an IntersectionType", () => {
    const src = `/** @hkt */ type IntF = _ & { tag: "x" };`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "IntF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const text = print(Array.isArray(result) ? result[0] : result, sf);
      expect(text).toContain('this["__kind__"]');
      expect(text).toContain("&");
    });
  });

  it("replaces `_` inside an ArrayType (T[])", () => {
    const src = `/** @hkt */ type ArrLikeF = _[];`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "ArrLikeF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const text = print(Array.isArray(result) ? result[0] : result, sf);
      expect(text).toContain('this["__kind__"][]');
    });
  });

  it("replaces `_` inside a TupleType", () => {
    const src = `/** @hkt */ type PairF = [_, string];`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "PairF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const text = print(Array.isArray(result) ? result[0] : result, sf);
      expect(text).toContain('this["__kind__"]');
      expect(text).toContain("string");
      expect(text).toMatch(/\[/);
    });
  });

  it("replaces `_` inside a ConditionalType (true-branch)", () => {
    const src = `/** @hkt */ type CondF<T> = T extends string ? _ : never;`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "CondF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const text = print(Array.isArray(result) ? result[0] : result, sf);
      expect(text).toContain('this["__kind__"]');
      expect(text).toContain("extends");
    });
  });

  it("replaces `_` inside a ParenthesizedType", () => {
    const src = `/** @hkt */ type ParenF = (_);`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "ParenF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const text = print(Array.isArray(result) ? result[0] : result, sf);
      expect(text).toContain('this["__kind__"]');
    });
  });

  it("replaces `_` inside a MappedType value", () => {
    const src = `/** @hkt */ type MapAllF<T> = { [K in keyof T]: _ };`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "MapAllF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const text = print(Array.isArray(result) ? result[0] : result, sf);
      expect(text).toContain('this["__kind__"]');
      expect(text).toContain("keyof T");
    });
  });

  it("reports TS9304 when multiple `_` markers are present", () => {
    const src = `/** @hkt */ type BadF = [_, _];`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "BadF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const { result, errors } = captureReportError(ctx, () =>
        hktAttribute.expand(ctx, decorator, alias, [])
      );
      expect(errors.length).toBe(1);
      expect(errors[0]).toContain("[TS9304]");
      expect(errors[0]).toContain("exactly one");
      expect(errors[0]).toContain("2");
      // On error, the macro returns the original node unchanged.
      expect(result).toBe(alias);
    });
  });

  // Regression: countUnderscoreMarkers used to recurse only into TypeNode
  // children, skipping PropertySignature members of a TypeLiteral (a
  // TypeElement, not a TypeNode). So `type ObjF = { value: _ }` was
  // misclassified as Tier 2 and errored with TS9302. Now it walks the full
  // subtree. (replaceUnderscoreInTypeNode already handled TypeLiteral members.)
  it("replaces `_` inside a TypeLiteral PropertySignature", () => {
    const src = `/** @hkt */ type ObjF = { value: _ };`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "ObjF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const text = print(Array.isArray(result) ? result[0] : result, sf);
      expect(text).toContain('this["__kind__"]');
      expect(text).toContain("value");
    });
  });

  it("replaces `_` nested deep inside a TypeLiteral member", () => {
    const src = `/** @hkt */ type NestedF = { items: _[]; meta: { tag: string } };`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "NestedF")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      const text = print(Array.isArray(result) ? result[0] : result, sf);
      expect(text).toContain('this["__kind__"][]');
    });
  });
});

// ============================================================================
// hktAttribute.expand — Tier 2 (parameterized, no `_`)
// ============================================================================

describe("hktAttribute.expand — Tier 2 (parameterized companion)", () => {
  it("generates `OptionF` companion for `type Option<A> = A | null`", () => {
    const src = `/** @hkt */ type Option<A> = A | null;`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "Option")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []);
      expect(Array.isArray(result)).toBe(true);
      const arr = result as ts.Node[];
      expect(arr.length).toBe(2);
      // First node is the original alias, preserved unchanged.
      expect(arr[0]).toBe(alias);
      // Second node is the companion.
      const companion = arr[1] as ts.InterfaceDeclaration;
      expect(ts.isInterfaceDeclaration(companion)).toBe(true);
      expect(companion.name.text).toBe("OptionF");
      // No remaining fixed params because Option has only one type param.
      expect(companion.typeParameters).toBeUndefined();
      const text = print(companion, sf);
      expect(text).toContain("extends TypeFunction");
      expect(text).toContain("readonly __kind__: unknown");
      expect(text).toContain('Option<this["__kind__"]>');
    });
  });

  it("generates `EitherF<E>` companion for `type Either<E, A> = ...`", () => {
    const src = `/** @hkt */ type Either<E, A> = { tag: "left"; e: E } | { tag: "right"; a: A };`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "Either")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []) as ts.Node[];
      const companion = result[1] as ts.InterfaceDeclaration;
      expect(companion.name.text).toBe("EitherF");
      expect(companion.typeParameters).toBeDefined();
      expect(companion.typeParameters!.length).toBe(1);
      expect(companion.typeParameters![0].name.text).toBe("E");
      const text = print(companion, sf);
      expect(text).toContain('Either<E, this["__kind__"]>');
    });
  });

  it("generates companion for an interface with type parameters", () => {
    const src = `/** @hkt */ interface NonEmptyList<A> { head: A; tail: A[]; }`;
    withMacroContext(src, (ctx, sf) => {
      const iface = findInterface(sf, "NonEmptyList")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, iface, []) as ts.Node[];
      expect(result.length).toBe(2);
      const companion = result[1] as ts.InterfaceDeclaration;
      expect(companion.name.text).toBe("NonEmptyListF");
      const text = print(companion, sf);
      expect(text).toContain('NonEmptyList<this["__kind__"]>');
    });
  });

  it("preserves the export modifier on the generated companion", () => {
    const src = `/** @hkt */ export type Box<A> = { value: A };`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "Box")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const result = hktAttribute.expand(ctx, decorator, alias, []) as ts.Node[];
      const companion = result[1] as ts.InterfaceDeclaration;
      const mods = companion.modifiers ?? [];
      expect(mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).toBe(true);
    });
  });
});

// ============================================================================
// hktAttribute.expand — error cases
// ============================================================================

describe("hktAttribute.expand — error cases", () => {
  it("reports TS9302 for a type alias with no type params and no `_`", () => {
    const src = `/** @hkt */ type Plain = number;`;
    withMacroContext(src, (ctx, sf) => {
      const alias = findTypeAlias(sf, "Plain")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const { result, errors } = captureReportError(ctx, () =>
        hktAttribute.expand(ctx, decorator, alias, [])
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("[TS9302]");
      expect(errors[0]).toContain("`_` placeholder");
      expect(result).toBe(alias);
    });
  });

  it("reports TS9302 for an interface with no type params", () => {
    const src = `/** @hkt */ interface Empty { x: number; }`;
    withMacroContext(src, (ctx, sf) => {
      const iface = findInterface(sf, "Empty")!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const { result, errors } = captureReportError(ctx, () =>
        hktAttribute.expand(ctx, decorator, iface, [])
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("[TS9302]");
      expect(errors[0]).toContain("F<_>");
      expect(result).toBe(iface);
    });
  });

  it("reports an error when applied to a non-interface/type-alias node", () => {
    const src = `function foo() {}`;
    withMacroContext(src, (ctx, sf) => {
      const fn = sf.statements.find(ts.isFunctionDeclaration)!;
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("hkt"));
      const { result, errors } = captureReportError(ctx, () =>
        hktAttribute.expand(ctx, decorator, fn, [])
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("can only be applied to interfaces or type aliases");
      expect(result).toBe(fn);
    });
  });
});
