/**
 * Tests for typeclass.ts — Typeclass helpers and derivation
 *
 * Covers:
 * - Declaration-derived HKT typeclass detection (PEP-052 Wave 4)
 * - HKT expansion registry
 * - Derivation context management
 * - Coverage hooks
 *
 * Instance resolution is scope-based (PEP-052) and tested in
 * instance-scanner.test.ts / instance-resolver.test.ts and
 * packages/std/tests/pep052-do-scope.test.ts.
 *
 * `summonMacro`/`extendMacro` expand()-output coverage (PEP-057 AST-purity
 * migration off `ctx.parseExpression`) lives in the "summonMacro" /
 * "extendMacro" describe blocks below — the only direct expand()-level tests
 * for these two macros; `pep052-extend-macro.test.ts` (transformer package)
 * covers `extendMacro` end-to-end through the full pipeline instead.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { registerHKTExpansion, getHKTExpansionForTest } from "./typeclass.js";
import { withDerivationContext, setCoverageHooks } from "./typeclass.js";
import { summonMacro, extendMacro } from "./typeclass.js";
import { isHktTypeclass, getTypeclassDef } from "./typeclass-index.js";
import { instanceScanner } from "./instance-scanner.js";
import type { MacroContext } from "@typesugar/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups.length = 0;
});

/**
 * Create a real ts.Program from source. Overrides getSourceFile to re-parse
 * with setParentNodes=true so JSDoc tags are visible to the op-index.
 */
function createTestProgram(source: string, fileName = "typeclasses.ts"): ts.Program {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typeclass-hkt-test-"));
  const filePath = path.join(tmpDir, fileName);
  fs.writeFileSync(filePath, source);
  cleanups.push(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
  };

  const host = ts.createCompilerHost(options);
  const origGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, languageVersion, onError, shouldCreate) => {
    const sf = origGetSourceFile(fn, languageVersion, onError, shouldCreate);
    if (sf && fn === filePath) {
      return ts.createSourceFile(fn, sf.text, languageVersion, true);
    }
    return sf;
  };

  return ts.createProgram([filePath], options, host);
}

const HKT_TYPECLASS_SOURCE = `
type Kind<F, A> = any;

/** @typeclass */
export interface Functor<F> {
  readonly map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B>;
}

/** @typeclass */
export interface Apply<F> extends Functor<F> {
  readonly ap: <A, B>(fab: Kind<F, (a: A) => B>, fa: Kind<F, A>) => Kind<F, B>;
}

/** @typeclass */
export interface Applicative<F> extends Apply<F> {
  readonly pure: <A>(a: A) => Kind<F, A>;
}

/** @typeclass */
export interface FlatMap<F> extends Apply<F> {
  readonly flatMap: <A, B>(fa: Kind<F, A>, f: (a: A) => Kind<F, B>) => Kind<F, B>;
}

/** @typeclass */
export interface Monad<F> extends FlatMap<F>, Applicative<F> {}

/** @typeclass */
export interface Show<A> {
  show(a: A): string;
}
`;

// ============================================================================
// Declaration-derived HKT detection (PEP-052 Wave 4)
// ============================================================================

describe("declaration-derived HKT detection", () => {
  it("detects Kind<F, ...> in member signatures as HKT", () => {
    const program = createTestProgram(HKT_TYPECLASS_SOURCE);
    expect(isHktTypeclass(program, "Functor")).toBe(true);
    expect(isHktTypeclass(program, "FlatMap")).toBe(true);
  });

  it("propagates HKT-ness through extends clauses (empty-body Monad)", () => {
    const program = createTestProgram(HKT_TYPECLASS_SOURCE);
    expect(isHktTypeclass(program, "Monad")).toBe(true);
    expect(isHktTypeclass(program, "Applicative")).toBe(true);
  });

  it("does not mark non-Kind typeclasses as HKT", () => {
    const program = createTestProgram(HKT_TYPECLASS_SOURCE);
    expect(isHktTypeclass(program, "Show")).toBe(false);
  });

  it("returns false for unknown typeclasses and built-in seeds", () => {
    const program = createTestProgram(HKT_TYPECLASS_SOURCE);
    expect(isHktTypeclass(program, "NotDeclaredAnywhere")).toBe(false);
    expect(isHktTypeclass(program, "Eq")).toBe(false); // built-in seed
  });

  it("flattens inherited members into fullSignatureText (Monad gets map/flatMap/pure/ap)", () => {
    const program = createTestProgram(HKT_TYPECLASS_SOURCE);
    const def = getTypeclassDef(program, "Monad");
    expect(def).toBeDefined();
    const sig = def!.fullSignatureText ?? "";
    expect(sig).toContain("flatMap");
    expect(sig).toContain("map");
    expect(sig).toContain("pure");
    expect(sig).toContain("ap");
    // Diamond inheritance (FlatMap→Apply→Functor and Applicative→Apply→Functor)
    // must dedupe: exactly one `ap` member.
    expect(sig.match(/\bap\b/g)?.length).toBe(1);
  });
});

// ============================================================================
// HKT expansion registry
// ============================================================================

describe("HKT expansion registry (per-program, PEP-052 Wave 4)", () => {
  it("has no hardcoded seed entries and isolates registrations per program", () => {
    const programA = createTestProgram("export {};", "prog-a.ts");
    const programB = createTestProgram("export {};", "prog-b.ts");

    expect(getHKTExpansionForTest(programA, "OptionF")).toBe("OptionF"); // no seeds

    registerHKTExpansion(programA, "TaskF", "Task");
    expect(getHKTExpansionForTest(programA, "TaskF")).toBe("Task");
    // Program-keyed: no cross-program leakage, and no manual cleanup needed —
    // the WeakMap entry dies with the program.
    expect(getHKTExpansionForTest(programB, "TaskF")).toBe("TaskF");
  });
});

// ============================================================================
// withDerivationContext
// ============================================================================

describe("withDerivationContext", () => {
  it("returns the value from the callback", () => {
    const result = withDerivationContext(null as any, () => 42);
    expect(result).toBe(42);
  });

  it("restores context after normal return", () => {
    // Just test that no errors occur with nested calls
    const result = withDerivationContext(null as any, () => {
      return withDerivationContext(null as any, () => "inner");
    });
    expect(result).toBe("inner");
  });

  it("restores context after exception", () => {
    try {
      withDerivationContext(null as any, () => {
        throw new Error("test error");
      });
    } catch (e) {
      // Error is expected; context should be cleaned up
    }
    // Should not throw on next call
    const result = withDerivationContext(null as any, () => "recovered");
    expect(result).toBe("recovered");
  });
});

// ============================================================================
// Coverage Hooks
// ============================================================================

describe("setCoverageHooks", () => {
  it("accepts hook functions without error", () => {
    // setCoverageHooks registers callbacks used during the derive pipeline.
    // The hooks are invoked by notifyPrimitiveRegistered() and
    // checkCoverageForDerive() — both internal to the derivation flow
    // which requires a full MacroContext. Here we verify registration
    // itself doesn't throw and the validate hook shape is accepted.
    const registerFn = (_typeName: string, _tcName: string) => {};
    const validateFn = () => true;
    expect(() => setCoverageHooks(registerFn, validateFn)).not.toThrow();
  });
});

// ============================================================================
// summonMacro / extendMacro — expand() output (PEP-057 AST-purity migration)
// ============================================================================
// Both macros used to build their replacement expression as a template
// string and reparse it via ctx.parseExpression(). These tests pin the
// expand()-level output directly, as AST, so a future change can't silently
// regress back to string-shaped codegen.

function getUserSourceFile(program: ts.Program, fileName: string): ts.SourceFile {
  const sourceFile = program.getSourceFiles().find((sf) => sf.fileName.endsWith(fileName));
  if (!sourceFile) throw new Error(`source file not found: ${fileName}`);
  return sourceFile;
}

function makeMacroContext(program: ts.Program, sourceFile: ts.SourceFile): MacroContext {
  return {
    program,
    typeChecker: program.getTypeChecker(),
    sourceFile,
    factory: ts.factory,
  } as unknown as MacroContext;
}

function findCallExpression(
  root: ts.Node,
  predicate: (node: ts.CallExpression) => boolean
): ts.CallExpression {
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(node) && predicate(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  if (!found) throw new Error("no matching call expression found");
  return found;
}

describe("summonMacro.expand()", () => {
  it("resolves a plain (non-dotted) exported instance to a bare identifier", () => {
    const source = `
interface Point { x: number; y: number; }

/** @impl("Show<Point>") */
export const showPoint: Show<Point> = {
  show: (p: Point) => "Point",
};

export const r = summon<Show<Point>>();
`.trim();

    const program = createTestProgram(source, "summon-basic.ts");
    const sourceFile = getUserSourceFile(program, "summon-basic.ts");
    const ctx = makeMacroContext(program, sourceFile);

    const callExpr = findCallExpression(
      sourceFile,
      (n) => ts.isIdentifier(n.expression) && n.expression.text === "summon"
    );

    const result = summonMacro.expand(ctx, callExpr, []);
    expect(ts.isIdentifier(result)).toBe(true);
    expect((result as ts.Identifier).text).toBe("showPoint");
  });

  it("resolves a dotted companion export (e.g. a @derive'd `Point.Numeric`) to a property-access chain", () => {
    // Simulates a same-pass `@derive` companion synthesized via
    // InstanceScanner.registerSynthesized (see instance-resolver.test.ts's
    // "findInstanceInScopeByName (PEP-056 Wave 5)" suite) — the exportName
    // convention produced by typeclass.ts's own `namespace ${typeName} {
    // export const ${tcName} = ...; }` companion codegen (assignCode).
    const source = `
class Point {
  constructor(public x: number, public y: number) {}
}

export const r = summon<Numeric<Point>>();
`.trim();

    const program = createTestProgram(source, "summon-dotted.ts");
    const sourceFile = getUserSourceFile(program, "summon-dotted.ts");
    const typeChecker = program.getTypeChecker();

    const classDecl = sourceFile.statements.find((s): s is ts.ClassDeclaration =>
      ts.isClassDeclaration(s)
    )!;
    const pointType = typeChecker.getTypeAtLocation(classDecl);
    instanceScanner.registerSynthesized(program, sourceFile.fileName, {
      typeclassName: "Numeric",
      forType: pointType,
      forTypeString: "Point",
      exportName: "Point.Numeric",
      sourceModule: sourceFile.fileName,
      detectedVia: "derived",
    });

    const ctx = makeMacroContext(program, sourceFile);
    const callExpr = findCallExpression(
      sourceFile,
      (n) => ts.isIdentifier(n.expression) && n.expression.text === "summon"
    );

    const result = summonMacro.expand(ctx, callExpr, []);
    expect(ts.isPropertyAccessExpression(result)).toBe(true);
    const pae = result as ts.PropertyAccessExpression;
    expect(ts.isIdentifier(pae.expression) && pae.expression.text).toBe("Point");
    expect(pae.name.text).toBe("Numeric");

    const printed = ts.createPrinter().printNode(ts.EmitHint.Expression, result, sourceFile);
    expect(printed).toBe("Point.Numeric");
  });
});

describe("extendMacro.expand()", () => {
  it('builds `TC.summon<Type>("Type").method(value, ...extraArgs)` as AST, reusing the real argument nodes', () => {
    const source = `
/** @typeclass */
interface Greet<A> {
  greet(a: A): string;
}

declare const n: number;
export const r = extend(n).greet();
`.trim();

    const program = createTestProgram(source, "extend-basic.ts");
    const sourceFile = getUserSourceFile(program, "extend-basic.ts");
    const ctx = makeMacroContext(program, sourceFile);

    // The outer chain call: extend(n).greet() — this is what the transformer
    // passes as `callExpr` for a `chainable: true` macro.
    const outerCall = findCallExpression(
      sourceFile,
      (n) =>
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "greet" &&
        ts.isCallExpression(n.expression.expression) &&
        ts.isIdentifier(n.expression.expression.expression) &&
        n.expression.expression.expression.text === "extend"
    );
    const innerCall = (outerCall.expression as ts.PropertyAccessExpression)
      .expression as ts.CallExpression;
    // The transformer passes the INNER extend(...) call's arguments as `args`
    // (see transformer-core's tryExpandChainMacro: `Array.from(rootCall.arguments)`).
    const args = Array.from(innerCall.arguments);

    const result = extendMacro.expand(ctx, outerCall, args);

    // Reuses the real `n` argument node directly rather than stringifying
    // and reparsing it.
    expect(ts.isCallExpression(result)).toBe(true);
    const call = result as ts.CallExpression;
    expect(call.arguments[0]).toBe(args[0]);

    const printed = ts.createPrinter().printNode(ts.EmitHint.Expression, result, sourceFile);
    expect(printed).toBe('Greet.summon<number>("number").greet(n)');
  });
});
