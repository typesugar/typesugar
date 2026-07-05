/**
 * Tests for import-resolution.ts — macro import tracking, cleanup,
 * module specifier resolution, and symbol-to-macro lookup.
 *
 * Uses in-memory ts.Program instances built via a custom CompilerHost,
 * combined with a per-test cleared globalRegistry, to exercise the
 * resolution behavior end-to-end without touching the filesystem.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as ts from "typescript";
import {
  globalRegistry,
  defineExpressionMacro,
  defineAttributeMacro,
  defineDeriveMacro,
  defineTypeMacro,
  MacroContextImpl,
} from "@typesugar/core";

import {
  recordMacroImport,
  cleanupMacroImports,
  resolveModuleSpecifier,
  findImportModuleForName,
  moduleMatchesMacro,
  fallbackNameLookup,
  fallbackNameLookupWithImports,
  resolveSymbolToMacro,
  resolveMacroFromSymbol,
  hasExtensionDecorator,
  scanImportsForExtension,
} from "../src/import-resolution.js";

// ---------------------------------------------------------------------------
// In-memory ts.Program builder
// ---------------------------------------------------------------------------

interface BuiltProgram {
  program: ts.Program;
  typeChecker: ts.TypeChecker;
  files: Map<string, ts.SourceFile>;
}

function buildProgram(files: Record<string, string>): BuiltProgram {
  const fileMap = new Map<string, string>();
  for (const [name, content] of Object.entries(files)) {
    fileMap.set(name, content);
  }

  const sourceFileCache = new Map<string, ts.SourceFile>();

  const host: ts.CompilerHost = {
    getSourceFile(fileName, languageVersion) {
      const cached = sourceFileCache.get(fileName);
      if (cached) return cached;
      const text = fileMap.get(fileName);
      if (text === undefined) return undefined;
      const sf = ts.createSourceFile(fileName, text, languageVersion, true);
      sourceFileCache.set(fileName, sf);
      return sf;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {
      /* no-op */
    },
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => fileMap.has(fileName),
    readFile: (fileName) => fileMap.get(fileName),
    directoryExists: () => true,
    getDirectories: () => [],
  };

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    noResolve: false,
    strict: false,
    skipLibCheck: true,
  };

  const rootNames = Array.from(fileMap.keys());
  const program = ts.createProgram({
    rootNames,
    options,
    host,
  });

  const built = new Map<string, ts.SourceFile>();
  for (const name of rootNames) {
    const sf = program.getSourceFile(name);
    if (sf) built.set(name, sf);
  }

  return {
    program,
    typeChecker: program.getTypeChecker(),
    files: built,
  };
}

function getImportDeclaration(sf: ts.SourceFile, moduleSpecifier: string): ts.ImportDeclaration {
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === moduleSpecifier
    ) {
      return stmt;
    }
  }
  throw new Error(`No import from "${moduleSpecifier}" found in ${sf.fileName}`);
}

function getIdentifier(sf: ts.SourceFile, name: string): ts.Identifier {
  let found: ts.Identifier | undefined;
  function visit(node: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) {
      // Skip the binding side of import specifiers — we want a USE site.
      const parent = node.parent;
      if (parent && ts.isImportSpecifier(parent)) return;
      if (parent && ts.isImportClause(parent)) return;
      if (parent && ts.isNamespaceImport(parent)) return;
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!found) throw new Error(`No identifier "${name}" found in ${sf.fileName}`);
  return found;
}

function printStatements(stmts: readonly ts.Statement[], host: ts.SourceFile): string {
  // ts.createPrinter needs to print individual nodes against a host source file
  // so that string literals etc. retain their original text. Printing a
  // synthetic SourceFile loses the original text of unsynthesized leaves.
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return stmts.map((s) => printer.printNode(ts.EmitHint.Unspecified, s, host)).join("\n");
}

// ---------------------------------------------------------------------------
// resolveModuleSpecifier
// ---------------------------------------------------------------------------

describe("resolveModuleSpecifier", () => {
  it("maps a node_modules path under @typesugar/* to the scoped package", () => {
    expect(resolveModuleSpecifier("/proj/node_modules/@typesugar/units/dist/index.d.ts")).toBe(
      "@typesugar/units"
    );
  });

  it("maps a node_modules path under typesugar to 'typesugar'", () => {
    expect(resolveModuleSpecifier("/proj/node_modules/typesugar/dist/index.d.ts")).toBe(
      "typesugar"
    );
  });

  it("maps third-party node_modules paths to their package name", () => {
    expect(resolveModuleSpecifier("/proj/node_modules/lodash/index.js")).toBe("lodash");
  });

  it("maps a packages/<name> path to @typesugar/<name>", () => {
    expect(resolveModuleSpecifier("/repo/packages/units/src/index.ts")).toBe("@typesugar/units");
  });

  it("maps packages/typesugar to 'typesugar' (not @typesugar/typesugar)", () => {
    expect(resolveModuleSpecifier("/repo/packages/typesugar/src/index.ts")).toBe("typesugar");
  });

  it("returns undefined for paths that match neither pattern", () => {
    expect(resolveModuleSpecifier("/some/random/path.ts")).toBeUndefined();
  });

  it("normalizes Windows-style backslashes", () => {
    expect(
      resolveModuleSpecifier("C:\\proj\\node_modules\\@typesugar\\core\\dist\\index.d.ts")
    ).toBe("@typesugar/core");
  });
});

// ---------------------------------------------------------------------------
// moduleMatchesMacro
// ---------------------------------------------------------------------------

describe("moduleMatchesMacro", () => {
  it("returns true for exact matches", () => {
    expect(moduleMatchesMacro("typesugar", "typesugar")).toBe(true);
    expect(moduleMatchesMacro("@typesugar/core", "@typesugar/core")).toBe(true);
  });

  it("treats typesugar as compatible with @typesugar/* subpackages", () => {
    expect(moduleMatchesMacro("typesugar", "@typesugar/units")).toBe(true);
    expect(moduleMatchesMacro("@typesugar/units", "typesugar")).toBe(true);
  });

  it("matches legacy aliases (typemacro, ttfx, macrots)", () => {
    expect(moduleMatchesMacro("typesugar", "typemacro")).toBe(true);
    expect(moduleMatchesMacro("typemacro", "ttfx")).toBe(true);
  });

  it("matches when @typesugar/<pkg> resolves a bare <pkg> name", () => {
    expect(moduleMatchesMacro("@typesugar/units", "units")).toBe(true);
  });

  it("returns false for unrelated modules", () => {
    expect(moduleMatchesMacro("lodash", "typesugar")).toBe(false);
    expect(moduleMatchesMacro("@typesugar/core", "@other/pkg")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findImportModuleForName
// ---------------------------------------------------------------------------

describe("findImportModuleForName", () => {
  it("locates the module specifier for a named import", () => {
    const { files } = buildProgram({
      "/main.ts": `import { Foo, Bar } from "./mod";\nconst x = Foo();\n`,
      "/mod.ts": `export function Foo() {}\nexport function Bar() {}\n`,
    });
    const main = files.get("/main.ts")!;
    expect(findImportModuleForName(main, "Foo")).toBe("./mod");
    expect(findImportModuleForName(main, "Bar")).toBe("./mod");
  });

  it("returns undefined for a name not present in any named import", () => {
    const { files } = buildProgram({
      "/main.ts": `import { Foo } from "./mod";\n`,
      "/mod.ts": `export function Foo() {}\n`,
    });
    expect(findImportModuleForName(files.get("/main.ts")!, "NotThere")).toBeUndefined();
  });

  it("respects the local alias name (not the original)", () => {
    const { files } = buildProgram({
      "/main.ts": `import { Foo as Bar } from "./mod";\n`,
      "/mod.ts": `export function Foo() {}\n`,
    });
    const main = files.get("/main.ts")!;
    // findImportModuleForName looks at element.name (the local name)
    expect(findImportModuleForName(main, "Bar")).toBe("./mod");
    expect(findImportModuleForName(main, "Foo")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fallbackNameLookup / fallbackNameLookupWithImports
// ---------------------------------------------------------------------------

describe("fallbackNameLookup", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  it("finds a module-less macro by name", () => {
    const macro = defineExpressionMacro({
      name: "ir_test_modulefree",
      expand: (_ctx, _call, _args) => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);
    expect(fallbackNameLookup("ir_test_modulefree", "expression")).toBe(macro);
  });

  it("returns undefined for a macro that requires a module", () => {
    globalRegistry.register(
      defineExpressionMacro({
        name: "ir_test_scoped",
        module: "@typesugar/core",
        expand: () => ts.factory.createNumericLiteral(0),
      })
    );
    expect(fallbackNameLookup("ir_test_scoped", "expression")).toBeUndefined();
  });

  it("returns undefined for unknown names", () => {
    expect(fallbackNameLookup("does_not_exist", "expression")).toBeUndefined();
  });

  it("dispatches per kind", () => {
    const expr = defineExpressionMacro({
      name: "ir_kind_expr",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    const attr = defineAttributeMacro({
      name: "ir_kind_attr",
      validTargets: ["class"],
      expand: () => undefined,
    });
    globalRegistry.register(expr);
    globalRegistry.register(attr);
    expect(fallbackNameLookup("ir_kind_expr", "expression")).toBe(expr);
    // Wrong kind should miss
    expect(fallbackNameLookup("ir_kind_expr", "attribute")).toBeUndefined();
    expect(fallbackNameLookup("ir_kind_attr", "attribute")).toBe(attr);
  });
});

describe("fallbackNameLookupWithImports", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  it("returns a module-scoped macro when imported from a matching module", () => {
    const macro = defineExpressionMacro({
      name: "ir_imp_scoped",
      module: "@typesugar/core",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);
    const { files } = buildProgram({
      "/main.ts": `import { ir_imp_scoped } from "@typesugar/core";\nir_imp_scoped();\n`,
    });
    expect(
      fallbackNameLookupWithImports(files.get("/main.ts")!, "ir_imp_scoped", "expression")
    ).toBe(macro);
  });

  it("returns undefined if the macro is module-scoped but not imported", () => {
    globalRegistry.register(
      defineExpressionMacro({
        name: "ir_unimported",
        module: "@typesugar/core",
        expand: () => ts.factory.createNumericLiteral(0),
      })
    );
    const { files } = buildProgram({
      "/main.ts": `const x = 1;\n`,
    });
    expect(
      fallbackNameLookupWithImports(files.get("/main.ts")!, "ir_unimported", "expression")
    ).toBeUndefined();
  });

  it("returns the macro when it has no module requirement", () => {
    const macro = defineExpressionMacro({
      name: "ir_modulefree2",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);
    const { files } = buildProgram({
      "/main.ts": `const x = 1;\n`,
    });
    expect(
      fallbackNameLookupWithImports(files.get("/main.ts")!, "ir_modulefree2", "expression")
    ).toBe(macro);
  });
});

// ---------------------------------------------------------------------------
// recordMacroImport + cleanupMacroImports
// ---------------------------------------------------------------------------

describe("recordMacroImport + cleanupMacroImports", () => {
  it("removes an import declaration when all named specifiers resolved to macros", () => {
    const { typeChecker, files } = buildProgram({
      "/main.ts": `import { Foo } from "./mod";\nFoo();\n`,
      "/mod.ts": `export function Foo() {}\n`,
    });
    const main = files.get("/main.ts")!;
    const fooUse = getIdentifier(main, "Foo");
    const sym = typeChecker.getSymbolAtLocation(fooUse)!;

    const tracked = new Map<
      ts.ImportDeclaration,
      Set<ts.ImportSpecifier | "namespace" | "default">
    >();
    recordMacroImport(tracked, sym);

    const cleaned = cleanupMacroImports(ts.factory, tracked, [...main.statements], false);
    // The import statement should be entirely removed
    expect(cleaned.some((s) => ts.isImportDeclaration(s))).toBe(false);
  });

  it("trims macro specifiers but keeps non-macro ones", () => {
    const { typeChecker, files } = buildProgram({
      "/main.ts": `import { Foo, Bar } from "./mod";\n`,
      "/mod.ts": `export function Foo() {}\nexport function Bar() {}\n`,
    });
    const main = files.get("/main.ts")!;
    const fooSpec = main.statements.filter(ts.isImportDeclaration)[0].importClause!
      .namedBindings as ts.NamedImports;
    const fooIdent = fooSpec.elements[0].name;
    const sym = typeChecker.getSymbolAtLocation(fooIdent)!;

    const tracked = new Map<
      ts.ImportDeclaration,
      Set<ts.ImportSpecifier | "namespace" | "default">
    >();
    recordMacroImport(tracked, sym);

    const cleaned = cleanupMacroImports(ts.factory, tracked, [...main.statements], false);
    const importDecls = cleaned.filter(ts.isImportDeclaration);
    expect(importDecls.length).toBe(1);
    const named = importDecls[0].importClause?.namedBindings;
    expect(named && ts.isNamedImports(named)).toBe(true);
    const remaining = (named as ts.NamedImports).elements.map((e) => e.name.text);
    expect(remaining).toEqual(["Bar"]);
  });

  it("removes a default import when the default resolved to a macro", () => {
    const { typeChecker, files } = buildProgram({
      "/main.ts": `import Foo from "./mod";\nFoo();\n`,
      "/mod.ts": `export default function Foo() {}\n`,
    });
    const main = files.get("/main.ts")!;
    const fooUse = getIdentifier(main, "Foo");
    const sym = typeChecker.getSymbolAtLocation(fooUse)!;

    const tracked = new Map<
      ts.ImportDeclaration,
      Set<ts.ImportSpecifier | "namespace" | "default">
    >();
    recordMacroImport(tracked, sym);
    const cleaned = cleanupMacroImports(ts.factory, tracked, [...main.statements], false);
    expect(cleaned.some((s) => ts.isImportDeclaration(s))).toBe(false);
  });

  it("removes a namespace import when the namespace resolved to a macro", () => {
    const { typeChecker, files } = buildProgram({
      "/main.ts": `import * as NS from "./mod";\nNS.Foo();\n`,
      "/mod.ts": `export function Foo() {}\n`,
    });
    const main = files.get("/main.ts")!;
    const nsUse = getIdentifier(main, "NS");
    const sym = typeChecker.getSymbolAtLocation(nsUse)!;

    const tracked = new Map<
      ts.ImportDeclaration,
      Set<ts.ImportSpecifier | "namespace" | "default">
    >();
    recordMacroImport(tracked, sym);
    const cleaned = cleanupMacroImports(ts.factory, tracked, [...main.statements], false);
    expect(cleaned.some((s) => ts.isImportDeclaration(s))).toBe(false);
  });

  it("is a no-op when the tracked map is empty", () => {
    const { files } = buildProgram({
      "/main.ts": `import { Foo } from "./mod";\nFoo();\n`,
      "/mod.ts": `export function Foo() {}\n`,
    });
    const main = files.get("/main.ts")!;
    const empty = new Map<
      ts.ImportDeclaration,
      Set<ts.ImportSpecifier | "namespace" | "default">
    >();
    const cleaned = cleanupMacroImports(ts.factory, empty, [...main.statements], false);
    expect(cleaned.some((s) => ts.isImportDeclaration(s))).toBe(true);
  });

  it("preserves non-import statements", () => {
    const { typeChecker, files } = buildProgram({
      "/main.ts": `import { Foo } from "./mod";\nconst y = 99;\nFoo();\n`,
      "/mod.ts": `export function Foo() {}\n`,
    });
    const main = files.get("/main.ts")!;
    const fooUse = getIdentifier(main, "Foo");
    const sym = typeChecker.getSymbolAtLocation(fooUse)!;

    const tracked = new Map<
      ts.ImportDeclaration,
      Set<ts.ImportSpecifier | "namespace" | "default">
    >();
    recordMacroImport(tracked, sym);

    const cleaned = cleanupMacroImports(ts.factory, tracked, [...main.statements], false);
    // The variable statement should be the same reference as the original
    // (cleanupMacroImports passes non-import statements through unchanged).
    const varStmts = cleaned.filter(ts.isVariableStatement);
    expect(varStmts.length).toBe(1);
    expect(varStmts[0]).toBe(main.statements.find(ts.isVariableStatement));
  });
});

// ---------------------------------------------------------------------------
// resolveSymbolToMacro / resolveMacroFromSymbol
// ---------------------------------------------------------------------------

describe("resolveSymbolToMacro", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  it("resolves a simple named import to a module-scoped macro (module-keyed lookup)", () => {
    const macro = defineExpressionMacro({
      name: "ir_simple",
      module: "@typesugar/test",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import { ir_simple } from "@typesugar/test";\nir_simple();\n`,
      "/proj/node_modules/@typesugar/test/index.d.ts": `export declare function ir_simple(): void;\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_simple");
    const sym = typeChecker.getSymbolAtLocation(ident)!;
    expect(resolveSymbolToMacro(typeChecker, main, sym, "ir_simple", "expression")).toBe(macro);
  });

  it("resolves a module-less macro when the symbol is declared in a known package", () => {
    const macro = defineExpressionMacro({
      name: "ir_simple_namefree",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import { ir_simple_namefree } from "@typesugar/test";\nir_simple_namefree();\n`,
      "/proj/node_modules/@typesugar/test/index.d.ts": `export declare function ir_simple_namefree(): void;\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_simple_namefree");
    const sym = typeChecker.getSymbolAtLocation(ident)!;
    const resolved = resolveSymbolToMacro(
      typeChecker,
      main,
      sym,
      "ir_simple_namefree",
      "expression"
    );
    expect(resolved).toBe(macro);
  });

  it("resolves through a re-export chain", () => {
    // a → b → main; macro keyed by module of declaring file.
    const macro = defineExpressionMacro({
      name: "ir_reexport",
      module: "@typesugar/inner",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import { ir_reexport } from "@typesugar/outer";\nir_reexport();\n`,
      "/proj/node_modules/@typesugar/outer/index.d.ts": `export { ir_reexport } from "@typesugar/inner";\n`,
      "/proj/node_modules/@typesugar/inner/index.d.ts": `export declare function ir_reexport(): void;\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_reexport");
    const sym = typeChecker.getSymbolAtLocation(ident)!;
    const resolved = resolveSymbolToMacro(typeChecker, main, sym, "ir_reexport", "expression");
    expect(resolved).toBe(macro);
  });

  it("resolves star re-export chains", () => {
    const macro = defineExpressionMacro({
      name: "ir_star",
      module: "@typesugar/inner",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import { ir_star } from "@typesugar/outer";\nir_star();\n`,
      "/proj/node_modules/@typesugar/outer/index.d.ts": `export * from "@typesugar/inner";\n`,
      "/proj/node_modules/@typesugar/inner/index.d.ts": `export declare function ir_star(): void;\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_star");
    const sym = typeChecker.getSymbolAtLocation(ident)!;
    expect(resolveSymbolToMacro(typeChecker, main, sym, "ir_star", "expression")).toBe(macro);
  });

  it("handles default imports without throwing (probes the alias path)", () => {
    // Default imports declare with a different symbol name than the local
    // binding. The exact resolution depends on how TS surfaces the aliased
    // symbol's name. We verify the resolver does not throw and returns
    // either the macro or undefined deterministically.
    const macro = defineExpressionMacro({
      name: "ir_default",
      module: "@typesugar/test",
      exportName: "default",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import ir_default from "@typesugar/test";\nir_default();\n`,
      "/proj/node_modules/@typesugar/test/index.d.ts": `declare function _f(): void;\nexport default _f;\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_default");
    const sym = typeChecker.getSymbolAtLocation(ident)!;
    expect(() =>
      resolveSymbolToMacro(typeChecker, main, sym, "ir_default", "expression")
    ).not.toThrow();
  });

  it("resolves an aliased named import via the original name", () => {
    const macro = defineExpressionMacro({
      name: "ir_orig",
      module: "@typesugar/test",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import { ir_orig as ir_alias } from "@typesugar/test";\nir_alias();\n`,
      "/proj/node_modules/@typesugar/test/index.d.ts": `export declare function ir_orig(): void;\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_alias");
    const sym = typeChecker.getSymbolAtLocation(ident)!;
    // After alias resolution, resolved.name === "ir_orig"; module-scoped
    // lookup finds the macro via "@typesugar/test::ir_orig".
    const resolved = resolveSymbolToMacro(typeChecker, main, sym, "ir_alias", "expression");
    expect(resolved).toBe(macro);
  });

  it("returns undefined for a local symbol with no module declaration", () => {
    // A user-defined local function named the same as a registered macro
    // should NOT be resolved as a macro — guards against false matches.
    const macro = defineExpressionMacro({
      name: "ir_local_shadow",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/main.ts": `function ir_local_shadow() {}\nir_local_shadow();\n`,
    });
    const main = files.get("/main.ts")!;
    const ident = getIdentifier(main, "ir_local_shadow");
    const sym = typeChecker.getSymbolAtLocation(ident)!;
    expect(
      resolveSymbolToMacro(typeChecker, main, sym, "ir_local_shadow", "expression")
    ).toBeUndefined();
  });

  it("returns undefined for a global symbol declared in a different (non-imported) ambient file", () => {
    // A global function declared entirely in ANOTHER script file (no import/
    // export anywhere — both files are global scripts, merged into one
    // global scope by the compiler) should NOT be resolved as a macro, even
    // though its declaration lives in a "different file" than the reference.
    // Regression test for PEP-056 Wave 4b's parity-audit finding: the
    // foundExternalDecl rewrite must key off "was this reference itself an
    // import" (wasImported), not "is the declaration in a different file",
    // or split/merged ambient declarations across files would false-match.
    const macro = defineExpressionMacro({
      name: "ir_ambient_split",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/other-ambient.ts": `function ir_ambient_split() {}\n`,
      "/main.ts": `ir_ambient_split();\n`,
    });
    const main = files.get("/main.ts")!;
    const ident = getIdentifier(main, "ir_ambient_split");
    const sym = typeChecker.getSymbolAtLocation(ident)!;
    expect(
      resolveSymbolToMacro(typeChecker, main, sym, "ir_ambient_split", "expression")
    ).toBeUndefined();
  });

  it("resolves a node_modules @typesugar/* import via module-scoped lookup", () => {
    const macro = defineExpressionMacro({
      name: "ir_pkg",
      module: "@typesugar/core",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import { ir_pkg } from "@typesugar/core";\nir_pkg();\n`,
      "/proj/node_modules/@typesugar/core/index.d.ts": `export declare function ir_pkg(): void;\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_pkg");
    const sym = typeChecker.getSymbolAtLocation(ident)!;
    expect(resolveSymbolToMacro(typeChecker, main, sym, "ir_pkg", "expression")).toBe(macro);
  });

  it("handles circular re-exports without infinite recursion", () => {
    // a re-exports from b, b re-exports from a — TS will fail to resolve,
    // but the resolver must terminate.
    const macro = defineExpressionMacro({
      name: "ir_cycle",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import { ir_cycle } from "@typesugar/a";\nir_cycle;\n`,
      "/proj/node_modules/@typesugar/a/index.d.ts": `export { ir_cycle } from "@typesugar/b";\n`,
      "/proj/node_modules/@typesugar/b/index.d.ts": `export { ir_cycle } from "@typesugar/a";\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_cycle");
    const sym = typeChecker.getSymbolAtLocation(ident);
    // The resolver must terminate, regardless of whether TS resolved the
    // cyclic alias to a symbol or not.
    if (!sym) {
      const r = resolveMacroFromSymbol(
        typeChecker,
        main,
        new Map(),
        ident,
        "ir_cycle",
        "expression"
      );
      expect(r === macro || r === undefined).toBe(true);
      return;
    }
    const r = resolveSymbolToMacro(typeChecker, main, sym, "ir_cycle", "expression");
    expect(r === macro || r === undefined).toBe(true);
  });
});

describe("resolveMacroFromSymbol", () => {
  beforeEach(() => {
    globalRegistry.clear();
  });

  it("caches results by symbol id", () => {
    const macro = defineExpressionMacro({
      name: "ir_cached",
      module: "@typesugar/test",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import { ir_cached } from "@typesugar/test";\nir_cached();\nir_cached();\n`,
      "/proj/node_modules/@typesugar/test/index.d.ts": `export declare function ir_cached(): void;\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_cached");
    const cache = new Map<number, ReturnType<typeof resolveMacroFromSymbol> | null>();

    const first = resolveMacroFromSymbol(
      typeChecker,
      main,
      cache as Map<number, never>,
      ident,
      "ir_cached",
      "expression"
    );
    expect(first).toBe(macro);
    // After first call, cache should have at least one entry
    expect(cache.size).toBeGreaterThanOrEqual(1);

    const second = resolveMacroFromSymbol(
      typeChecker,
      main,
      cache as Map<number, never>,
      ident,
      "ir_cached",
      "expression"
    );
    expect(second).toBe(macro);
  });

  it("invokes onMacroImport callback when resolution succeeds", () => {
    globalRegistry.register(
      defineExpressionMacro({
        name: "ir_callback",
        module: "@typesugar/test",
        expand: () => ts.factory.createNumericLiteral(0),
      })
    );

    const { typeChecker, files } = buildProgram({
      "/proj/main.ts": `import { ir_callback } from "@typesugar/test";\nir_callback();\n`,
      "/proj/node_modules/@typesugar/test/index.d.ts": `export declare function ir_callback(): void;\n`,
    });
    const main = files.get("/proj/main.ts")!;
    const ident = getIdentifier(main, "ir_callback");

    const captured: ts.Symbol[] = [];
    resolveMacroFromSymbol(typeChecker, main, new Map(), ident, "ir_callback", "expression", (s) =>
      captured.push(s)
    );
    expect(captured.length).toBe(1);
  });

  it("falls back to name-based lookup when symbol is undefined", () => {
    const macro = defineExpressionMacro({
      name: "ir_no_symbol",
      expand: () => ts.factory.createNumericLiteral(0),
    });
    globalRegistry.register(macro);

    const { typeChecker, files } = buildProgram({
      "/main.ts": `const x = 1;\n`,
    });
    const main = files.get("/main.ts")!;
    // A synthesized identifier that isn't part of the source — typeChecker
    // returns no symbol, exercising the fallback path.
    const synth = ts.factory.createIdentifier("ir_no_symbol");
    const r = resolveMacroFromSymbol(
      typeChecker,
      main,
      new Map(),
      synth,
      "ir_no_symbol",
      "expression"
    );
    expect(r).toBe(macro);
  });
});

// ---------------------------------------------------------------------------
// hasExtensionDecorator
// ---------------------------------------------------------------------------

describe("hasExtensionDecorator", () => {
  it("detects a bare @extension decorator", () => {
    const { files } = buildProgram({
      "/main.ts": `@extension class C {}\n`,
    });
    const sf = files.get("/main.ts")!;
    const cls = sf.statements.find(ts.isClassDeclaration)!;
    expect(hasExtensionDecorator(cls)).toBe(true);
  });

  it("detects a call-form @extension() decorator", () => {
    const { files } = buildProgram({
      "/main.ts": `@extension() class C {}\n`,
    });
    const sf = files.get("/main.ts")!;
    const cls = sf.statements.find(ts.isClassDeclaration)!;
    expect(hasExtensionDecorator(cls)).toBe(true);
  });

  it("returns false when no @extension decorator is present", () => {
    const { files } = buildProgram({
      "/main.ts": `@other class C {}\n`,
    });
    const sf = files.get("/main.ts")!;
    const cls = sf.statements.find(ts.isClassDeclaration)!;
    expect(hasExtensionDecorator(cls)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanImportsForExtension
// ---------------------------------------------------------------------------

describe("scanImportsForExtension", () => {
  function makeCtx(program: ts.Program, sourceFile: ts.SourceFile): MacroContextImpl {
    // Minimal TransformationContext stub — scanImportsForExtension only
    // reads typeChecker and reportError; the rest is unused here.
    const dummyTransformCtx = {
      factory: ts.factory,
    } as unknown as ts.TransformationContext;
    return new MacroContextImpl(
      program,
      program.getTypeChecker(),
      sourceFile,
      ts.factory,
      dummyTransformCtx
    );
  }

  it("returns undefined when there are no imports", () => {
    const { program, typeChecker, files } = buildProgram({
      "/main.ts": `const x = 1;\n`,
    });
    const sf = files.get("/main.ts")!;
    const ctx = makeCtx(program, sf);
    const type = typeChecker.getNumberType();
    expect(scanImportsForExtension(ctx, sf, "noSuchMethod", type)).toBeUndefined();
  });

  it("returns undefined when no imported symbol provides the method", () => {
    const { program, typeChecker, files } = buildProgram({
      "/main.ts": `import { unrelated } from "./mod";\nunrelated;\n`,
      "/mod.ts": `export function unrelated(): void {}\n`,
    });
    const sf = files.get("/main.ts")!;
    const ctx = makeCtx(program, sf);
    const type = typeChecker.getNumberType();
    expect(scanImportsForExtension(ctx, sf, "noSuchMethod", type)).toBeUndefined();
  });

  it("ignores empty source files (defensive)", () => {
    // Construct a minimal program; pass a SourceFile with empty statements.
    const { program } = buildProgram({
      "/main.ts": `\n`,
    });
    const emptySf = ts.createSourceFile("/empty.ts", "", ts.ScriptTarget.ES2020, true);
    const ctx = makeCtx(program, emptySf);
    const type = program.getTypeChecker().getNumberType();
    expect(scanImportsForExtension(ctx, emptySf, "x", type)).toBeUndefined();
  });
});
