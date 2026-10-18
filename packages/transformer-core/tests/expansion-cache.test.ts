/**
 * Expression-macro expansion cache (deep-review core #1, #55).
 *
 * The cache used to be default-on for every expression macro and keyed only
 * by macro name + call-site text, so two files with the same call text but
 * different types (`fieldNames<User>()` with a different `interface User`)
 * got the first file's expansion, and an edited type never re-expanded.
 * Caching is now opt-in (`cacheable: true`), the key includes the source
 * file path, and a result is only stored when the expansion had no
 * same-pass side effects.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MacroContextImpl,
  HygieneContext,
  MacroExpansionCache,
  defineExpressionMacro,
  globalRegistry,
  scanImportsForScope,
  globalResolutionScope,
} from "@typesugar/core";
import { MacroTransformer } from "../src/transformer.js";
// Registers the real `fieldNames` macro.
import "@typesugar/macros";

function createProgram(files: Record<string, string>): ts.Program {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (name, lv) => {
      if (name in files) return ts.createSourceFile(name, files[name], lv, true);
      if (name.includes("lib.") && name.endsWith(".d.ts")) return ts.createSourceFile(name, "", lv);
      return undefined;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (f) => f in files,
    readFile: (f) => files[f],
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  return ts.createProgram(Object.keys(files), options, host);
}

function transformFile(
  program: ts.Program,
  fileName: string,
  cache: MacroExpansionCache
): { code: string; errors: string[] } {
  const sf = program.getSourceFile(fileName)!;
  const errors: string[] = [];
  const factory: ts.TransformerFactory<ts.SourceFile> = (context) => (sourceFile) => {
    const ctx = new MacroContextImpl(
      program,
      program.getTypeChecker(),
      sourceFile,
      context.factory,
      context,
      new HygieneContext()
    );
    scanImportsForScope(sourceFile, globalResolutionScope, program);
    const transformer = new MacroTransformer(ctx, false, undefined, cache);
    const out = ts.visitNode(sourceFile, transformer.visit.bind(transformer)) as ts.SourceFile;
    for (const d of ctx.getDiagnostics()) if (d.severity === "error") errors.push(d.message);
    return out;
  };
  const result = ts.transform(sf, [factory]);
  const code = ts.createPrinter().printFile(result.transformed[0]);
  result.dispose();
  return { code, errors };
}

let cacheDir: string;
beforeEach(() => {
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-expcache-"));
});
afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

const src = (fields: string) => `
import { fieldNames } from "typesugar";
interface User { ${fields} }
export const names = fieldNames<User>();
`;

describe("expansion cache: type-dependent macros are not cached", () => {
  it("two files with different `interface User` get different fieldNames<User>() output", () => {
    const cache = new MacroExpansionCache(cacheDir);
    const program = createProgram({
      "/a/main.ts": src("id: number; name: string;"),
      "/b/main.ts": src("email: string;"),
    });
    const a = transformFile(program, "/a/main.ts", cache);
    const b = transformFile(program, "/b/main.ts", cache);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(a.code).toContain(`["id", "name"]`);
    expect(b.code).toContain(`["email"]`);
    expect(b.code).not.toContain(`"id"`);
  });

  it("a changed type re-expands on the next build (warm disk cache)", () => {
    const cache1 = new MacroExpansionCache(cacheDir);
    const p1 = createProgram({ "/a/main.ts": src("v1: number;") });
    expect(transformFile(p1, "/a/main.ts", cache1).code).toContain(`["v1"]`);
    cache1.save();

    const cache2 = new MacroExpansionCache(cacheDir);
    const p2 = createProgram({ "/a/main.ts": src("v2: number;") });
    const out = transformFile(p2, "/a/main.ts", cache2).code;
    expect(out).toContain(`["v2"]`);
    expect(out).not.toContain(`"v1"`);
  });
});

describe("expansion cache: opt-in `cacheable: true`", () => {
  let expandCount = 0;
  const NAME = "__testCacheablePure";
  const IMPURE = "__testCacheableImpure";

  beforeEach(() => {
    expandCount = 0;
    if (!globalRegistry.getExpression(NAME)) {
      globalRegistry.register(
        defineExpressionMacro({
          name: NAME,
          description: "pure syntactic test macro",
          cacheable: true,
          expand(ctx, _call, args) {
            expandCount++;
            return ctx.factory.createArrayLiteralExpression([args[0], args[0]]);
          },
        })
      );
      globalRegistry.register(
        defineExpressionMacro({
          name: IMPURE,
          description: "cacheable but reports a diagnostic (a side effect)",
          cacheable: true,
          expand(ctx, call) {
            expandCount++;
            ctx.reportWarning(call, "side effect");
            return ctx.factory.createNumericLiteral(1);
          },
        })
      );
    }
  });

  it("a cacheable pure macro is served from the cache within one file", () => {
    const cache = new MacroExpansionCache(cacheDir);
    const program = createProgram({
      "/a/x.ts": `import { ${NAME} } from "test-macros";\nexport const a = ${NAME}(1);`,
    });
    transformFile(program, "/a/x.ts", cache);
    const out = transformFile(program, "/a/x.ts", cache);
    expect(out.code).toContain("[1, 1]");
    expect(expandCount).toBe(1);
  });

  it("the cache key includes the file path", () => {
    const cache = new MacroExpansionCache(cacheDir);
    const text = `import { ${NAME} } from "test-macros";\nexport const a = ${NAME}(1);`;
    const program = createProgram({ "/a/x.ts": text, "/b/x.ts": text });
    transformFile(program, "/a/x.ts", cache);
    transformFile(program, "/b/x.ts", cache);
    expect(expandCount).toBe(2);
  });

  it("an expansion that reports a diagnostic is never cached", () => {
    const cache = new MacroExpansionCache(cacheDir);
    const program = createProgram({
      "/a/y.ts": `import { ${IMPURE} } from "test-macros";\nexport const a = ${IMPURE}();`,
    });
    transformFile(program, "/a/y.ts", cache);
    transformFile(program, "/a/y.ts", cache);
    expect(expandCount).toBe(2);
  });

  it("an expression macro without `cacheable` is not cached", () => {
    const cache = new MacroExpansionCache(cacheDir);
    const program = createProgram({ "/a/main.ts": src("id: number;") });
    transformFile(program, "/a/main.ts", cache);
    expect(cache.size).toBe(0);
  });
});
