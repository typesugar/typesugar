/**
 * Tests for method-sugar.ts — instance-method sugar (PEP-056 Wave 1).
 *
 * `receiver.method(args)` -> `Companion.method(receiver, ...args)` for a
 * typeclass method, e.g. a derived `p.equals(q)` -> `Point.Eq.equals(p, q)`.
 *
 * Same pattern as `rewriting.test.ts`'s `tryRewriteTypeclassOperator` suite:
 * drive the function directly using a real `ts.Program` + `createMacroContext`.
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

// ---------------------------------------------------------------------------
// Registry hygiene
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// tryResolveTypeclassMethod
// ---------------------------------------------------------------------------

describe("tryResolveTypeclassMethod", () => {
  it("rewrites p.equals(q) to eqPoint.equals(p, q) when the typeclass + instance are in scope (activation on)", () => {
    // PEP-052: an in-file `@typeclass` activates method syntax ("you don't
    // import what you define"), and the `@impl` instance resolves from scope.
    const source = [
      "/** @typeclass */",
      "interface Eq<A> {",
      "  equals(a: A, b: A): boolean;",
      "}",
      "interface Point { x: number; y: number; }",
      "/** @impl Eq<Point> */",
      "const eqPoint: Eq<Point> = { equals: (a, b) => a.x === b.x && a.y === b.y };",
      "declare const p: Point;",
      "declare const q: Point;",
      "p.equals(q);",
    ].join("\n");

    const call = withContext(source, "consumer.ts", (ctx, sf, visit) => {
      scanImportsForScope(sf, globalResolutionScope, ctx.program);
      const node = lastExpressionStatement(sf);
      return tryResolveTypeclassMethod(ctx, false, visit, node);
    });

    expect(call).toBeDefined();
    const rewritten = call as ts.CallExpression;
    expect(ts.isCallExpression(rewritten)).toBe(true);
    const pa = rewritten.expression as ts.PropertyAccessExpression;
    expect(ts.isPropertyAccessExpression(pa)).toBe(true);
    expect((pa.expression as ts.Identifier).text).toBe("eqPoint");
    expect(pa.name.text).toBe("equals");
    expect(rewritten.arguments).toHaveLength(2);
    expect((rewritten.arguments[0] as ts.Identifier).text).toBe("p");
    expect((rewritten.arguments[1] as ts.Identifier).text).toBe("q");
  });

  it("returns undefined when method syntax is not activated (activation off, negative control)", () => {
    // Same shape as the positive case, but the typeclass is declared in a
    // SEPARATE file and never imported/activated here — the local `@typeclass`
    // self-activation rule ("you don't import what you define") can never prove
    // an import-driven gate is off (PEP-052 Wave 6 lesson), so the typeclass
    // must live in a different file for this to be a real negative control.
    const call = withContext(
      {
        "eq.ts": [
          "/** @typeclass */",
          "export interface Eq<A> {",
          "  equals(a: A, b: A): boolean;",
          "}",
        ].join("\n"),
        "consumer.ts": [
          "interface Point { x: number; y: number; }",
          "declare const eqPoint: { equals: (a: Point, b: Point) => boolean };",
          "declare const p: Point;",
          "declare const q: Point;",
          "p.equals(q);",
        ].join("\n"),
      },
      "consumer.ts",
      (ctx, sf, visit) => {
        scanImportsForScope(sf, globalResolutionScope, ctx.program);
        const node = lastExpressionStatement(sf);
        return tryResolveTypeclassMethod(ctx, false, visit, node);
      }
    );

    expect(call).toBeUndefined();
  });

  // The class below deliberately carries NO `@derive`/`@deriving` decorator or
  // JSDoc tag. `resolveMethodSugarInstance`'s Stage 2 fallback
  // (`typeDerivesTypeclass`) only fires when such a decorator/tag is present, so
  // omitting it isolates Stage 1 (`resolveInstance` + its `getSynthesized`
  // same-pass side-table) — otherwise Stage 2 would independently derive the
  // identical "Point.Eq" companion path and the test would pass whether or not
  // the getSynthesized wiring actually works (verified empirically: an earlier
  // draft of this test kept `@derive(Eq)` on the class and still passed with
  // `registerSynthesized` commented out, because Stage 2 papered over it).
  const SYNTHESIZED_DERIVE_SOURCE = [
    "/** @typeclass */",
    "interface Eq<A> {",
    "  equals(a: A, b: A): boolean;",
    "}",
    "class Point { constructor(public x: number, public y: number) {} }",
    "declare const p: Point;",
    "declare const q: Point;",
    "p.equals(q);",
  ].join("\n");

  function registerSynthesizedPointEq(
    ctx: ReturnType<typeof createMacroContext>,
    sf: ts.SourceFile
  ) {
    // Register the synthesized companion the same way expandDeriveDecorator does
    // during @derive expansion, BEFORE the method-sugar call site is visited —
    // simulating "the pass already generated Point.Eq this same pass".
    const classDecl = sf.statements.find((s): s is ts.ClassDeclaration =>
      ts.isClassDeclaration(s)
    )!;
    const pointType = ctx.typeChecker.getTypeAtLocation(classDecl);
    instanceScanner.registerSynthesized(ctx.program, sf.fileName, {
      typeclassName: "Eq",
      forType: pointType,
      forTypeString: "Point",
      exportName: "Point.Eq",
      sourceModule: sf.fileName,
      detectedVia: "derived",
    });
  }

  it("resolves a same-file @derive companion synthesized during the same pass", () => {
    // The bug PEP-056 exists to fix: InstanceScanner.scanLocalFile sees the
    // PRE-TRANSFORM parse tree, so a same-file @derive(Eq) companion (synthesized
    // by this same transform pass) is invisible to a plain scan. resolveInstance's
    // getSynthesized(...) side-table is how it becomes visible — confirm
    // tryResolveTypeclassMethod (which goes through the identical resolveInstance
    // call as the operator path) sees it.
    const call = withContext(SYNTHESIZED_DERIVE_SOURCE, "consumer.ts", (ctx, sf, visit) => {
      scanImportsForScope(sf, globalResolutionScope, ctx.program);
      registerSynthesizedPointEq(ctx, sf);
      const node = lastExpressionStatement(sf);
      return tryResolveTypeclassMethod(ctx, false, visit, node);
    });

    expect(call).toBeDefined();
    const rewritten = call as ts.CallExpression;
    const pa = rewritten.expression as ts.PropertyAccessExpression;
    expect(ts.isPropertyAccessExpression(pa)).toBe(true);
    const instanceRef = pa.expression as ts.PropertyAccessExpression;
    expect(ts.isPropertyAccessExpression(instanceRef)).toBe(true);
    expect((instanceRef.expression as ts.Identifier).text).toBe("Point");
    expect(instanceRef.name.text).toBe("Eq");
    expect(pa.name.text).toBe("equals");
  });

  it("does NOT resolve the companion when it isn't registered as synthesized (proves the positive case above actually depends on getSynthesized)", () => {
    const call = withContext(SYNTHESIZED_DERIVE_SOURCE, "consumer.ts", (ctx, sf, visit) => {
      scanImportsForScope(sf, globalResolutionScope, ctx.program);
      // Deliberately NOT calling registerSynthesizedPointEq here.
      const node = lastExpressionStatement(sf);
      return tryResolveTypeclassMethod(ctx, false, visit, node);
    });

    expect(call).toBeUndefined();
  });

  it("never rewrites a built-in receiver's native method (e.g. Array.map)", () => {
    const source = [
      "/** @typeclass */",
      "interface Functor<F> {",
      "  map(fa: F, f: (a: unknown) => unknown): F;",
      "}",
      "declare const arr: number[];",
      "arr.map((x) => x);",
    ].join("\n");

    const call = withContext(source, "consumer.ts", (ctx, sf, visit) => {
      scanImportsForScope(sf, globalResolutionScope, ctx.program);
      const node = lastExpressionStatement(sf);
      return tryResolveTypeclassMethod(ctx, false, visit, node);
    });

    expect(call).toBeUndefined();
  });

  it("returns undefined for synthetic call expressions with no property access", () => {
    const synthetic = ts.factory.createCallExpression(
      ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("p"), "equals"),
      undefined,
      [ts.factory.createIdentifier("q")]
    );
    const call = withContext(`const _ = 1;`, "consumer.ts", (ctx, _sf, visit) => {
      return tryResolveTypeclassMethod(ctx, false, visit, synthetic);
    });
    expect(call).toBeUndefined();
  });
});
