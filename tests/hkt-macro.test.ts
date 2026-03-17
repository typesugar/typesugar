/**
 * Tests for the @hkt JSDoc macro (Tier 3: _ marker on type aliases).
 *
 * Verifies that `/** @hkt *​/ type FooF = Foo<_>` generates a correct
 * `interface FooF extends TypeFunction` with `this["__kind__"]` substitution.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "@typesugar/transformer/pipeline";
import { clearRegistries, clearSyntaxRegistry } from "@typesugar/macros";

beforeEach(() => {
  clearSyntaxRegistry();
  clearRegistries();
});

// ============================================================================
// @hkt Tier 3: type alias with _ marker
// ============================================================================

describe("@hkt type alias with _ marker", () => {
  it("generates TypeFunction interface for Array<_>", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type ArrayF = Array<_>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-array.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface ArrayF");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('this["__kind__"]');
    expect(result.code).not.toContain("type ArrayF");
  });

  it("generates TypeFunction interface for Map<K, _> with type parameter", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type MapF<K> = Map<K, _>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-map.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface MapF<K>");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('this["__kind__"]');
    expect(result.code).toContain("Map<K,");
  });

  it("generates TypeFunction interface for Promise<_>", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type PromiseF = Promise<_>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-promise.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface PromiseF");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('Promise<this["__kind__"]>');
  });

  it("generates TypeFunction interface for Set<_>", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type SetF = Set<_>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-set.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface SetF");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('Set<this["__kind__"]>');
  });

  it("preserves export modifier", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
export type ArrayF = Array<_>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-export.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("export interface ArrayF");
  });

  it("preserves constrained type parameters", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type MapF<K extends string> = Map<K, _>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-constrained.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface MapF<K extends string>");
    expect(result.code).toContain("extends TypeFunction");
  });
});

// ============================================================================
// @hkt error cases
// ============================================================================

describe("@hkt error cases", () => {
  it("reports TS9302 when type alias has no type params and no _ placeholder", () => {
    const code = `
/** @hkt */
type BadF = Array<number>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-no-underscore.ts" });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("TS9302");
  });

  it("reports TS9304 when type alias has multiple _ placeholders", () => {
    const code = `
import type { _ } from "@typesugar/type-system";
/** @hkt */
type PairF = [_, _];
    `.trim();

    const result = transformCode(code, { fileName: "hkt-multi-underscore.ts" });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("TS9304");
  });

  it("reports TS9302 when interface has no type parameters", () => {
    const code = `
/** @hkt */
interface EmptyF {}
    `.trim();

    const result = transformCode(code, { fileName: "hkt-no-params-interface.ts" });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].message).toContain("TS9302");
  });
});

// ============================================================================
// @hkt Tier 2: companion generation for parameterized types
// ============================================================================

describe("@hkt Tier 2 companion generation", () => {
  it("generates OptionF from Option<A> = A | null", () => {
    const code = `
/** @hkt */
type Option<A> = A | null;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-option.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("type Option<A> = A | null");
    expect(result.code).toContain("interface OptionF");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('this["__kind__"]');
    expect(result.code).toContain("Option<");
  });

  it("generates EitherF<E> from Either<E, A> (multi-arity, last param as hole)", () => {
    const code = `
interface Left<E> { readonly _tag: "Left"; readonly left: E; }
interface Right<A> { readonly _tag: "Right"; readonly right: A; }
/** @hkt */
type Either<E, A> = Left<E> | Right<A>;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-either.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("type Either<E, A>");
    expect(result.code).toContain("interface EitherF<E>");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('Either<E, this["__kind__"]>');
  });

  it("generates companion for interface with type params (NonEmptyList)", () => {
    const code = `
/** @hkt */
interface NonEmptyList<A> {
  readonly _tag: "NonEmptyList";
  readonly head: A;
}
    `.trim();

    const result = transformCode(code, { fileName: "hkt-nel.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface NonEmptyList<A>");
    expect(result.code).toContain("interface NonEmptyListF");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('NonEmptyList<this["__kind__"]>');
  });

  it("preserves export modifier on companion", () => {
    const code = `
/** @hkt */
export type Option<A> = A | null;
    `.trim();

    const result = transformCode(code, { fileName: "hkt-option-export.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("export type Option<A>");
    expect(result.code).toContain("export interface OptionF");
  });

  it("fixes all-but-last parameters correctly for State<S, A>", () => {
    const code = `
/** @hkt */
type State<S, A> = (s: S) => [A, S];
    `.trim();

    const result = transformCode(code, { fileName: "hkt-state.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("type State<S, A>");
    expect(result.code).toContain("interface StateF<S>");
    expect(result.code).toContain("extends TypeFunction");
    expect(result.code).toContain('State<S, this["__kind__"]>');
  });

  it("handles three type parameters (last as hole)", () => {
    const code = `
/** @hkt */
type Triple<A, B, C> = [A, B, C];
    `.trim();

    const result = transformCode(code, { fileName: "hkt-triple.ts" });

    expect(result.changed).toBe(true);
    expect(result.code).toContain("interface TripleF<A, B>");
    expect(result.code).toContain('Triple<A, B, this["__kind__"]>');
  });
});

// ============================================================================
// Wave 3: Tier 1 Implicit Resolution (@impl without @hkt)
// ============================================================================

describe("@impl Tier 1 implicit resolution", () => {
  it("@impl Functor<Option> works without explicit @hkt or OptionF (non-exported, zero-cost)", () => {
    const code = `
/** @typeclass */
interface Functor<F> {
  map: <A, B>(fa: any, f: (a: A) => B) => any;
}

type Option<A> = A | null;

/** @impl Functor<Option> */
const optionFunctor = {
  map: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> =>
    fa !== null ? f(fa) : null,
};
    `.trim();

    const result = transformCode(code, { fileName: "impl-option.ts" });

    expect(result.changed).toBe(true);
    // Non-exported typeclass: zero-cost, no registerInstance
    expect(result.code).not.toContain("registerInstance");
    expect(result.code).toContain("optionFunctor");
  });

  it("@impl Functor<Option> with exported typeclass generates runtime registry", () => {
    const code = `
/** @typeclass */
export interface Functor<F> {
  map: <A, B>(fa: any, f: (a: A) => B) => any;
}

type Option<A> = A | null;

/** @impl Functor<Option> */
const optionFunctor = {
  map: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> =>
    fa !== null ? f(fa) : null,
};
    `.trim();

    const result = transformCode(code, { fileName: "impl-option-exported.ts" });

    expect(result.changed).toBe(true);
    // Exported typeclass: generates registerInstance
    expect(result.code).toContain("registerInstance");
    expect(result.code).toContain("optionFunctor");
  });

  it("@impl Functor<Array> works for built-in types (non-exported, zero-cost)", () => {
    const code = `
/** @typeclass */
interface Functor<F> {
  map: <A, B>(fa: any, f: (a: A) => B) => any;
}

/** @impl Functor<Array> */
const arrayFunctor = {
  map: <A, B>(fa: Array<A>, f: (a: A) => B): Array<B> => fa.map(f),
};
    `.trim();

    const result = transformCode(code, { fileName: "impl-array.ts" });

    expect(result.changed).toBe(true);
    // Non-exported: zero-cost
    expect(result.code).not.toContain("registerInstance");
    expect(result.code).toContain("arrayFunctor");
  });

  it("@impl Functor<Either<string>> works with partial application (non-exported, zero-cost)", () => {
    const code = `
/** @typeclass */
interface Functor<F> {
  map: <A, B>(fa: any, f: (a: A) => B) => any;
}

type Either<E, A> = { _tag: "Left"; left: E } | { _tag: "Right"; right: A };

/** @impl Functor<Either<string>> */
const eitherStringFunctor = {
  map: <A, B>(fa: Either<string, A>, f: (a: A) => B): Either<string, B> =>
    fa._tag === "Right" ? { _tag: "Right", right: f(fa.right) } : fa,
};
    `.trim();

    const result = transformCode(code, { fileName: "impl-either-string.ts" });

    expect(result.changed).toBe(true);
    // Non-exported: zero-cost
    expect(result.code).not.toContain("registerInstance");
    expect(result.code).toContain("eitherStringFunctor");
  });

  it("parseTypeclassInstantiation handles nested brackets correctly (non-exported, zero-cost)", () => {
    const code = `
/** @typeclass */
interface Monad<F> {
  pure: <A>(a: A) => any;
  flatMap: <A, B>(fa: any, f: (a: A) => any) => any;
  map: <A, B>(fa: any, f: (a: A) => B) => any;
  ap: <A, B>(fab: any, fa: any) => any;
}

type Either<E, A> = { _tag: "Left"; left: E } | { _tag: "Right"; right: A };

/** @impl Monad<Either<string>> */
const eitherStringMonad = {
  pure: <A>(a: A): Either<string, A> => ({ _tag: "Right", right: a }),
  flatMap: <A, B>(fa: Either<string, A>, f: (a: A) => Either<string, B>): Either<string, B> =>
    fa._tag === "Right" ? f(fa.right) : fa,
  map: <A, B>(fa: Either<string, A>, f: (a: A) => B): Either<string, B> =>
    fa._tag === "Right" ? { _tag: "Right", right: f(fa.right) } : fa,
  ap: <A, B>(fab: Either<string, (a: A) => B>, fa: Either<string, A>): Either<string, B> =>
    fab._tag === "Right" && fa._tag === "Right"
      ? { _tag: "Right", right: fab.right(fa.right) }
      : fab._tag === "Left" ? fab : fa as Either<string, B>,
};
    `.trim();

    const result = transformCode(code, { fileName: "impl-monad-either.ts" });

    expect(result.changed).toBe(true);
    // Non-exported: zero-cost
    expect(result.code).not.toContain("registerInstance");
    expect(result.code).toContain("eitherStringMonad");
  });

  it("still works with explicit OptionF (backward compatibility, non-exported)", () => {
    const code = `
import type { _ } from "@typesugar/type-system";

/** @typeclass */
interface Functor<F> {
  map: <A, B>(fa: any, f: (a: A) => B) => any;
}

/** @hkt */
type OptionF = (number | null)<_>;

/** @impl Functor<OptionF> */
const optionFunctor = {
  map: <A, B>(fa: any, f: (a: A) => B) => null,
};
    `.trim();

    const result = transformCode(code, { fileName: "impl-optionf-compat.ts" });

    expect(result.changed).toBe(true);
    // Non-exported: zero-cost
    expect(result.code).not.toContain("registerInstance");
    expect(result.code).toContain("optionFunctor");
  });
});
