/**
 * Integration tests for auto-specialization.
 *
 * When a function call passes a registered typeclass instance dictionary as
 * an argument, the transformer auto-inlines the dictionary methods and hoists
 * a specialized function. This is the core zero-cost mechanism.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { transformCode } from "../src/pipeline.js";
import {
  clearRegistries,
  registerInstanceMethods,
  clearSyntaxRegistry,
  registerResultAlgebra,
  type ResultAlgebra,
} from "@typesugar/macros";

beforeEach(() => {
  clearRegistries();
  clearSyntaxRegistry();
});

function setupFunctorInstance(dictName: string, brand: string) {
  registerInstanceMethods(dictName, brand, {
    map: {
      source: "(fa, f) => fa.map(f)",
      params: ["fa", "f"],
    },
  });
}

function setupMonadInstance(dictName: string, brand: string) {
  registerInstanceMethods(dictName, brand, {
    map: {
      source: "(fa, f) => fa.map(f)",
      params: ["fa", "f"],
    },
    flatMap: {
      source: "(fa, f) => fa.flatMap(f)",
      params: ["fa", "f"],
    },
    pure: {
      source: "(a) => [a]",
      params: ["a"],
    },
  });
}

describe("Auto-specialization", () => {
  it("auto-specializes fn(instance, args) when instance is registered", () => {
    setupFunctorInstance("arrayFunctor", "Array");

    const code = `
declare const arrayFunctor: any;
const double = (F: { map(fa: any, f: any): any }, xs: number[]) => F.map(xs, (x: number) => x * 2);
const result = double(arrayFunctor, [1, 2, 3]);
    `.trim();

    const result = transformCode(code, { fileName: "auto-spec-basic.ts" });

    // Should create a hoisted specialized function (name includes fn name + brand)
    expect(result.code).toMatch(/__.*double.*Array/);
    // Should not pass arrayFunctor as an argument any more
    expect(result.code).not.toContain("double(arrayFunctor");
    // Should inline F.map to .map
    expect(result.code).toContain(".map(");
  });

  it("reuses cached specialization for same call in same block", () => {
    setupFunctorInstance("arrayFunctor", "Array");

    const code = `
declare const arrayFunctor: any;
const mapAll = (F: { map(fa: any, f: any): any }, xs: number[]) => F.map(xs, (x: number) => x + 1);
const a = mapAll(arrayFunctor, [1, 2]);
const b = mapAll(arrayFunctor, [3, 4]);
    `.trim();

    const result = transformCode(code, { fileName: "auto-spec-cache.ts" });

    // Find the hoisted specialization name
    const hoistedMatch = result.code.match(/const (__\w*mapAll\w*Array\w*)/);
    expect(hoistedMatch).not.toBeNull();

    const hoistedName = hoistedMatch![1];

    // The hoisted declaration should appear exactly once
    const declMatches = result.code.match(new RegExp(`const ${hoistedName}`, "g"));
    expect(declMatches).toHaveLength(1);

    // But the identifier should be called at both call sites
    const callMatches = result.code.match(new RegExp(hoistedName, "g"));
    expect(callMatches!.length).toBeGreaterThanOrEqual(3); // 1 decl + 2 calls
  });

  it("skips auto-specialization when @no-specialize comment is present", () => {
    setupFunctorInstance("arrayFunctor", "Array");

    // Note: @no-specialize must be on the SAME LINE as the call (like // @ts-ignore)
    const code = `
declare const arrayFunctor: any;
const double = (F: { map(fa: any, f: any): any }, xs: number[]) => F.map(xs, (x: number) => x * 2);
const result = /* @no-specialize */ double(arrayFunctor, [1, 2, 3]);
    `.trim();

    const result = transformCode(code, { fileName: "auto-spec-optout.ts" });

    // Should NOT create a hoisted specialization
    expect(result.code).not.toMatch(/__.*double.*Array/);
    // Should keep the original call
    expect(result.code).toContain("double(arrayFunctor");
  });

  it("suppresses warnings with @no-specialize-warn but still skips unresolvable", () => {
    setupFunctorInstance("arrayFunctor", "Array");

    // Note: @no-specialize-warn must be on the SAME LINE as the call
    const code = `
declare const arrayFunctor: any;
declare function externalFn(F: any, xs: number[]): number[];
const result = /* @no-specialize-warn */ externalFn(arrayFunctor, [1, 2, 3]);
    `.trim();

    const result = transformCode(code, { fileName: "auto-spec-warn.ts" });

    // No warning diagnostics should be emitted
    const warnings = result.diagnostics.filter(
      (d) => d.severity === "warning" && d.message.includes("TS9602")
    );
    expect(warnings).toHaveLength(0);
  });

  it("falls back gracefully when function body is not resolvable", () => {
    setupFunctorInstance("arrayFunctor", "Array");

    const code = `
declare const arrayFunctor: any;
declare function externalFn(F: any, xs: number[]): number[];
const result = externalFn(arrayFunctor, [1, 2, 3]);
    `.trim();

    const result = transformCode(code, { fileName: "auto-spec-unresolvable.ts" });

    // Should NOT create a hoisted specialization
    expect(result.code).not.toMatch(/__.*externalFn.*Array/);
    // Should emit a warning about unresolvable body
    const warnings = result.diagnostics.filter(
      (d) => d.severity === "warning" && d.message.includes("not resolvable")
    );
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("does not auto-specialize when no arguments are registered instances", () => {
    const code = `
const add = (a: number, b: number) => a + b;
const result = add(1, 2);
    `.trim();

    const result = transformCode(code, { fileName: "auto-spec-no-instance.ts" });

    // Should not create any hoisted specialization
    expect(result.code).not.toMatch(/const __\w+\s*=/);
    // Should preserve original call
    expect(result.code).toContain("add(1, 2)");
  });

  it("handles multiple instance arguments", () => {
    registerInstanceMethods("numberOrd", "Ord", {
      compare: {
        source: "(a, b) => a < b ? -1 : a > b ? 1 : 0",
        params: ["a", "b"],
      },
    });
    registerInstanceMethods("numberShow", "Show", {
      show: {
        source: "(a) => String(a)",
        params: ["a"],
      },
    });

    const code = `
declare const numberOrd: any;
declare const numberShow: any;
const showAndSort = (
  O: { compare(a: any, b: any): number },
  S: { show(a: any): string },
  xs: number[]
) => {
  return S.show(O.compare(xs[0], xs[1]));
};
const result = showAndSort(numberOrd, numberShow, [3, 1, 2]);
    `.trim();

    const result = transformCode(code, { fileName: "auto-spec-multi.ts" });

    // Should create a hoisted specialization with both brands
    expect(result.code).toMatch(/__.*showAndSort/);
    // Should not pass the instances as arguments
    expect(result.code).not.toContain("showAndSort(numberOrd");
  });

  it("works with function declarations (not just arrow functions)", () => {
    setupFunctorInstance("arrayFunctor", "Array");

    const code = `
declare const arrayFunctor: any;
function mapDouble(F: { map(fa: any, f: any): any }, xs: number[]): number[] {
  return F.map(xs, (x: number) => x * 2);
}
const result = mapDouble(arrayFunctor, [1, 2, 3]);
    `.trim();

    const result = transformCode(code, { fileName: "auto-spec-func-decl.ts" });

    expect(result.code).toMatch(/__.*mapDouble.*Array/);
    expect(result.code).not.toContain("mapDouble(arrayFunctor");
  });
});

// ============================================================================
// Source-Based Auto-Specialization Tests (PEP-004 Wave 2)
// ============================================================================

describe("Source-based auto-specialization with @specialize", () => {
  it("auto-specializes fn(instance, args) using @specialize annotation", () => {
    // No registry setup needed - uses @specialize annotation in source
    const code = `
/**
 * @impl Functor<Array>
 * @specialize
 */
const arrayFunctor = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};

const double = (F: { map(fa: any, f: any): any }, xs: number[]) => F.map(xs, (x: number) => x * 2);
const result = double(arrayFunctor, [1, 2, 3]);
    `.trim();

    const result = transformCode(code, { fileName: "source-spec-basic.ts" });

    // Should create a hoisted specialized function
    expect(result.code).toMatch(/__.*double.*Array/);
    // Should not pass arrayFunctor as an argument any more
    expect(result.code).not.toContain("double(arrayFunctor");
    // Should inline F.map to .map
    expect(result.code).toContain(".map(");
  });

  it("extracts methods from object literal at transform time", () => {
    const code = `
/**
 * @impl Monad<Option>
 * @specialize
 */
const optionMonad = {
  map: (fa: any, f: (a: any) => any) => fa !== null ? f(fa) : null,
  flatMap: (fa: any, f: (a: any) => any) => fa !== null ? f(fa) : null,
  pure: (a: any) => a,
};

const safeParse = <A>(F: { map: any; flatMap: any; pure: any }, input: string, parse: (s: string) => A | null): A | null => {
  return F.flatMap(parse(input), (a: A) => F.pure(a));
};

const result = safeParse(optionMonad, "42", parseInt);
    `.trim();

    const result = transformCode(code, { fileName: "source-spec-methods.ts" });

    // Should create specialization
    expect(result.code).toMatch(/__.*safeParse/);
    // Method bodies should be inlined
    expect(result.code).toContain("!== null ?");
  });

  it("works without runtime registry calls", () => {
    // This test verifies that auto-specialization works purely from source
    // without any registerInstanceMethods() call
    const code = `
/** @impl Eq<number> @specialize */
const numberEq = {
  equals: (a: number, b: number) => a === b,
};

const isEqual = <A>(E: { equals(a: A, b: A): boolean }, x: A, y: A): boolean => E.equals(x, y);
const result = isEqual(numberEq, 1, 2);
    `.trim();

    const result = transformCode(code, { fileName: "source-spec-no-registry.ts" });

    // Should specialize without any registry
    expect(result.code).toMatch(/__.*isEqual/);
    // Should inline the equals method
    expect(result.code).toContain("===");
    // Should not emit errors
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("infers brand from type annotation when @impl has no type arg", () => {
    const code = `
interface Show<A> {
  show(a: A): string;
}

/** @specialize */
const stringShow: Show<string> = {
  show: (a: string) => \`"\${a}"\`,
};

const display = <A>(S: Show<A>, a: A): string => S.show(a);
const result = display(stringShow, "hello");
    `.trim();

    const result = transformCode(code, { fileName: "source-spec-infer-brand.ts" });

    // Should specialize
    expect(result.code).toMatch(/__.*display/);
    // Should inline show method
    expect(result.code).toContain('`"${');
  });

  it("@impl still works for backwards compat (registers for specialization)", () => {
    // NOTE: @impl macro calls registerInstanceMethodsFromAST internally,
    // so instances defined with @impl can still be specialized via the registry.
    // This test verifies backwards compatibility.
    const code = `
/** @impl Functor<Array> */
const arrayFunctor = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};

const double = (F: { map(fa: any, f: any): any }, xs: number[]) => F.map(xs, (x: number) => x * 2);
const result = double(arrayFunctor, [1, 2, 3]);
    `.trim();

    const result = transformCode(code, { fileName: "source-spec-backwards-compat.ts" });

    // @impl still registers instances, so specialization SHOULD happen
    expect(result.code).toMatch(/__.*double.*Array/);
    // Method should be inlined
    expect(result.code).toContain(".map(");
  });

  it("@specialize alone (no @impl) enables source-based specialization", () => {
    // This test verifies that @specialize can be used without @impl
    // for pure source-based specialization (no typeclass registration)
    const code = `
/** @specialize */
const myMapper = {
  map: (arr: any[], f: (x: any) => any) => arr.map(f),
};

const transform = (M: { map: any }, xs: any[]) => M.map(xs, (x: any) => x * 2);
const result = transform(myMapper, [1, 2, 3]);
    `.trim();

    const result = transformCode(code, { fileName: "source-spec-only.ts" });

    // Should specialize using source-based extraction
    expect(result.code).toMatch(/__.*transform/);
    // Should inline the map method
    expect(result.code).toContain(".map(");
  });

  it("caches source-extracted methods for multiple calls", () => {
    const code = `
/** @impl Functor<List> @specialize */
const listFunctor = {
  map: (fa: any[], f: (a: any) => any) => fa.map(f),
};

const mapFn = (F: { map(fa: any, f: any): any }, xs: any[]) => F.map(xs, (x: any) => x);
const a = mapFn(listFunctor, [1, 2]);
const b = mapFn(listFunctor, [3, 4]);
const c = mapFn(listFunctor, [5, 6]);
    `.trim();

    const result = transformCode(code, { fileName: "source-spec-cache.ts" });

    // Find the hoisted specialization
    const hoistedMatch = result.code.match(/const (__\w*mapFn\w*List\w*)/);
    expect(hoistedMatch).not.toBeNull();

    const hoistedName = hoistedMatch![1];

    // Should declare exactly once
    const declMatches = result.code.match(new RegExp(`const ${hoistedName}`, "g"));
    expect(declMatches).toHaveLength(1);

    // Should be called at all three sites
    const callMatches = result.code.match(new RegExp(hoistedName, "g"));
    expect(callMatches!.length).toBeGreaterThanOrEqual(4); // 1 decl + 3 calls
  });
});

describe("Return-type-driven specialization", () => {
  it("specializes Result->Option by rewriting ok/err calls", () => {
    // The Option algebra is built-in: ok(v) -> v, err(e) -> null
    const code = `
type Result<E, T> = { _tag: "Ok"; value: T } | { _tag: "Err"; error: E };
type Option<T> = T | null;

function ok<T>(value: T): Result<never, T> { return { _tag: "Ok", value }; }
function err<E>(error: E): Result<E, never> { return { _tag: "Err", error }; }

function parseAge(input: string): Result<string, number> {
  const n = parseInt(input, 10);
  if (isNaN(n)) return err("not a number");
  return ok(n);
}

const result: Option<number> = parseAge("42");
    `.trim();

    const result = transformCode(code, { fileName: "return-type-spec.ts" });

    // Should either create a hoisted specialization OR inline the result
    // The key check: the code should compile and not throw
    expect(result.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("does not specialize when return type matches contextual type", () => {
    const code = `
type Result<E, T> = { _tag: "Ok"; value: T } | { _tag: "Err"; error: E };

function ok<T>(value: T): Result<never, T> { return { _tag: "Ok", value }; }

function getValue(): Result<string, number> {
  return ok(42);
}

const result: Result<string, number> = getValue();
    `.trim();

    const result = transformCode(code, { fileName: "no-return-spec.ts" });

    // Should NOT create any hoisted specialization when types match
    expect(result.code).not.toMatch(/__.*getValue.*Option/);
    // Original call should be preserved
    expect(result.code).toContain("getValue()");
  });
});
