/**
 * 2026-11 correctness audit — `@derive` over NON-PRIMITIVE fields and
 * activation-without-import (packages/macros/src/auto-derive.ts GenericDerivation,
 * packages/macros/src/typeclass.ts `tryExpandGenericDerive`,
 * packages/transformer-core/src/macro-helpers.ts `expandDeriveDecorator`).
 *
 * Findings F21–F23 in audit/FABLE-AUDIT-2026-11.md (PEP-017 "everything is a
 * typeclass" / PEP-052). Each `it.fails` asserts the CORRECT behavior; controls
 * are plain `it`.
 */

import { describe, it, expect } from "vitest";
import { project, transformOne, exportLine, errors } from "./_harness.js";

describe("audit F21: @derive(Eq) on a product type with a user-typed field", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F21 (PEP-017 nested derivation; auto-derive hasFieldInstance is primitive-only)
  it("same file: Outer { inner: Inner } where Inner is @derive(Eq) must derive", () => {
    const result = transformOne(`
import "@typesugar/std/syntax/eq/ops";
import { derive, Eq } from "typesugar";
@derive(Eq)
class Inner { constructor(public v: number) {} }
@derive(Eq)
class Outer { constructor(public inner: Inner, public n: number) {} }
declare const o1: Outer; declare const o2: Outer;
export const same = o1 === o2;
`);
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("namespace Outer");
    expect(exportLine(result.code, "same")).toBe("export const same = Outer.Eq.equals(o1, o2);");
  });

  // Tracked: audit/FABLE-AUDIT-2026-11.md F21 (PEP-017 nested derivation; auto-derive hasFieldInstance is primitive-only)
  it("cross module: a hand-written, imported Eq<Inner> instance must satisfy the field", () => {
    const proj = project({
      "inner.ts": `
import type { Eq } from "typesugar";
export class Inner { constructor(public v: number) {} }
/** @impl Eq<Inner> */
export const eqInner: Eq<Inner> = { equals: (a, b) => a.v === b.v, notEquals: (a, b) => a.v !== b.v };
`,
      "main.ts": `
import "@typesugar/std/syntax/eq/ops";
import { derive, Eq } from "typesugar";
import { Inner, eqInner } from "./inner";
@derive(Eq)
class Outer { constructor(public inner: Inner, public n: number) {} }
declare const o1: Outer; declare const o2: Outer;
export const same = o1 === o2;
`,
    });
    const result = proj.transform("main.ts");
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("namespace Outer");
  });

  it('control: no misleading "Unknown derive" diagnostic for a nested derive', () => {
    const result = transformOne(`
import "@typesugar/std/syntax/eq/ops";
import { derive, Eq } from "typesugar";
@derive(Eq)
class Inner { constructor(public v: number) {} }
@derive(Eq)
class Outer { constructor(public inner: Inner, public n: number) {} }
`);
    // Before the #80–#83 stack this emitted "Unknown derive: 'Eq'", naming the
    // wrong problem (the real one was the field without a primitive instance).
    expect(errors(result).join("\n")).not.toMatch(/Unknown derive/);
  });
});

describe("audit F22: @derive(Eq) on a product type with an array field", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F22 (PEP-057 string codegen in auto-derive: `string[].Eq.equals`)
  it("Tags { tags: string[] } must derive or report a precise diagnostic, not a parse crash", () => {
    const result = transformOne(`
import "@typesugar/std/syntax/eq/ops";
import { derive, Eq } from "typesugar";
@derive(Eq)
class Tags { constructor(public tags: string[]) {} }
declare const t1: Tags; declare const t2: Tags;
export const same = t1 === t2;
`);
    expect(errors(result).join("\n")).not.toMatch(/Failed to parse expression/);
  });
});

describe("audit F23: JSDoc @derive must not activate without an import", () => {
  // Tracked: audit/FABLE-AUDIT-2026-11.md F23 (PEP-052 named-trigger rule; tryExpandGenericDerive injects "@typesugar/macros")
  it.fails("a file with `/** @derive Eq */` and NO imports is left byte-for-byte unchanged", () => {
    const code = `
/** @derive Eq */
class P { constructor(public x: number) {} }
declare const a: P; declare const b: P;
export const r = a === b;
`.trim();
    const result = transformOne(code);
    expect(result.code).not.toContain('from "@typesugar/macros"');
    expect(result.changed).toBe(false);
  });
});

describe("controls (must stay green)", () => {
  it("@derive(Eq) with only primitive fields derives and rewrites ===", () => {
    const result = transformOne(`
import "@typesugar/std/syntax/eq/ops";
import { derive, Eq } from "typesugar";
@derive(Eq)
class Point { constructor(public x: number, public y: number) {} }
declare const p1: Point; declare const p2: Point;
export const same = p1 === p2;
`);
    expect(errors(result)).toEqual([]);
    expect(exportLine(result.code, "same")).toBe("export const same = Point.Eq.equals(p1, p2);");
  });
});
