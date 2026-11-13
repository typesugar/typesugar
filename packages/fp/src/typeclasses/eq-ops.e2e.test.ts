/**
 * Architecture review 2026-11 (S4): fp's `Eq`/`Ord` use std's member names
 * (`equals`/`notEquals`, `lessThan`, …), which are the names the `===`/`<`
 * operator rewrites call. With fp's old `eqv`, `a === b` on an fp instance
 * became `inst.equals(a, b)` — a call to a method that did not exist.
 *
 * Runs the REAL transformer against the built dists — needs
 * `pnpm --filter @typesugar/fp build`.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
// @ts-ignore -- the transformer is not a dependency of this package; load its built pipeline directly
import { transformCode } from "../../../transformer/dist/pipeline.js";
import * as fpTypeclasses from "./index.js";

const FILE = path.resolve(__dirname, "../../../../__fp_eq_ops_e2e_input.ts");

function expandAndRun(src: string): { code: string; out: Record<string, any> } {
  const r = transformCode(src, { fileName: FILE });
  const js = ts.transpileModule(r.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, any> };
  const require = (id: string) => {
    if (id === "@typesugar/fp/typeclasses") return fpTypeclasses;
    if (id.startsWith("@typesugar/std/syntax/") || id === "typesugar") return {};
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", js)(require, mod, mod.exports);
  return { code: r.code, out: mod.exports };
}

describe("operator syntax dispatches to @typesugar/fp's Eq/Ord instances", () => {
  it("=== and !== call equals/notEquals on an fp Eq instance", () => {
    const { code, out } = expandAndRun(`
import "@typesugar/std/syntax/eq/ops";
import { EqOps, type Eq } from "@typesugar/fp/typeclasses";

interface Money { cents: number; currency: string }

/** @impl Eq<Money> */
const eqMoney: Eq<Money> = EqOps.makeEq((a, b) => a.cents === b.cents && a.currency === b.currency);

const a: Money = { cents: 100, currency: "AUD" };
const b: Money = { cents: 100, currency: "AUD" };
export const same = a === b;
export const differ = a !== b;
`);
    expect(code).toContain("eqMoney.equals(a, b)");
    expect(code).toContain("eqMoney.notEquals(a, b)");
    expect(out.same).toBe(true);
    expect(out.differ).toBe(false);
  });

  it("< and >= call lessThan/greaterThanOrEqual on an fp Ord instance", () => {
    const { code, out } = expandAndRun(`
import "@typesugar/std/syntax/ord/ops";
import { EqOps, type Ord } from "@typesugar/fp/typeclasses";

interface Version { major: number }

/** @impl Ord<Version> */
const ordVersion: Ord<Version> = EqOps.ordBy((v: Version) => v.major, EqOps.ordNumber);

const v1: Version = { major: 1 };
const v2: Version = { major: 2 };
export const lt = v1 < v2;
export const gte = v1 >= v2;
`);
    expect(code).toContain("ordVersion.lessThan(v1, v2)");
    expect(code).toContain("ordVersion.greaterThanOrEqual(v1, v2)");
    expect(out.lt).toBe(true);
    expect(out.gte).toBe(false);
  });
});
