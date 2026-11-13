/**
 * Regressions for the bugs the 2026-11 architecture review found through
 * duplication (audit/ARCH-REVIEW-2026-11.md B1–B4, A6, B·7; triage in
 * audit/ARCH-REVIEW-2026-11-TRIAGE.md). B1 and B3 were fixed by the #80–#86
 * stack and are pinned here; the rest were fixed with these tests.
 */

import { describe, it, expect } from "vitest";
import { transformOne, exportLine, errors, EQ_TYPECLASS } from "./_harness.js";

const warnings = (r: { diagnostics: { severity: string; message: string }[] }): string[] =>
  r.diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);

/** The `export const <name> = …` statement, which may span several lines. */
function exportStatement(code: string, name: string): string {
  const start = code.indexOf(`export const ${name} =`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = code.indexOf(";\n", start);
  return code.slice(start, end < 0 ? undefined : end + 1);
}

describe("B1: early-return flattening keeps side effects in nested branches", () => {
  const PICK = `
/** @typeclass */
export interface Pick<A> { pick(c: number, a: A, b: A): A; }
declare function log(x: unknown): void;
declare const c: number;
`;

  it("if-block with a side effect before its return", () => {
    const r = transformOne(`${PICK}
/** @impl Pick<number> */
const pickNum: Pick<number> = {
  pick(c, a, b) { if (c > 0) { log(a); return a; } return b; },
};
export const r = pickNum.pick(c, 1, 2);
`);
    expect(errors(r)).toEqual([]);
    const stmt = exportStatement(r.code, "r");
    expect(stmt.includes("pickNum.pick(") || stmt.includes("log(1)")).toBe(true);
  });

  it("else-if branch with a side effect", () => {
    const r = transformOne(`${PICK}
/** @impl Pick<number> */
const pickNum: Pick<number> = {
  pick(c, a, b) { if (c > 1) { return a; } else if (c > 0) { log(b); return b; } return a + b; },
};
export const r = pickNum.pick(c, 1, 2);
`);
    expect(errors(r)).toEqual([]);
    const stmt = exportStatement(r.code, "r");
    expect(stmt.includes("pickNum.pick(") || stmt.includes("log(2)")).toBe(true);
  });
});

describe("B2: a decorator the file implements itself is not taken for a macro", () => {
  const OWN_REFLECT = `
function reflect<T>(target: T): T { return target; }
@reflect
export class A { x = 1; }
`;

  it("with no typesugar import", () => {
    const r = transformOne(OWN_REFLECT);
    expect(r.code).toContain("@reflect");
    expect(r.code).not.toContain("__A_meta__");
  });

  it("in a file that imports another typesugar macro", () => {
    const r = transformOne(
      `import { comptime } from "typesugar";\nexport const n = comptime(() => 1 + 1);\n${OWN_REFLECT}`
    );
    expect(r.code).toContain("@reflect");
    expect(r.code).not.toContain("__A_meta__");
  });

  it("control: an ambient declaration of the name still reaches the macro", () => {
    const r = transformOne(`
declare function reflect<T>(target: T): T;
@reflect
export class A { x = 1; }
`);
    expect(r.code).toContain("__A_meta__");
  });

  it("control: the imported reflect macro still expands", () => {
    const r = transformOne(`
import { reflect } from "typesugar";
@reflect
export class A { x = 1; }
`);
    expect(r.code).toContain("__A_meta__");
  });
});

describe("B3: arrow-body comprehensions", () => {
  it("par: in an arrow body emits a working chain once activated", () => {
    const r = transformOne(`import "@typesugar/std/syntax/do";
export const f = (x: Promise<number>) =>
par: { a << x; b << Promise.resolve(2); }
yield: { a + b }
`);
    expect(errors(r)).toEqual([]);
    expect(exportLine(r.code, "f")).toBe(
      "export const f = (x: Promise<number>) => Promise.all([x, Promise.resolve(2)]).then(([a, b]) => a + b);"
    );
  });

  it("without the syntax import it warns TS9224, as the block form does", () => {
    const r = transformOne(`import "@typesugar/std";
export const f = (x: Promise<number>) =>
par: { a << x; b << Promise.resolve(2); }
yield: { a + b }
`);
    expect(warnings(r).some((m) => m.includes("TS9224") && m.includes("'par:'"))).toBe(true);
  });

  it("control: no hint in a file that opted out of macros", () => {
    const r = transformOne(`"use no typesugar macros";
import "@typesugar/std";
export const f = (x: Promise<number>) =>
par: { a << x; b << Promise.resolve(2); }
yield: { a + b }
`);
    expect(warnings(r).some((m) => m.includes("TS9224"))).toBe(false);
  });
});

// One case per row of docs/guides/opt-out.md's feature table.
describe("B4: every documented feature opt-out works", () => {
  const POINT = `
${EQ_TYPECLASS}
export interface Point { x: number; y: number; }
/** @impl Eq<Point> */
const eqPoint: Eq<Point> = {
  equals: (a, b) => a.x === b.x && a.y === b.y,
  notEquals: (a, b) => !(a.x === b.x && a.y === b.y),
};
declare const p: Point; declare const q: Point;
`;

  it("macros: expression macros stay as written", () => {
    const r = transformOne(`"use no typesugar macros";
import { comptime } from "typesugar";
export const n = comptime(() => 1 + 1);
`);
    expect(exportLine(r.code, "n")).toBe("export const n = comptime(() => 1 + 1);");
  });

  it("derive: the @derive decorator is not expanded", () => {
    const r = transformOne(`"use no typesugar derive";
import { derive, Eq } from "@typesugar/std";
@derive(Eq)
export class P { x = 1; }
`);
    expect(r.code).not.toMatch(/namespace P|P\.Eq|equals:/);
  });

  it("derive: the JSDoc @derive tag is not expanded either", () => {
    const r = transformOne(`"use no typesugar derive";
import { Eq } from "@typesugar/std";
/** @derive Eq */
export interface P { x: number; }
`);
    expect(r.code).not.toMatch(/namespace P|equals:/);
  });

  it("typeclasses: summon() stays a call", () => {
    const r = transformOne(`"use no typesugar typeclasses";
import { summon } from "typesugar";
${POINT}
export const r = summon<Eq<Point>>();
`);
    expect(exportLine(r.code, "r")).toBe("export const r = summon<Eq<Point>>();");
  });

  it("typeclasses: @typeclass and @impl generate no companions", () => {
    const r = transformOne(`"use no typesugar typeclasses";\n${POINT}\nexport const r = 1;\n`);
    expect(r.code).not.toContain("__typesugar_companions");
    expect(r.code).not.toMatch(/namespace Point/);
  });

  it("control: @impl generates a companion without the directive", () => {
    const r = transformOne(`${POINT}\nexport const r = 1;\n`);
    expect(r.code).toMatch(/namespace Point/);
  });

  it("control: summon expands without the directive", () => {
    const r = transformOne(`import { summon } from "typesugar";
${POINT}
export const r = summon<Eq<Point>>();
`);
    expect(exportLine(r.code, "r")).toBe("export const r = eqPoint;");
  });

  it("operators: === stays native", () => {
    const r = transformOne(`"use no typesugar operators";\n${POINT}\nexport const r = p === q;\n`);
    expect(exportLine(r.code, "r")).toBe("export const r = p === q;");
  });

  it("control: method sugar applies without the directive", () => {
    const r = transformOne(`${POINT}\nexport const r = p.equals(q);\n`);
    expect(exportLine(r.code, "r")).toBe("export const r = eqPoint.equals(p, q);");
  });

  it("extensions: method sugar stays a method call", () => {
    const r = transformOne(
      `"use no typesugar extensions";\n${POINT}\nexport const r = p.equals(q);\n`
    );
    expect(exportLine(r.code, "r")).toBe("export const r = p.equals(q);");
  });
});

describe("A6: an ambiguous method-sugar instance is reported at the call", () => {
  it("anchors on the call, not the start of the file", () => {
    const src = `${EQ_TYPECLASS}
export interface Point { x: number; y: number; }
/** @impl Eq<Point> */
const eqPointA: Eq<Point> = { equals: (a, b) => a.x === b.x, notEquals: (a, b) => a.x !== b.x };
/** @impl Eq<Point> */
const eqPointB: Eq<Point> = { equals: (a, b) => a.y === b.y, notEquals: (a, b) => a.y !== b.y };
declare const p: Point; declare const q: Point;
export const r = p.equals(q);
`;
    const r = transformOne(src);
    const ambiguous = r.diagnostics.find((d) => d.message.includes("Ambiguous Eq instance"));
    expect(ambiguous).toBeDefined();
    expect(ambiguous!.start).toBe(src.indexOf("p.equals(q)"));
  });
});

describe("B·7: TS9602 for an imported generic function says why", () => {
  it("does not advise redeclaring a function that is imported", () => {
    const r = transformOne(
      `
import { fold } from "./lib";
interface Monoid<A> { empty: A; combine(a: A, b: A): A; }
/** @impl Monoid<number> */
const sumMonoid: Monoid<number> = { empty: 0, combine: (a, b) => a + b };
export const r = fold(sumMonoid, [1, 2, 3]);
`,
      {
        "lib.ts": `
export interface Monoid<A> { empty: A; combine(a: A, b: A): A; }
export function fold<A>(M: Monoid<A>, xs: A[]): A { return xs.reduce((acc, x) => M.combine(acc, x), M.empty); }
`,
      }
    );
    const msgs = r.diagnostics.map((d) => d.message).filter((m) => m.includes("TS9602"));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("the function is imported");
    expect(msgs[0]).not.toContain("Declare it as a const arrow function");
  });
});
