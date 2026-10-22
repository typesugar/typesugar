/**
 * Macro tests for @typesugar/type-system, run through the real transformer.
 */
import { describe, it, expect } from "vitest";
import { expand, run, typeErrors } from "./helpers.js";

describe("TSP-1: macros are scoped to @typesugar/type-system", () => {
  it("does not rewrite a foreign `refine` import", () => {
    const { code, errors } = expand(`import { refine } from "superstruct";
declare const a: any;
export const r = refine(a, "Name", (v: string) => v.length > 0);
`);
    expect(errors).toEqual([]);
    expect(code).toContain(`refine(a, "Name", (v: string) => v.length > 0)`);
    expect(code).not.toContain("a.refine(");
  });

  it("does not rewrite an undeclared `refine`", () => {
    const { code } = expand(`declare const schema: any; declare const check: any;
export const r = (refine as any)(schema, check);
export const s = refine(schema, check);
`);
    expect(code).not.toContain("schema.refine(");
  });

  it("does not touch a foreign type named Max / Lt", () => {
    const { code, errors } = expand(`import type { Max, Lt } from "some-lib";
export type M = Max<[1, 2, 3]>;
export type L = Lt<1, 2>;
`);
    expect(errors).toEqual([]);
    expect(code).toMatch(/Max<\[\s*1,\s*2,\s*3\s*\]>/);
    expect(code).toContain("Lt<1, 2>");
  });

  it("still evaluates arithmetic types imported from @typesugar/type-system", () => {
    const { code, errors } =
      expand(`import type { Add, Mul, Lt, IsEven } from "@typesugar/type-system";
export type S = Add<3, 4>;
export type P = Mul<3, 4>;
export type L = Lt<1, 2>;
export type E = IsEven<4>;
`);
    expect(errors).toEqual([]);
    expect(code).toMatch(/type S = 7/);
    expect(code).toMatch(/type P = 12/);
    expect(code).toMatch(/type L = true/);
    expect(code).toMatch(/type E = true/);
  });

  it("every arithmetic macro name is importable from the runtime entry", () => {
    const names = [
      "Add",
      "Sub",
      "Mul",
      "Div",
      "Mod",
      "Pow",
      "Negate",
      "Abs",
      "Max",
      "Min",
      "Lt",
      "Lte",
      "Gt",
      "Gte",
      "NumEq",
      "Increment",
      "Decrement",
      "IsEven",
      "IsOdd",
    ];
    const errs = typeErrors(`import type { ${names.join(", ")} } from "@typesugar/type-system";
export type T = [${names.map((n) => (["Negate", "Abs", "Increment", "Decrement", "IsEven", "IsOdd"].includes(n) ? `${n}<1>` : `${n}<4, 2>`)).join(", ")}];
`);
    expect(errs).toEqual([]);
  });
});

describe("TSP-3: packExists evaluates its witness once", () => {
  it("does not re-evaluate the argument on every use", () => {
    const { code, errors } = expand(`import { packExists, useExists } from "@typesugar/type-system";
let n = 0;
const p = packExists({ v: n++ });
useExists(p, (w: any) => w.v);
useExists(p, (w: any) => w.v);
export const count = n;
export const same = useExists(p, (w: any) => w) === useExists(p, (w: any) => w);
`);
    expect(errors).toEqual([]);
    const out = run(code);
    expect(out.count).toBe(1);
    expect(out.same).toBe(true);
  });
});

describe("packExists keeps the existential's type in the expansion", () => {
  // `typesugar check --strict` in type-system: `return packExists({...} as
  // ShowWitness<unknown>)` in a function returning `Exists<ShowWitness<unknown>>`
  // expanded to `(w => ({ use: f => f(w) }))(...)`, whose type has no
  // `__exists_brand__` (TS2741) — the runtime packExists asserts `as Exists<W>`.
  it("the expanded code type-checks where the result is an Exists", () => {
    const { code, errors } =
      expand(`import { packExists, useExists, type Exists } from "@typesugar/type-system";
interface ShowWitness<T> { readonly value: T; readonly show: (t: T) => string }
export function showable<T>(value: T, show: (t: T) => string): Exists<ShowWitness<unknown>> {
  return packExists({ value, show } as ShowWitness<unknown>);
}
export const shown = useExists(showable(42, String), ({ value, show }) => show(value));
`);
    expect(errors).toEqual([]);
    expect(typeErrors(code)).toEqual([]);
    expect(run(code).shown).toBe("42");
  });

  it("asserts nothing when the type has no name at the call site", () => {
    const { code, errors } = expand(`import { packExists } from "@typesugar/type-system";
export const p = packExists({ v: 1 });
`);
    expect(errors).toEqual([]);
    expect(code).not.toContain("import(");
    expect(typeErrors(code)).toEqual([]);
  });
});

describe("TSP-5: @pure / @effect checking", () => {
  it("reports a @pure function calling an @effect function", () => {
    const { errors } = expand(`import { pure, effect } from "@typesugar/type-system";
@effect("io") function log(msg: string) { console.log(msg); }
@pure function f() { log("x"); return 1; }
export { f };
`);
    expect(errors.join("\n")).toMatch(/@pure function 'f' cannot call .*'log'/);
  });

  it("is order-independent (callee declared after the caller)", () => {
    const { errors } = expand(`import { pure, effect } from "@typesugar/type-system";
@pure function f() { log("x"); return 1; }
@effect("io") function log(msg: string) { console.log(msg); }
export { f };
`);
    expect(errors.join("\n")).toMatch(/cannot call/);
  });

  it("does not match an unrelated method with the same name", () => {
    const { errors } = expand(`import { pure, effect } from "@typesugar/type-system";
@effect("io") function save() {}
const store = { save: () => 1 };
@pure function f() { return store.save(); }
export { f };
`);
    expect(errors).toEqual([]);
  });

  it("reports undeclared effects in an @effect caller", () => {
    const { errors } = expand(`import { effect } from "@typesugar/type-system";
@effect("io") function log(msg: string) { console.log(msg); }
@effect("async") function g() { log("x"); }
export { g };
`);
    expect(errors.join("\n")).toMatch(/not declared in 'g'/);
  });
});

describe("TSP-11: @existential codegen", () => {
  const SRC = `import { existential } from "@typesugar/type-system";
@existential
interface Handler<T> {
  value: T;
  show(v: T): string;
}
const h = packHandler({ value: 41, show: (v: number) => String(v + 1) });
export const shown = useHandler(h, (w) => w.show(w.value));
`;

  it("does not export helpers for a non-exported interface, and runs", () => {
    const { code, errors } = expand(SRC);
    expect(errors).toEqual([]);
    expect(code).not.toMatch(/export function packHandler/);
    expect(code).not.toMatch(/export type AnyHandler/);
    expect(run(code).shown).toBe("42");
  });

  it("exports helpers when the interface is exported", () => {
    const { code } = expand(SRC.replace("interface Handler", "export interface Handler"));
    expect(code).toMatch(/export function packHandler/);
    expect(code).toMatch(/export function useHandler/);
  });

  it("generated code type-checks", () => {
    const { code } = expand(SRC);
    expect(typeErrors(code)).toEqual([]);
  });
});

describe("TSP-13: type-level arithmetic rejects invalid results", () => {
  it("reports non-finite results instead of emitting NaN / Infinity", () => {
    const { code, errors } = expand(`import type { Pow } from "@typesugar/type-system";
export type A = Pow<-8, 0.5>;
export type B = Pow<10, 400>;
`);
    expect(code).not.toMatch(/NaN|Infinity/);
    expect(errors.length).toBe(2);
  });

  it("requires integers for IsEven / IsOdd / Div / Mod", () => {
    const { code, errors } =
      expand(`import type { IsOdd, IsEven, Div, Mod } from "@typesugar/type-system";
export type A = IsOdd<2.5>;
export type B = IsEven<2.5>;
export type C = Div<7.5, 2>;
export type D = Mod<7, 2.5>;
`);
    expect(errors.length).toBe(4);
    expect(code).not.toMatch(/type A = true/);
  });
});
