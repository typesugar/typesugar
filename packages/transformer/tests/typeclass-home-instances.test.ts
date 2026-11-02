/**
 * Instances of a typeclass named through a re-exported alias.
 *
 * `typesugar` exports each derive marker together with its typeclass as a
 * type (`export type Ord<A> = import("@typesugar/std").Ord<A>`), so
 * `import type { Ord } from "typesugar"` names std's `Ord`, by identity. Its
 * instances (`ordNumber`, ...) live in `@typesugar/std`, which the file does
 * not import, so a scan of the file's imports did not find them: TS9001, with
 * help text telling the user to `@derive(Ord)` on `number` and to import the
 * `Ord` they had already imported. The typeclass's own package is now in
 * scope for its instances (Scala's implicit scope includes the typeclass's
 * companion), imported from the package the way an import of it would be.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { transformCode } from "@typesugar/transformer/pipeline";

let counter = 0;
const transform = (code: string) =>
  transformCode(code, { fileName: `typeclass-home-${counter++}.ts` });
const errors = (r: ReturnType<typeof transform>) =>
  r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

function evaluate(
  code: string,
  std: Record<string, unknown>,
  fp: Record<string, unknown> = {}
): Record<string, unknown> {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", js)(mod, mod.exports, (spec: string) =>
    spec === "@typesugar/std" ? std : spec === "@typesugar/fp" ? fp : {}
  );
  return mod.exports;
}

describe("a typeclass imported from typesugar finds @typesugar/std's instances", () => {
  it("summon and implicit() resolve Ord<number>, Eq<number>, Eq<string>", async () => {
    const r = transform(`import { summon, implicit } from "typesugar";
import type { Ord, Eq } from "typesugar";
function same<T>(a: T, b: T, E: Eq<T> = implicit()) { return E.equals(a, b); }
export const cmp = summon<Ord<number>>().compare(1, 2);
export const s = same(1, 1);
export const e = summon<Eq<string>>().equals("a", "a");
`);
    expect(errors(r)).toEqual([]);
    expect(r.code).toMatch(/import \{[^}]*\bordNumber\b[^}]*\} from "@typesugar\/std"/);
    const std = await import("@typesugar/std");
    expect(evaluate(r.code, std as Record<string, unknown>)).toMatchObject({
      cmp: -1,
      s: true,
      e: true,
    });
  });

  it("a renamed import of the typeclass is the same typeclass for implicit()", () => {
    const r = transform(`import { implicit } from "typesugar";
import type { Eq as Equal } from "typesugar";
function same<T>(a: T, b: T, E: Equal<T> = implicit()) { return E.equals(a, b); }
export const s = same("x", "x");
`);
    expect(errors(r)).toEqual([]);
    expect(r.code).toContain("eqString");
  });

  it("no instance for a primitive: the help neither says @derive it nor re-imports the typeclass", () => {
    const r = transform(`import { summon } from "typesugar";
import type { Eq } from "typesugar";
export const e = summon<Eq<symbol>>();
`);
    const errs = errors(r);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("TS9001");
    expect(errs[0]).not.toContain("@derive(Eq) to symbol");
    expect(errs[0]).not.toContain('import { Eq } from "typesugar"');
  });
});

describe("a typeclass whose package exports its instances in a namespace (fp's Show)", () => {
  // `typesugar`'s `Show` is @typesugar/fp's, and fp's root exports its
  // instances only inside `export * as TC from "./typeclasses"`
  // (`TC.showNumber`), which the home-package scan didn't enter: TS9001.
  it("summon and implicit() resolve Show<number> through the namespace", async () => {
    const r = transform(`import { summon, implicit } from "typesugar";
import type { Show } from "typesugar";
function print<A>(value: A, S: Show<A> = implicit()): string { return S.show(value); }
export const a = summon<Show<number>>().show(42);
export const b = print("hi");
export const c = print(true);
`);
    expect(errors(r)).toEqual([]);
    expect(r.code).toMatch(/import \{[^}]*\bTC\b[^}]*\} from "@typesugar\/fp"/);
    const fp = await import("@typesugar/fp");
    expect(evaluate(r.code, {}, fp as Record<string, unknown>)).toMatchObject({
      a: "42",
      b: '"hi"',
      c: "true",
    });
  });
});
