/**
 * Deep review core #24 / typeclass #13: a GenericDerivation whose output
 * references `TC.<primitive>` (e.g. `Ord.number`) makes `@derive(TC)` import
 * `TC` from @typesugar/macros. With two `@derive(TC)` types in one file that
 * import used to be injected twice (`import { Ord }` ×2 — a SyntaxError). It is
 * now routed through `ctx.ensureImport`, which dedupes per (symbol, module).
 *
 * The builtin strategies inline primitive operations and never reference
 * `TC.number`, so this test installs a third-party-style strategy for Ord
 * (restored afterwards) to exercise the import path.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as ts from "typescript";
import { transformCode } from "@typesugar/transformer-core";
import {
  getGenericDerivation,
  registerGenericDerivation,
  type GenericDerivation,
} from "@typesugar/macros";

let original: GenericDerivation | undefined;

beforeAll(() => {
  original = getGenericDerivation("Ord");
  registerGenericDerivation("Ord", {
    typeclassName: "Ord",
    fieldTypeclass: "Ord",
    hasFieldInstance: (t) => t === "number",
    deriveProduct: (_ctx, typeName, meta) =>
      `({ compare: (a: ${typeName}, b: ${typeName}): number => ${meta
        .fieldNames!.map((n) => `Ord.number.compare(a.${n}, b.${n})`)
        .join(" || ")} })`,
  });
});

afterAll(() => {
  if (original) registerGenericDerivation("Ord", original);
});

describe("@derive with a strategy referencing TC.<primitive>", () => {
  it("two @derive(Ord) types in one file get exactly one import, and the output runs", () => {
    const r = transformCode(
      `/** @derive(Ord) */
export interface A { x: number }
/** @derive(Ord) */
export interface B { y: number }`,
      { fileName: "derive-two-ord.ts" }
    );
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const imports = r.code.match(/import\s*\{\s*Ord\s*\}\s*from\s*"@typesugar\/macros"/g) ?? [];
    expect(imports).toHaveLength(1);

    // Parses (no duplicate-binding SyntaxError) and runs against a stub
    // @typesugar/macros providing Ord.number.
    const js = ts.transpileModule(r.code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} as Record<string, any> };
    const stub = {
      Ord: { number: { compare: (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0) } },
    };
    new Function("module", "exports", "require", js)(mod, mod.exports, (s: string) =>
      s === "@typesugar/macros" ? stub : {}
    );
    expect(mod.exports.A.Ord.compare({ x: 1 }, { x: 2 })).toBe(-1);
    expect(mod.exports.B.Ord.compare({ y: 3 }, { y: 2 })).toBe(1);
  });
});
