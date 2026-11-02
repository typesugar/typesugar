/**
 * Module-qualified macro identity during resolution (PEP-060 item 8).
 *
 * Two packages register an expression macro with the same name (here
 * `@typesugar/validate`'s and `@typesugar/testing`'s `assert`). The macro that
 * expands is the one the user's import declares — via the checker (named,
 * aliased and namespace imports) and via the import-literal fallback used for
 * synthetic / detached nodes — never whichever package registered first.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as ts from "typescript";
import { globalRegistry, defineExpressionMacro, defineDeriveMacro } from "@typesugar/core";
import type { MacroDefinition } from "@typesugar/core";
import {
  resolveModuleSpecifier,
  fallbackNameLookupWithImports,
  resolveSymbolToMacro,
  resolveMacroFromSymbol,
  lookupMacroByName,
} from "../src/import-resolution.js";

function buildProgram(files: Record<string, string>) {
  const cache = new Map<string, ts.SourceFile>();
  const host: ts.CompilerHost = {
    getSourceFile(fileName, lv) {
      const hit = cache.get(fileName);
      if (hit) return hit;
      const text = files[fileName];
      if (text === undefined) return undefined;
      const sf = ts.createSourceFile(fileName, text, lv, true);
      cache.set(fileName, sf);
      return sf;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => f in files,
    readFile: (f) => files[f],
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const program = ts.createProgram({
    rootNames: Object.keys(files),
    options: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noLib: true,
      skipLibCheck: true,
    },
    host,
  });
  return { program, checker: program.getTypeChecker() };
}

/** The callee node of the first call in `sf` whose text is `calleeText`. */
function callee(sf: ts.SourceFile, calleeText: string): ts.Node {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && n.expression.getText(sf) === calleeText) {
      found = n.expression;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) throw new Error(`no call to ${calleeText}`);
  return found;
}

const expand = (_c: unknown, call: ts.CallExpression) => call;
const vAssert = defineExpressionMacro({
  name: "assert",
  module: "@typesugar/validate",
  description: "validate assert",
  expand,
});
const tAssert = defineExpressionMacro({
  name: "assert",
  module: "@typesugar/testing",
  description: "testing assert",
  expand,
});

const DECLS = {
  "/proj/node_modules/@typesugar/validate/index.d.ts": `export declare function assert<T>(): (v: unknown) => T;\nexport declare function is<T>(): (v: unknown) => v is T;\n`,
  "/proj/node_modules/@typesugar/testing/index.d.ts": `export declare function assert(c: boolean): void;\n`,
};

function resolveAt(
  src: string,
  calleeText: string,
  macroName: string
): MacroDefinition | undefined {
  const { program, checker } = buildProgram({ "/proj/main.ts": src, ...DECLS });
  const sf = program.getSourceFile("/proj/main.ts")!;
  return resolveMacroFromSymbol(
    checker,
    sf,
    new Map(),
    callee(sf, calleeText),
    macroName,
    "expression",
    undefined,
    program
  );
}

for (const [label, order] of [
  ["validate registered first", [vAssert, tAssert]],
  ["testing registered first", [tAssert, vAssert]],
] as const) {
  describe(`two modules' \`assert\` (${label})`, () => {
    beforeEach(() => {
      globalRegistry.clear();
      for (const m of order) globalRegistry.register(m);
    });

    it("a named import resolves to its own module's macro", () => {
      expect(
        resolveAt(
          `import { assert } from "@typesugar/testing";\nassert(true);\n`,
          "assert",
          "assert"
        )
      ).toBe(tAssert);
      expect(
        resolveAt(
          `import { assert } from "@typesugar/validate";\nassert<number>();\n`,
          "assert",
          "assert"
        )
      ).toBe(vAssert);
    });

    it("one file importing both (alias + namespace) resolves each to its own module", () => {
      const src =
        `import { assert } from "@typesugar/testing";\n` +
        `import { assert as check } from "@typesugar/validate";\n` +
        `import * as v from "@typesugar/validate";\n` +
        `assert(true);\ncheck<number>();\nv.assert<string>();\n`;
      expect(resolveAt(src, "assert", "assert")).toBe(tAssert);
      expect(resolveAt(src, "check", "check")).toBe(vAssert);
      expect(resolveAt(src, "v.assert", "assert")).toBe(vAssert);
    });

    it("the import-literal fallback (synthetic/detached nodes) picks by the import, alias included", () => {
      const sf = (text: string) =>
        ts.createSourceFile("/proj/x.ts", text, ts.ScriptTarget.Latest, true);
      expect(
        fallbackNameLookupWithImports(
          sf(`import { assert } from "@typesugar/testing";`),
          "assert",
          "expression"
        )
      ).toBe(tAssert);
      expect(
        fallbackNameLookupWithImports(
          sf(`import { assert } from "@typesugar/validate";`),
          "assert",
          "expression"
        )
      ).toBe(vAssert);
      expect(
        fallbackNameLookupWithImports(
          sf(`import { assert as check } from "@typesugar/validate";`),
          "check",
          "expression"
        )
      ).toBe(vAssert);
      // Imported from neither: no module-qualified macro applies.
      expect(
        fallbackNameLookupWithImports(sf(`const x = 1;`), "assert", "expression")
      ).toBeUndefined();
    });

    it("the `typesugar` family wildcard cannot pick one of two specific packages", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        // A file name per order: the warning is printed once per (file, name, kind).
        const sf = ts.createSourceFile(
          `/proj/umbrella-${order[0].module!.split("/")[1]}-first.ts`,
          `import { assert } from "typesugar";`,
          ts.ScriptTarget.Latest,
          true
        );
        expect(fallbackNameLookupWithImports(sf, "assert", "expression")).toBeUndefined();
        expect(warn.mock.calls.flat().join("\n")).toMatch(
          /'assert'.*@typesugar\/validate.*@typesugar\/testing|'assert'.*@typesugar\/testing.*@typesugar\/validate/s
        );
      } finally {
        warn.mockRestore();
      }
    });

    it("resolveSymbolToMacro: the declaring module wins even through the umbrella", () => {
      // `typesugar` re-exports validate's assert: the declaration lives in
      // @typesugar/validate, so that is the macro — not testing's, which the
      // `typesugar` wildcard would also match.
      const { program, checker } = buildProgram({
        "/proj/main.ts": `import { assert } from "typesugar";\nassert<number>();\n`,
        "/proj/node_modules/typesugar/index.d.ts": `export { assert } from "@typesugar/validate";\n`,
        ...DECLS,
      });
      const sf = program.getSourceFile("/proj/main.ts")!;
      const sym = checker.getSymbolAtLocation(callee(sf, "assert"))!;
      expect(resolveSymbolToMacro(checker, sf, sym, "assert", "expression")).toBe(vAssert);
    });
  });
}

describe("lookupMacroByName (non-import name sites: derive names, JSDoc tags)", () => {
  beforeEach(() => globalRegistry.clear());

  const derive = (module: string) =>
    defineDeriveMacro({ name: "Codec", module, description: module, expand: () => [] });

  it("a single provider is found by name, as before", () => {
    const d = derive("@acme/a");
    globalRegistry.register(d);
    const sf = ts.createSourceFile("/x.ts", `const x = 1;`, ts.ScriptTarget.Latest, true);
    expect(lookupMacroByName(sf, "Codec", "derive")).toBe(d);
  });

  it("several providers are disambiguated by the file's imports", () => {
    const a = derive("@acme/a");
    const b = derive("@acme/b");
    globalRegistry.register(a);
    globalRegistry.register(b);
    const sf = ts.createSourceFile(
      "/x.ts",
      `import { Codec } from "@acme/b";`,
      ts.ScriptTarget.Latest,
      true
    );
    expect(lookupMacroByName(sf, "Codec", "derive")).toBe(b);
  });
});

describe("resolveModuleSpecifier under pnpm's store layout", () => {
  it("uses the package's own node_modules segment, not `.pnpm`", () => {
    expect(
      resolveModuleSpecifier(
        "/proj/node_modules/.pnpm/@typesugar+validate@1.0.0/node_modules/@typesugar/validate/dist/index.d.ts"
      )
    ).toBe("@typesugar/validate");
  });
});
