/**
 * method-sugar.ts: a checker/resolution failure while resolving a scope-based
 * instance must leave a visible warning, not vanish (review core #43,
 * CLAUDE.md "Calling the type checker on macro-generated nodes").
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

vi.mock("@typesugar/macros", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@typesugar/macros")>();
  return {
    ...actual,
    resolveInstance: () => {
      throw new Error("boom-resolve");
    },
  };
});

import {
  createMacroContext,
  globalRegistry,
  clearTypeRewrites,
  standaloneExtensionRegistry,
  scanImportsForScope,
  globalResolutionScope,
} from "@typesugar/core";

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

describe("method sugar: instance-resolution failure is visible (core #43)", () => {
  it("warns, then still considers the @derive companion", () => {
    const out = withContext(
      {
        "point.ts": [
          "/** @derive(Eq) */",
          "export class Point { constructor(public x: number, public y: number) {} }",
        ].join("\n"),
        "main.ts": [
          "/** @typeclass */",
          "interface Eq<A> {",
          "  equals(a: A, b: A): boolean;",
          "}",
          'import { Point } from "./point";',
          "declare const p: Point;",
          "declare const q: Point;",
          "p.equals(q);",
        ].join("\n"),
      },
      "main.ts",
      (ctx, sf, visit) => {
        scanImportsForScope(sf, globalResolutionScope, ctx.program);
        const call = tryResolveTypeclassMethod(
          ctx,
          false,
          visit,
          noResolveMacroFromSymbol,
          noResolveExtensionFromImports,
          lastExpressionStatement(sf)
        );
        return {
          call,
          warnings: ctx
            .getDiagnostics()
            .filter((d) => d.severity === "warning")
            .map((d) => d.message),
        };
      }
    );
    expect(out.call).toBeDefined();
    expect(out.warnings.some((m) => m.includes("boom-resolve"))).toBe(true);
  });
});
