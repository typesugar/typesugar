/**
 * method-sugar.ts: the companion reference a derived `p.equals(q)` rewrite
 * emits must actually be bound at runtime (deep-review findings core #23, #27).
 *
 * - #23: receiver type declared in a module the file never imports
 *   (`makePoint().equals(q)`) -> a bare `Point.Eq.equals(...)` with no import.
 * - #27: companion base named like a known global (`File`) -> `ctx.ensureImport`
 *   returns bare `File` without importing it, so it binds to the runtime global.
 *
 * Fixture helpers mirror method-sugar.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  createMacroContext,
  globalRegistry,
  clearTypeRewrites,
  standaloneExtensionRegistry,
  scanImportsForScope,
  globalResolutionScope,
} from "@typesugar/core";

import { instanceScanner } from "@typesugar/macros";
import { tryResolveTypeclassMethod } from "../src/method-sugar.js";
import type { ResolveMacroFn, ResolveExtensionFn } from "../src/rewriting.js";
import type { VisitFn } from "../src/transformer-utils.js";

// ---------------------------------------------------------------------------
// Program + context fixtures (mirrors rewriting.test.ts)
// ---------------------------------------------------------------------------

interface Fixture {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
}

/** Writes `files` to a real tempdir and builds a `ts.Program` over all of them. */
function makeMultiFileProgram(files: Record<string, string>, mainFile: string): Fixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "method-sugar-test-"));
  const filePaths: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    filePaths[name] = filePath;
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  // Re-parse fixtures with setParentNodes=true so JSDoc tags (@typeclass/@impl/@derive)
  // are visible to ts.getJSDocTags — needed for PEP-052 activation/instance scanning.
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, lang, onErr, shouldCreate) => {
    const sf = origGetSourceFile(fn, lang, onErr, shouldCreate);
    if (sf && Object.values(filePaths).includes(fn)) {
      return ts.createSourceFile(fn, sf.text, lang, true);
    }
    return sf;
  };
  const program = ts.createProgram(Object.values(filePaths), options, host);
  const sourceFile = program.getSourceFile(filePaths[mainFile])!;

  return {
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function makeProgram(source: string, fileName = "test.ts"): Fixture {
  return makeMultiFileProgram({ [fileName]: source }, fileName);
}

/** Run a callback inside a transformation context, returning the result. */
function withContext<T>(
  files: Record<string, string> | string,
  mainFile: string,
  cb: (ctx: ReturnType<typeof createMacroContext>, sf: ts.SourceFile, visit: VisitFn) => T
): T {
  const { program, sourceFile, cleanup } =
    typeof files === "string"
      ? makeProgram(files, mainFile)
      : makeMultiFileProgram(files, mainFile);
  let result: T;

  try {
    const factory: ts.TransformerFactory<ts.SourceFile> = (transformCtx) => {
      const ctx = createMacroContext(program, sourceFile, transformCtx);
      const visit: VisitFn = (n) => n;
      result = cb(ctx, sourceFile, visit);
      return (sf) => sf;
    };
    ts.transform(sourceFile, [factory]);
  } finally {
    cleanup();
  }

  return result!;
}

function lastExpressionStatement(sf: ts.SourceFile): ts.CallExpression {
  const stmts = sf.statements;
  return (stmts[stmts.length - 1] as ts.ExpressionStatement).expression as ts.CallExpression;
}

// None of these fixtures have an expression-macro receiver or a native/extension
// method to prioritize over typeclass method sugar, so these stubs always report
// "no macro" / "no extension" — matching an ordinary call site.
const noResolveMacroFromSymbol: ResolveMacroFn = () => undefined;
const noResolveExtensionFromImports: ResolveExtensionFn = () => undefined;

const EQ_TYPECLASS = [
  "/** @typeclass */",
  "interface Eq<A> {",
  "  equals(a: A, b: A): boolean;",
  "}",
];

interface Outcome {
  call: ts.Expression | undefined;
  errors: string[];
  pendingImports: string[];
}

function run(files: Record<string, string>): Outcome {
  return withContext(files, "main.ts", (ctx, sf, visit) => {
    scanImportsForScope(sf, globalResolutionScope, ctx.program);
    const call = tryResolveTypeclassMethod(
      ctx,
      false,
      visit,
      noResolveMacroFromSymbol,
      noResolveExtensionFromImports,
      lastExpressionStatement(sf)
    );
    const printer = ts.createPrinter();
    return {
      call,
      errors: ctx
        .getDiagnostics()
        .filter((d) => d.severity === "error")
        .map((d) => d.message),
      pendingImports: ctx.fileBindingCache
        .getPendingImports()
        .map((d) => printer.printNode(ts.EmitHint.Unspecified, d, sf)),
    };
  });
}

function printCall(e: ts.Expression): string {
  return ts
    .createPrinter()
    .printNode(
      ts.EmitHint.Unspecified,
      e,
      ts.createSourceFile("x.ts", "", ts.ScriptTarget.Latest, false)
    );
}

beforeEach(() => {
  clearTypeRewrites();
  standaloneExtensionRegistry.length = 0;
  globalRegistry.clear();
});

afterEach(() => {
  clearTypeRewrites();
  standaloneExtensionRegistry.length = 0;
  globalRegistry.clear();
});

const POINT_TS = [
  "/** @derive(Eq) */",
  "export class Point { constructor(public x: number, public y: number) {} }",
].join("\n");
const FACTORY_TS = [
  'import { Point } from "./point";',
  "export function makePoint(): Point { return new Point(1, 2); }",
].join("\n");

describe("method sugar: derived companion from an unimported module (finding #23)", () => {
  it("reports an error instead of emitting an unbound `Point.Eq` reference", () => {
    const out = run({
      "point.ts": POINT_TS,
      "factory.ts": FACTORY_TS,
      "main.ts": [
        ...EQ_TYPECLASS,
        'import { makePoint } from "./factory";',
        "declare const q: ReturnType<typeof makePoint>;",
        "makePoint().equals(q);",
      ].join("\n"),
    });
    expect(out.call).toBeUndefined();
    expect(out.errors.some((m) => m.includes("'Point'") && m.includes("does not import"))).toBe(
      true
    );
  });

  it("still rewrites when the declaring module is imported", () => {
    const out = run({
      "point.ts": POINT_TS,
      "factory.ts": FACTORY_TS,
      "main.ts": [
        ...EQ_TYPECLASS,
        'import { Point } from "./point";',
        'import { makePoint } from "./factory";',
        "declare const q: Point;",
        "makePoint().equals(q);",
      ].join("\n"),
    });
    expect(out.errors).toEqual([]);
    expect(out.call).toBeDefined();
    expect(printCall(out.call!)).toBe("Point.Eq.equals(makePoint(), q)");
  });
});

const MODELS_TS = [
  "/** @derive(Eq) */",
  "export class File { constructor(public name: string) {} }",
  'export function loadFile(): File { return new File("a"); }',
].join("\n");

describe("method sugar: companion named like a known global (finding #27)", () => {
  it("does not emit a bare `File` that binds to the runtime global", () => {
    const out = run({
      "models.ts": MODELS_TS,
      "main.ts": [
        ...EQ_TYPECLASS,
        'import { loadFile } from "./models";',
        "loadFile().equals(loadFile());",
      ].join("\n"),
    });
    // Either the import is really added, or the rewrite is refused with an error.
    const imported = out.pendingImports.some((i) => /\bFile\b/.test(i) && i.includes("./models"));
    if (!imported) {
      expect(out.call).toBeUndefined();
      expect(out.errors.some((m) => m.includes("global 'File'"))).toBe(true);
    }
  });

  it("still rewrites when the file imports the user's `File`", () => {
    const out = run({
      "models.ts": MODELS_TS,
      "main.ts": [
        ...EQ_TYPECLASS,
        'import { File, loadFile } from "./models";',
        "loadFile().equals(loadFile());",
      ].join("\n"),
    });
    expect(out.errors).toEqual([]);
    expect(out.call).toBeDefined();
    expect(printCall(out.call!)).toBe("File.Eq.equals(loadFile(), loadFile())");
  });
});
