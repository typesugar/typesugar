/**
 * Tests for verify-laws.ts — @verifyLaws attribute macro
 *
 * Covers:
 * - getVerifyLawsConfig: default values; config.set overrides for mode,
 *   onUndecidable, propertyTestIterations.
 * - inferLawGenerator: returns mapped names for Eq/Ord/Semigroup/Monoid/
 *   Functor/Monad/etc.; undefined for unknown typeclasses.
 * - extractInstanceInfo: type-annotation extraction (typeclass name + first
 *   type arg); naming-convention fallback; rejects declarations without an
 *   identifier name and without a usable type annotation.
 * - parseVerifyLawsArgs: identifier (law generator), options object
 *   (eq/arbitrary/mode/strict), empty args.
 * - verifyLawsAttribute end-to-end: erasure mode (mode=false); the
 *   unimplemented compile-time / property-test modes erase the decorator and
 *   report that nothing was verified (never emitting code into the module);
 *   error reporting when type info is missing or no generator is inferable.
 * - capitalize: empty string, lowercase, already-capital, single char.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext, config } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";
import {
  verifyLawsAttribute,
  getVerifyLawsConfig,
  extractInstanceInfo,
  parseVerifyLawsArgs,
  inferLawGenerator,
  capitalize,
} from "./verify-laws.js";

// ---------------------------------------------------------------------------
// Helpers — build a ts.Program backed by a temp source file, then create a
// real MacroContext inside a transformer. This mirrors the pattern used in
// generic.test.ts and quote.test.ts.
// ---------------------------------------------------------------------------

interface ProgramFixture {
  program: ts.Program;
  sourceFile: ts.SourceFile;
  cleanup: () => void;
}

function makeProgram(source: string): ProgramFixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-laws-test-"));
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
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const sf = origGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    if (sf && fileName === filePath) {
      return ts.createSourceFile(fileName, sf.text, languageVersion, true);
    }
    return sf;
  };

  const program = ts.createProgram([filePath], options, host);
  const sourceFile = program.getSourceFile(filePath)!;
  return {
    program,
    sourceFile,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

/**
 * Run a transformer once, capturing the MacroContext for synchronous use.
 */
function withContext<T>(source: string, fn: (ctx: MacroContext, sf: ts.SourceFile) => T): T {
  const { program, sourceFile, cleanup } = makeProgram(source);
  try {
    let result: T | undefined;
    let captured = false;
    const transformerFactory: ts.TransformerFactory<ts.SourceFile> = (transformContext) => {
      const ctx = createMacroContext(program, sourceFile, transformContext);
      result = fn(ctx, sourceFile);
      captured = true;
      return (sf) => sf;
    };
    ts.transform(sourceFile, [transformerFactory]);
    if (!captured) {
      throw new Error("transformer did not run");
    }
    return result as T;
  } finally {
    cleanup();
  }
}

/**
 * Find the first top-level VariableStatement in the source file.
 */
function firstVarStatement(sf: ts.SourceFile): ts.VariableStatement {
  const v = sf.statements.find(ts.isVariableStatement);
  if (!v) throw new Error("no VariableStatement found in source");
  return v;
}

function printNodes(nodes: ts.Node[], sf: ts.SourceFile): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  return nodes.map((n) => printer.printNode(ts.EmitHint.Unspecified, n, sf)).join("\n");
}

// ---------------------------------------------------------------------------
// Config isolation — reset between tests so config.set() doesn't leak.
// ---------------------------------------------------------------------------

beforeEach(() => {
  config.reset();
});

afterEach(() => {
  config.reset();
});

// ===========================================================================
// getVerifyLawsConfig
// ===========================================================================

describe("getVerifyLawsConfig", () => {
  it("returns the default config when nothing is set", () => {
    const cfg = getVerifyLawsConfig();
    expect(cfg.mode).toBe(false);
    expect(cfg.onUndecidable).toBe("warn");
    expect(cfg.propertyTestIterations).toBe(100);
  });

  it("reflects cats.verifyLaws=compile-time from config.set", () => {
    config.set({ cats: { verifyLaws: "compile-time" } });
    expect(getVerifyLawsConfig().mode).toBe("compile-time");
  });

  it("reflects cats.verifyLaws=property-test and cats.propertyTestIterations", () => {
    config.set({
      cats: { verifyLaws: "property-test", propertyTestIterations: 25 },
    });
    const cfg = getVerifyLawsConfig();
    expect(cfg.mode).toBe("property-test");
    expect(cfg.propertyTestIterations).toBe(25);
  });

  it("reflects cats.onUndecidable override", () => {
    config.set({ cats: { onUndecidable: "error" } });
    expect(getVerifyLawsConfig().onUndecidable).toBe("error");
  });
});

// ===========================================================================
// inferLawGenerator
// ===========================================================================

describe("inferLawGenerator", () => {
  it("maps well-known typeclasses to their law generator names", () => {
    expect(inferLawGenerator("Eq")).toBe("eqLaws");
    expect(inferLawGenerator("Ord")).toBe("ordLaws");
    expect(inferLawGenerator("Semigroup")).toBe("semigroupLaws");
    expect(inferLawGenerator("Monoid")).toBe("monoidLaws");
    expect(inferLawGenerator("Functor")).toBe("functorLaws");
    expect(inferLawGenerator("Monad")).toBe("monadLaws");
    expect(inferLawGenerator("Foldable")).toBe("foldableLaws");
    expect(inferLawGenerator("Traverse")).toBe("traverseLaws");
    expect(inferLawGenerator("Applicative")).toBe("applicativeLaws");
    expect(inferLawGenerator("Alternative")).toBe("alternativeLaws");
  });

  it("returns undefined for unknown typeclasses", () => {
    expect(inferLawGenerator("NotARealTypeclass")).toBeUndefined();
    expect(inferLawGenerator("")).toBeUndefined();
  });

  it("is case-sensitive (lowercase 'monoid' is not mapped)", () => {
    expect(inferLawGenerator("monoid")).toBeUndefined();
  });
});

// ===========================================================================
// extractInstanceInfo
// ===========================================================================

describe("extractInstanceInfo", () => {
  it("extracts typeclass name and type arg from a typed const declaration", () => {
    const info = withContext(
      `const fooEq: Eq<Foo> = { eq: (_a: Foo, _b: Foo) => true };`,
      (ctx, sf) => extractInstanceInfo(ctx, firstVarStatement(sf))
    );
    expect(info).toBeDefined();
    expect(info!.instanceName).toBe("fooEq");
    expect(info!.typeclassName).toBe("Eq");
    expect(info!.forType).toBe("Foo");
  });

  it("extracts HKT-style type argument (e.g. Monad<OptionF>)", () => {
    const info = withContext(`const optionMonad: Monad<OptionF> = {} as any;`, (ctx, sf) =>
      extractInstanceInfo(ctx, firstVarStatement(sf))
    );
    expect(info!.typeclassName).toBe("Monad");
    expect(info!.forType).toBe("OptionF");
  });

  it("falls back to naming-convention parsing when no type annotation is present", () => {
    const info = withContext(`const semigroupNumber = { combine: (x, y) => x + y };`, (ctx, sf) =>
      extractInstanceInfo(ctx, firstVarStatement(sf))
    );
    expect(info).toBeDefined();
    expect(info!.instanceName).toBe("semigroupNumber");
    // capitalize("semigroup") → "Semigroup"
    expect(info!.typeclassName).toBe("Semigroup");
    expect(info!.forType).toBe("number");
  });

  it("matches the eqString pattern via naming convention", () => {
    const info = withContext(`const eqString = { eq: (a, b) => a === b };`, (ctx, sf) =>
      extractInstanceInfo(ctx, firstVarStatement(sf))
    );
    expect(info!.typeclassName).toBe("Eq");
    expect(info!.forType).toBe("string");
  });

  it("returns undefined when the type annotation has no type arguments", () => {
    // Type annotation present but `MyTypeclass` lacks type arguments → falls
    // through to naming-convention fallback; the name does not match any
    // pattern, so undefined is returned.
    const info = withContext(`const myInst: MyTypeclass = {} as any;`, (ctx, sf) =>
      extractInstanceInfo(ctx, firstVarStatement(sf))
    );
    expect(info).toBeUndefined();
  });

  it("returns undefined for a non-variable declaration", () => {
    const info = withContext(`function notAnInstance() {}`, (ctx, sf) => {
      const fn = sf.statements.find(ts.isFunctionDeclaration)!;
      return extractInstanceInfo(ctx, fn);
    });
    expect(info).toBeUndefined();
  });

  it("returns undefined for a destructured declaration (no identifier name)", () => {
    const info = withContext(`const { foo } = obj;`, (ctx, sf) =>
      extractInstanceInfo(ctx, firstVarStatement(sf))
    );
    expect(info).toBeUndefined();
  });
});

// ===========================================================================
// parseVerifyLawsArgs
// ===========================================================================

describe("parseVerifyLawsArgs", () => {
  // Build args by parsing a synthetic decorator expression. Using a real
  // call expression keeps the ts.Identifier/ObjectLiteralExpression nodes
  // exactly as the macro would receive them at runtime.
  function parseDecoratorArgs(decoratorCall: string): readonly ts.Expression[] {
    return withContext(
      // Apply the decorator to a throwaway class so the call expression is
      // well-formed when parsed by the TypeScript parser.
      `${decoratorCall}\nclass __X {}`,
      (_ctx, sf) => {
        const cls = sf.statements.find(ts.isClassDeclaration)!;
        const decorators = ts.getDecorators(cls);
        if (!decorators || decorators.length === 0) {
          throw new Error("decorator not parsed");
        }
        const expr = decorators[0].expression;
        if (!ts.isCallExpression(expr)) {
          // A bare-identifier decorator has no args
          return [] as readonly ts.Expression[];
        }
        // Detach arguments so they survive the transform teardown
        return expr.arguments.map((a) => a);
      }
    );
  }

  function ctxOnly<T>(fn: (ctx: MacroContext) => T): T {
    return withContext("export {};", (ctx) => fn(ctx));
  }

  it("returns empty result for empty args", () => {
    const parsed = ctxOnly((ctx) => parseVerifyLawsArgs(ctx, []));
    expect(parsed).toEqual({});
  });

  it("parses a single identifier as the law generator", () => {
    const args = parseDecoratorArgs(`@verifyLaws(semigroupLaws)`);
    const parsed = ctxOnly((ctx) => parseVerifyLawsArgs(ctx, args));
    expect(parsed.lawGenerator).toBe("semigroupLaws");
  });

  it("parses { eq, arbitrary } from an options object", () => {
    const args = parseDecoratorArgs(`@verifyLaws({ eq: eqNumber, arbitrary: arbNumber })`);
    const parsed = ctxOnly((ctx) => parseVerifyLawsArgs(ctx, args));
    expect(parsed.eq).toBe("eqNumber");
    expect(parsed.arbitrary).toBe("arbNumber");
  });

  it("parses mode: false and strict: true from an options object", () => {
    const args = parseDecoratorArgs(`@verifyLaws({ mode: false, strict: true })`);
    const parsed = ctxOnly((ctx) => parseVerifyLawsArgs(ctx, args));
    expect(parsed.mode).toBe(false);
    expect(parsed.strict).toBe(true);
  });

  it("parses mode as a string literal", () => {
    const args = parseDecoratorArgs(`@verifyLaws({ mode: "property-test" })`);
    const parsed = ctxOnly((ctx) => parseVerifyLawsArgs(ctx, args));
    expect(parsed.mode).toBe("property-test");
  });

  it("combines a positional law-generator identifier with an options object", () => {
    const args = parseDecoratorArgs(
      `@verifyLaws(semigroupLaws, { eq: eqNumber, arbitrary: arbNumber })`
    );
    const parsed = ctxOnly((ctx) => parseVerifyLawsArgs(ctx, args));
    expect(parsed.lawGenerator).toBe("semigroupLaws");
    expect(parsed.eq).toBe("eqNumber");
    expect(parsed.arbitrary).toBe("arbNumber");
  });

  it("ignores malformed property values (non-identifier eq)", () => {
    const args = parseDecoratorArgs(`@verifyLaws({ eq: 42 })`);
    const parsed = ctxOnly((ctx) => parseVerifyLawsArgs(ctx, args));
    expect(parsed.eq).toBeUndefined();
  });
});

// ===========================================================================
// capitalize
// ===========================================================================

describe("capitalize", () => {
  it("returns an empty string unchanged", () => {
    // NaN is produced from "".charAt(0).toUpperCase() but that's still "".
    expect(capitalize("")).toBe("");
  });

  it("capitalizes the first letter of a lowercase word", () => {
    expect(capitalize("foo")).toBe("Foo");
    expect(capitalize("monoid")).toBe("Monoid");
  });

  it("leaves an already-capitalized word unchanged", () => {
    expect(capitalize("Foo")).toBe("Foo");
  });

  it("handles single characters", () => {
    expect(capitalize("a")).toBe("A");
    expect(capitalize("Z")).toBe("Z");
  });
});

// ===========================================================================
// verifyLawsAttribute (end-to-end)
// ===========================================================================

describe("verifyLawsAttribute (end-to-end)", () => {
  it("declares the expected macro metadata", () => {
    expect(verifyLawsAttribute.name).toBe("verifyLaws");
    expect(verifyLawsAttribute.module).toBe("typesugar");
    expect(verifyLawsAttribute.kind).toBe("attribute");
    expect(verifyLawsAttribute.validTargets).toContain("property");
    expect(verifyLawsAttribute.validTargets).toContain("class");
  });

  /**
   * Run the attribute macro against the first VariableStatement in `source`,
   * with `decoratorArgs` substituted into a synthetic decorator. Returns the
   * normalized node array and a printed concatenation for substring checks.
   */
  function runAttribute(
    source: string,
    decoratorArgs: readonly ts.Expression[] = []
  ): {
    nodes: ts.Node[];
    printed: string;
    diagnostics: ReturnType<MacroContext["getDiagnostics"]>;
  } {
    return withContext(source, (ctx, sf) => {
      const target = firstVarStatement(sf);
      const decorator = ts.factory.createDecorator(ts.factory.createIdentifier("verifyLaws"));
      const result = verifyLawsAttribute.expand(ctx, decorator, target, decoratorArgs);
      const nodes = Array.isArray(result) ? result : [result];
      return {
        nodes,
        printed: printNodes(nodes, sf),
        diagnostics: ctx.getDiagnostics(),
      };
    });
  }

  it("erases the decorator when mode is false (default)", () => {
    // No config set → mode === false → strip decorator and emit nothing else
    const { nodes, diagnostics } = runAttribute(`const fooEq: Eq<Foo> = {} as any;`);
    expect(nodes).toHaveLength(1);
    expect(diagnostics).toHaveLength(0);
  });

  it("mode='compile-time' is not implemented: erases and warns, emits no code", () => {
    config.set({ cats: { verifyLaws: "compile-time" } });
    const { nodes, printed, diagnostics } = runAttribute(
      `const myMonoid: Monoid<number> = {} as any;`
    );
    // Only the stripped target — the old IIFE called an unimported law
    // generator at module load (ReferenceError on import) and verified nothing.
    expect(nodes).toHaveLength(1);
    expect(printed).not.toContain("monoidLaws");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toMatch(/not implemented/);
  });

  it("mode='property-test' never splices describe/it into the production module", () => {
    config.set({
      cats: { verifyLaws: "property-test", propertyTestIterations: 7 },
    });
    const { nodes, printed, diagnostics } = runAttribute(
      `const myMonoid: Monoid<number> = {} as any;`
    );
    expect(nodes).toHaveLength(1);
    expect(printed).not.toContain("describe(");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/not implemented/);
  });

  it("a per-decorator { mode: false } overrides the config and erases silently", () => {
    config.set({ cats: { verifyLaws: "compile-time" } });
    const opts = ts.factory.createObjectLiteralExpression([
      ts.factory.createPropertyAssignment("mode", ts.factory.createFalse()),
    ]);
    const { nodes, diagnostics } = runAttribute(`const myMonoid: Monoid<number> = {} as any;`, [
      opts,
    ]);
    expect(nodes).toHaveLength(1);
    expect(diagnostics).toHaveLength(0);
  });

  it("{ strict: true } turns the not-implemented warning into an error", () => {
    config.set({ cats: { verifyLaws: "compile-time" } });
    const opts = ts.factory.createObjectLiteralExpression([
      ts.factory.createPropertyAssignment("strict", ts.factory.createTrue()),
    ]);
    const { diagnostics } = runAttribute(`const myMonoid: Monoid<number> = {} as any;`, [opts]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("reports an error when the instance type cannot be determined", () => {
    config.set({ cats: { verifyLaws: "compile-time" } });
    // No type annotation and the name doesn't match any naming convention.
    const { diagnostics } = runAttribute(`const arbitraryName = {} as any;`);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toMatch(/could not determine the instance type/);
  });

  it("reports an error when no law generator can be inferred", () => {
    config.set({ cats: { verifyLaws: "compile-time" } });
    // Typeclass name 'NotATypeclass' is not in the inference map and no
    // explicit law generator is passed.
    const { diagnostics } = runAttribute(`const myInst: NotATypeclass<number> = {} as any;`);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toMatch(/no law generator found/);
  });

  it("uses an explicit law generator argument over inference", () => {
    config.set({ cats: { verifyLaws: "compile-time" } });
    // 'NotATypeclass' has no inferred generator, but we pass one explicitly.
    const lawGen = ts.factory.createIdentifier("customLaws");
    const { printed, diagnostics } = runAttribute(
      `const myInst: NotATypeclass<number> = {} as any;`,
      [lawGen]
    );
    // Generator resolved (no "no law generator found" error); only the
    // not-implemented warning remains.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("customLaws");
    expect(printed).not.toContain("customLaws(");
  });
});
