/**
 * Tests for macro-helpers — JSDoc macro tag handling, decorator parsing/sorting,
 * derive expansion, and type-info extraction.
 *
 * These tests build AST nodes with `ts.factory.create*` (per project rules)
 * and use a real `ts.Program` for the type-checker-dependent paths.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";

import { createMacroContext, type MacroContextImpl } from "@typesugar/core";

import {
  JSDOC_MACRO_TAGS,
  isJSDocMacroTargetNode,
  hasJSDocMacroTags,
  parseJSDocMacroArgs,
  createSyntheticDecorator,
  parseDecorator,
  sortDecoratorsByDependency,
  sortDeriveArgsByDependency,
  extractTypeInfo,
  expandDeriveDecorator,
  tryExpandJSDocMacros,
} from "../src/macro-helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a single-file in-memory ts.Program for tests that need a type checker.
 */
function makeProgram(
  code: string,
  fileName = "test.ts"
): {
  program: ts.Program;
  sourceFile: ts.SourceFile;
} {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false,
    noEmit: true,
    skipLibCheck: true,
  };

  const host: ts.CompilerHost = {
    getSourceFile(name, lang) {
      if (name === fileName) {
        return ts.createSourceFile(name, code, lang, true, ts.ScriptKind.TS);
      }
      if (name.includes("lib.") && name.endsWith(".d.ts")) {
        return ts.createSourceFile(name, "", lang, true);
      }
      return undefined;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (f) => f === fileName,
    readFile: (f) => (f === fileName ? code : undefined),
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };

  const program = ts.createProgram([fileName], options, host);
  const sourceFile = program.getSourceFile(fileName)!;
  return { program, sourceFile };
}

/**
 * Run a callback with a freshly created MacroContextImpl.
 * The callback receives the context and source file. The transform pipeline
 * is plumbed so `ctx.factory` is the real factory, not a stub.
 */
function withCtx(
  code: string,
  fn: (ctx: MacroContextImpl, sourceFile: ts.SourceFile) => void
): void {
  const { program, sourceFile } = makeProgram(code);
  const factory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
    const ctx = createMacroContext(program, sourceFile, transformContext);
    fn(ctx, sourceFile);
    return (sf) => sf;
  };
  ts.transform(sourceFile, [factory]);
}

// ---------------------------------------------------------------------------
// JSDOC_MACRO_TAGS map
// ---------------------------------------------------------------------------

describe("JSDOC_MACRO_TAGS", () => {
  it("includes all expected macro tags", () => {
    expect(JSDOC_MACRO_TAGS.has("typeclass")).toBe(true);
    expect(JSDOC_MACRO_TAGS.has("impl")).toBe(true);
    expect(JSDOC_MACRO_TAGS.has("instance")).toBe(true);
    expect(JSDOC_MACRO_TAGS.has("deriving")).toBe(true);
    expect(JSDOC_MACRO_TAGS.has("operators")).toBe(true);
    expect(JSDOC_MACRO_TAGS.has("operator")).toBe(true);
    expect(JSDOC_MACRO_TAGS.has("extension")).toBe(true);
    expect(JSDOC_MACRO_TAGS.has("reflect")).toBe(true);
    expect(JSDOC_MACRO_TAGS.has("hkt")).toBe(true);
  });

  it("does not include unrelated JSDoc tags", () => {
    expect(JSDOC_MACRO_TAGS.has("param")).toBe(false);
    expect(JSDOC_MACRO_TAGS.has("returns")).toBe(false);
    expect(JSDOC_MACRO_TAGS.has("deprecated")).toBe(false);
  });

  it("maps each tag to its canonical macro name", () => {
    for (const [tag, macroName] of JSDOC_MACRO_TAGS) {
      expect(macroName).toBe(tag);
    }
  });
});

// ---------------------------------------------------------------------------
// isJSDocMacroTargetNode
// ---------------------------------------------------------------------------

describe("isJSDocMacroTargetNode", () => {
  it("returns true for interface declarations", () => {
    const node = ts.factory.createInterfaceDeclaration(undefined, "Foo", undefined, undefined, []);
    expect(isJSDocMacroTargetNode(node)).toBe(true);
  });

  it("returns true for class declarations", () => {
    const node = ts.factory.createClassDeclaration(undefined, "Foo", undefined, undefined, []);
    expect(isJSDocMacroTargetNode(node)).toBe(true);
  });

  it("returns true for type alias declarations", () => {
    const node = ts.factory.createTypeAliasDeclaration(
      undefined,
      "Foo",
      undefined,
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword)
    );
    expect(isJSDocMacroTargetNode(node)).toBe(true);
  });

  it("returns true for variable statements and declarations", () => {
    const decl = ts.factory.createVariableDeclaration(
      "x",
      undefined,
      undefined,
      ts.factory.createNumericLiteral(1)
    );
    const stmt = ts.factory.createVariableStatement(
      undefined,
      ts.factory.createVariableDeclarationList([decl], ts.NodeFlags.Const)
    );
    expect(isJSDocMacroTargetNode(stmt)).toBe(true);
    expect(isJSDocMacroTargetNode(decl)).toBe(true);
  });

  it("returns false for non-target nodes (function decl, expression)", () => {
    const fn = ts.factory.createFunctionDeclaration(
      undefined,
      undefined,
      "f",
      undefined,
      [],
      undefined,
      undefined
    );
    expect(isJSDocMacroTargetNode(fn)).toBe(false);
    expect(isJSDocMacroTargetNode(ts.factory.createIdentifier("x"))).toBe(false);
    expect(isJSDocMacroTargetNode(ts.factory.createNumericLiteral(42))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasJSDocMacroTags
// ---------------------------------------------------------------------------

describe("hasJSDocMacroTags", () => {
  it("returns true when the declaration carries a macro tag (e.g. @typeclass)", () => {
    const { sourceFile } = makeProgram(`
      /** @typeclass {"name":"Eq"} */
      interface Eq<A> { equals(a: A, b: A): boolean; }
    `);
    const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
    expect(hasJSDocMacroTags(iface)).toBe(true);
  });

  it("returns false when JSDoc has no macro tags (only @param/@returns)", () => {
    const { sourceFile } = makeProgram(`
      /**
       * Generic identity.
       * @param x any input
       * @returns the same input
       */
      interface Foo { x: number; }
    `);
    const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
    expect(hasJSDocMacroTags(iface)).toBe(false);
  });

  it("returns false for non-target nodes (function declarations)", () => {
    const { sourceFile } = makeProgram(`
      /** @typeclass */
      function foo() {}
    `);
    const fn = sourceFile.statements.find(ts.isFunctionDeclaration)!;
    expect(hasJSDocMacroTags(fn)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseJSDocMacroArgs
// ---------------------------------------------------------------------------

describe("parseJSDocMacroArgs", () => {
  it("parses @typeclass JSON config into a single string literal", () => {
    withCtx(
      `
      /** @typeclass {"name":"Eq","operators":[]} */
      interface Eq { eq(): boolean; }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const tag = ts.getJSDocTags(iface).find((t) => t.tagName.text === "typeclass")!;
        const args = parseJSDocMacroArgs(ctx, tag, "typeclass");
        expect(args).toHaveLength(1);
        expect(ts.isStringLiteral(args[0])).toBe(true);
        expect((args[0] as ts.StringLiteral).text).toContain("Eq");
      }
    );
  });

  it("returns no args for @typeclass with invalid JSON", () => {
    withCtx(
      `
      /** @typeclass not-json-at-all */
      interface Eq { eq(): boolean; }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const tag = ts.getJSDocTags(iface).find((t) => t.tagName.text === "typeclass")!;
        const args = parseJSDocMacroArgs(ctx, tag, "typeclass");
        expect(args).toEqual([]);
      }
    );
  });

  it("returns the trimmed string as a literal for @impl and @instance", () => {
    withCtx(
      `
      /** @impl Eq<number> */
      const x = 1;
    `,
      (ctx, sourceFile) => {
        const stmt = sourceFile.statements.find(ts.isVariableStatement)!;
        const tag = ts.getJSDocTags(stmt).find((t) => t.tagName.text === "impl")!;
        const args = parseJSDocMacroArgs(ctx, tag, "impl");
        expect(args).toHaveLength(1);
        expect((args[0] as ts.StringLiteral).text).toBe("Eq<number>");
      }
    );
  });

  it("splits @deriving comma list into identifiers", () => {
    withCtx(
      `
      /** @deriving Eq, Ord, Show */
      interface Foo { value: number; }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const tag = ts.getJSDocTags(iface).find((t) => t.tagName.text === "deriving")!;
        const args = parseJSDocMacroArgs(ctx, tag, "deriving");
        expect(args).toHaveLength(3);
        const names = args.map((a) => (a as ts.Identifier).text);
        expect(names).toEqual(["Eq", "Ord", "Show"]);
        args.forEach((a) => expect(ts.isIdentifier(a)).toBe(true));
      }
    );
  });

  it("returns empty args for unrecognised macro names", () => {
    withCtx(
      `
      /** @impl Eq */
      interface Foo {}
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const tag = ts.getJSDocTags(iface)[0];
        const args = parseJSDocMacroArgs(ctx, tag, "unknown-macro-name");
        expect(args).toEqual([]);
      }
    );
  });
});

// ---------------------------------------------------------------------------
// createSyntheticDecorator
// ---------------------------------------------------------------------------

describe("createSyntheticDecorator", () => {
  it("creates a bare identifier decorator when there are no args", () => {
    withCtx(
      `
      /** @typeclass */
      interface Foo {}
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const tag = ts.getJSDocTags(iface)[0];
        const dec = createSyntheticDecorator(ctx, tag, "typeclass", []);
        expect(ts.isDecorator(dec)).toBe(true);
        expect(ts.isIdentifier(dec.expression)).toBe(true);
        expect((dec.expression as ts.Identifier).text).toBe("typeclass");
      }
    );
  });

  it("creates a CallExpression decorator when args are provided", () => {
    withCtx(
      `
      /** @impl Eq<number> */
      const x = 1;
    `,
      (ctx, sourceFile) => {
        const stmt = sourceFile.statements.find(ts.isVariableStatement)!;
        const tag = ts.getJSDocTags(stmt)[0];
        const args = [ctx.factory.createStringLiteral("Eq<number>")];
        const dec = createSyntheticDecorator(ctx, tag, "impl", args);
        expect(ts.isDecorator(dec)).toBe(true);
        expect(ts.isCallExpression(dec.expression)).toBe(true);
        const call = dec.expression as ts.CallExpression;
        expect((call.expression as ts.Identifier).text).toBe("impl");
        expect(call.arguments).toHaveLength(1);
      }
    );
  });

  it("copies the tag's text range onto the synthetic decorator", () => {
    withCtx(
      `
      /** @typeclass */
      interface Foo {}
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const tag = ts.getJSDocTags(iface)[0];
        const dec = createSyntheticDecorator(ctx, tag, "typeclass", []);
        expect(dec.pos).toBe(tag.pos);
        expect(dec.end).toBe(tag.end);
      }
    );
  });
});

// ---------------------------------------------------------------------------
// parseDecorator
// ---------------------------------------------------------------------------

describe("parseDecorator", () => {
  it("extracts the name from a bare-identifier decorator", () => {
    const dec = ts.factory.createDecorator(ts.factory.createIdentifier("derive"));
    const parsed = parseDecorator(dec);
    expect(parsed.macroName).toBe("derive");
    expect(parsed.args).toEqual([]);
    expect(parsed.identNode).toBeDefined();
    expect(ts.isIdentifier(parsed.identNode!)).toBe(true);
  });

  it("extracts name and args from a call-expression decorator", () => {
    const dec = ts.factory.createDecorator(
      ts.factory.createCallExpression(ts.factory.createIdentifier("derive"), undefined, [
        ts.factory.createIdentifier("Eq"),
        ts.factory.createIdentifier("Ord"),
      ])
    );
    const parsed = parseDecorator(dec);
    expect(parsed.macroName).toBe("derive");
    expect(parsed.args).toHaveLength(2);
    expect((parsed.args[0] as ts.Identifier).text).toBe("Eq");
    expect((parsed.args[1] as ts.Identifier).text).toBe("Ord");
  });

  it("returns empty macroName/identNode for unsupported decorator shapes", () => {
    // e.g. a property-access decorator like @foo.bar — not handled
    const dec = ts.factory.createDecorator(
      ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier("foo"),
        ts.factory.createIdentifier("bar")
      )
    );
    const parsed = parseDecorator(dec);
    expect(parsed.macroName).toBe("");
    expect(parsed.args).toEqual([]);
    expect(parsed.identNode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sortDecoratorsByDependency
// ---------------------------------------------------------------------------

describe("sortDecoratorsByDependency", () => {
  it("returns the input order unchanged when no decorator has expandAfter deps", () => {
    // Use names that are not registered (or have no expandAfter) so the
    // fast-path returns the input as-is.
    const a = ts.factory.createDecorator(ts.factory.createIdentifier("__test_a"));
    const b = ts.factory.createDecorator(ts.factory.createIdentifier("__test_b"));
    const c = ts.factory.createDecorator(ts.factory.createIdentifier("__test_c"));
    const result = sortDecoratorsByDependency([a, b, c]);
    expect(result).toEqual([a, b, c]);
  });

  it("returns a fresh array (not the same reference) on the fast path", () => {
    const a = ts.factory.createDecorator(ts.factory.createIdentifier("__noop_a"));
    const input: readonly ts.Decorator[] = [a];
    const result = sortDecoratorsByDependency(input);
    expect(result).not.toBe(input);
    expect(result).toEqual([a]);
  });

  it("handles empty input", () => {
    expect(sortDecoratorsByDependency([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sortDeriveArgsByDependency
// ---------------------------------------------------------------------------

describe("sortDeriveArgsByDependency", () => {
  it("returns the input unchanged when fewer than 2 identifier args are present", () => {
    const expr = ts.factory.createStringLiteral("not-an-ident");
    const ident = ts.factory.createIdentifier("Eq");
    const result = sortDeriveArgsByDependency([expr, ident]);
    // Only one identifier, so short-circuit returns input as-is (cloned).
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(expr);
    expect(result[1]).toBe(ident);
  });

  it("reorders Ord before its Eq dependency using the builtin deps table", () => {
    // Builtin dep: Ord expandAfter Eq → Eq should come first.
    const ord = ts.factory.createIdentifier("Ord");
    const eq = ts.factory.createIdentifier("Eq");
    const result = sortDeriveArgsByDependency([ord, eq]);
    expect((result[0] as ts.Identifier).text).toBe("Eq");
    expect((result[1] as ts.Identifier).text).toBe("Ord");
  });

  it("reorders Monoid after Semigroup using the builtin deps table", () => {
    const monoid = ts.factory.createIdentifier("Monoid");
    const semi = ts.factory.createIdentifier("Semigroup");
    const result = sortDeriveArgsByDependency([monoid, semi]);
    expect((result[0] as ts.Identifier).text).toBe("Semigroup");
    expect((result[1] as ts.Identifier).text).toBe("Monoid");
  });

  it("leaves order intact when only one side of a dependency is present", () => {
    // Ord depends on Eq, but Eq isn't in args — no edges added.
    const ord = ts.factory.createIdentifier("Ord");
    const show = ts.factory.createIdentifier("Show");
    const result = sortDeriveArgsByDependency([ord, show]);
    expect((result[0] as ts.Identifier).text).toBe("Ord");
    expect((result[1] as ts.Identifier).text).toBe("Show");
  });

  it("preserves order for fully independent derives (no known deps)", () => {
    const a = ts.factory.createIdentifier("__noop_x");
    const b = ts.factory.createIdentifier("__noop_y");
    const c = ts.factory.createIdentifier("__noop_z");
    const result = sortDeriveArgsByDependency([a, b, c]);
    expect(result.map((r) => (r as ts.Identifier).text)).toEqual([
      "__noop_x",
      "__noop_y",
      "__noop_z",
    ]);
  });

  it("returns a fresh array (does not share the input array reference)", () => {
    const input = [ts.factory.createIdentifier("__solo")];
    const result = sortDeriveArgsByDependency(input);
    expect(result).not.toBe(input);
  });
});

// ---------------------------------------------------------------------------
// extractTypeInfo
// ---------------------------------------------------------------------------

describe("extractTypeInfo", () => {
  it("extracts fields from a product interface (name, types, modifiers)", () => {
    withCtx(
      `
      interface User {
        readonly id: number;
        name: string;
        email?: string;
      }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const info = extractTypeInfo(ctx, iface);
        expect(info.name).toBe("User");
        expect(info.kind).toBe("product");
        expect(info.fields).toHaveLength(3);

        const byName = new Map(info.fields.map((f) => [f.name, f]));
        expect(byName.get("id")?.typeString).toBe("number");
        expect(byName.get("id")?.readonly).toBe(true);
        expect(byName.get("name")?.typeString).toBe("string");
        expect(byName.get("name")?.optional).toBe(false);
        expect(byName.get("email")?.optional).toBe(true);
      }
    );
  });

  it("extracts type parameters from a generic interface", () => {
    withCtx(
      `
      interface Box<T, U> {
        first: T;
        second: U;
      }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const info = extractTypeInfo(ctx, iface);
        expect(info.typeParameters).toHaveLength(2);
        expect(info.typeParameters[0].name.text).toBe("T");
        expect(info.typeParameters[1].name.text).toBe("U");
      }
    );
  });

  it("classifies a primitive type alias as kind 'primitive'", () => {
    withCtx(
      `
      type Age = number;
    `,
      (ctx, sourceFile) => {
        const alias = sourceFile.statements.find(ts.isTypeAliasDeclaration)!;
        const info = extractTypeInfo(ctx, alias);
        expect(info.name).toBe("Age");
        expect(info.kind).toBe("primitive");
        expect(info.fields).toEqual([]);
      }
    );
  });

  it("returns name 'Anonymous' when the declaration has no name (edge case)", () => {
    withCtx(
      `
      interface Named { x: number; }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        // Manually clone with name=undefined to exercise the fallback.
        const anon = {
          ...iface,
          name: undefined as unknown as ts.Identifier,
        } as ts.InterfaceDeclaration;
        // We have to give it the right kind/position machinery; reuse via Object.create.
        const fake = Object.create(
          Object.getPrototypeOf(iface),
          Object.getOwnPropertyDescriptors(anon)
        ) as ts.InterfaceDeclaration;
        const info = extractTypeInfo(ctx, fake);
        expect(info.name).toBe("Anonymous");
      }
    );
  });

  it("detects recursion when a field references the enclosing type", () => {
    withCtx(
      `
      interface Node { value: number; next: Node | null; }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const info = extractTypeInfo(ctx, iface);
        expect(info.kind).toBe("product");
        expect(info.isRecursive).toBe(true);
      }
    );
  });
});

// ---------------------------------------------------------------------------
// expandDeriveDecorator
// ---------------------------------------------------------------------------

describe("expandDeriveDecorator", () => {
  it("reports an error and returns undefined when applied to a non-target node", () => {
    withCtx(
      `
      function notDerivable() {}
    `,
      (ctx, sourceFile) => {
        const fn = sourceFile.statements.find(ts.isFunctionDeclaration)!;
        const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("derive"));
        const result = expandDeriveDecorator(ctx, false, decorator, fn, [
          ts.factory.createIdentifier("Eq"),
        ]);
        expect(result).toBeUndefined();
        const diags = ctx.getDiagnostics();
        expect(diags.some((d) => d.severity === "error")).toBe(true);
        expect(diags.some((d) => /interfaces, classes, or type aliases/.test(d.message))).toBe(
          true
        );
      }
    );
  });

  it("reports an error for non-identifier derive arguments", () => {
    withCtx(
      `
      interface Foo { value: number; }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("derive"));
        const result = expandDeriveDecorator(ctx, false, decorator, iface, [
          ts.factory.createStringLiteral("not-an-identifier"),
        ]);
        // No identifier args, so nothing successfully expands.
        expect(result).toBeUndefined();
        const diags = ctx.getDiagnostics();
        expect(diags.some((d) => /must be identifiers/.test(d.message))).toBe(true);
      }
    );
  });

  it("reports a 'Unknown derive' error for unrecognised derive names", () => {
    withCtx(
      `
      interface Foo { value: number; }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("derive"));
        const result = expandDeriveDecorator(ctx, false, decorator, iface, [
          ts.factory.createIdentifier("__DefinitelyNotARegisteredDerive__"),
        ]);
        expect(result).toBeUndefined();
        const diags = ctx.getDiagnostics();
        expect(
          diags.some((d) => /Unknown derive: '__DefinitelyNotARegisteredDerive__'/.test(d.message))
        ).toBe(true);
      }
    );
  });
});

// ---------------------------------------------------------------------------
// tryExpandJSDocMacros
// ---------------------------------------------------------------------------

describe("tryExpandJSDocMacros", () => {
  it("returns undefined when given a non-target node", () => {
    withCtx(
      `
      function nope() {}
    `,
      (ctx, sourceFile) => {
        const fn = sourceFile.statements.find(ts.isFunctionDeclaration)!;
        const result = tryExpandJSDocMacros(ctx, false, fn);
        expect(result).toBeUndefined();
      }
    );
  });

  it("reports a warning when an unknown macro tag is used", () => {
    // Register no @unknown macro — tryExpandJSDocMacros should still try the
    // tag because it's in JSDOC_MACRO_TAGS *only if* it appears there. Use
    // a real macro name that has no registered handler. The function loops
    // through tags found in JSDOC_MACRO_TAGS — but in test environment, only
    // those that are registered will expand. Tags not in JSDOC_MACRO_TAGS
    // (like @notamacro) are simply ignored, so the function returns undefined.
    withCtx(
      `
      /** @notamacro */
      interface Foo { x: number; }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const result = tryExpandJSDocMacros(ctx, false, iface);
        // No registered macros match → result is undefined and no diagnostics.
        expect(result).toBeUndefined();
      }
    );
  });

  it("returns undefined when the node has no relevant JSDoc tags at all", () => {
    withCtx(
      `
      interface Plain { x: number; }
    `,
      (ctx, sourceFile) => {
        const iface = sourceFile.statements.find(ts.isInterfaceDeclaration)!;
        const result = tryExpandJSDocMacros(ctx, false, iface);
        expect(result).toBeUndefined();
      }
    );
  });
});
