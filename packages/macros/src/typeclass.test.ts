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
 */

import { describe, it, expect, afterEach } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { registerHKTExpansion, getHKTExpansionForTest } from "./typeclass.js";
import { withDerivationContext, setCoverageHooks } from "./typeclass.js";
import { isHktTypeclass, getTypeclassDef } from "./typeclass-index.js";

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
