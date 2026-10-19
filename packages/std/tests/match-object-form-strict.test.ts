/**
 * Docs review r3 (guides-b #3, start #8): the object-handler form
 * `match(value, { Variant: handler })` emitted code that ran correctly but
 * failed `strictOutput` type checking:
 *
 * - "Property 'kind' does not exist on type 'never'" — the non-exhaustive
 *   throw read `_m.kind` after every variant had narrowed `_m` away.
 * - "Expected 0 arguments, but got 1" — zero-parameter handlers
 *   (`circle: () => "circle"`) were called with the value.
 *
 * Each case transforms the documented example with strictOutput on, asserts
 * no `[strictOutput]` diagnostics, and runs the output.
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import * as std from "@typesugar/std";
import { transformCode } from "@typesugar/transformer";

const here = path.dirname(fileURLToPath(import.meta.url));
let n = 0;

function strictRun(src: string): { strict: string[]; out: Record<string, unknown> } {
  const r = transformCode(src, {
    fileName: path.resolve(here, `__match_strict_${n++}.ts`),
    strictOutput: true,
  });
  const strict = (r.diagnostics ?? [])
    .map((d: { message?: string }) => String(d.message ?? ""))
    .filter((m: string) => m.includes("[strictOutput]"));
  const js = ts.transpileModule(r.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const req = (spec: string) => {
    if (spec === "@typesugar/std") return std;
    throw new Error(`unexpected require(${spec})`);
  };
  new Function("require", "exports", "module", js)(req, mod.exports, mod);
  return { strict, out: mod.exports };
}

describe("object-form match() output type-checks (docs review r3 guides-b #3)", () => {
  it("kind discriminant, destructuring and zero-parameter handlers", () => {
    const { strict, out } = strictRun(`
import { match } from "@typesugar/std";
type Result<T, E> = { kind: "Ok"; value: T } | { kind: "Err"; error: E };
const result = { kind: "Err", error: "boom" } as Result<number, string>;
export const message = match(result, {
  Ok: ({ value }) => \`Got \${value}\`,
  Err: ({ error }) => \`Failed: \${error}\`,
});
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rectangle"; width: number; height: number }
  | { kind: "triangle"; base: number; height: number };
const shape = { kind: "rectangle", width: 2, height: 3 } as Shape;
export const area = match(shape, {
  circle: (s) => Math.PI * s.radius ** 2,
  rectangle: (s) => s.width * s.height,
  triangle: (s) => (s.base * s.height) / 2,
});
export const name = match(shape, { circle: () => "circle", _: () => "polygon" });
export const round = match(shape, { circle: () => true, "rectangle|triangle": () => false });
type Ev = { type: "click"; x: number } | { type: "key"; key: string };
const ev = { type: "key", key: "a" } as Ev;
export const label = match(ev, { click: () => "click", key: () => "key" }, "type");
`);
    expect(strict).toEqual([]);
    expect(out).toMatchObject({
      message: "Failed: boom",
      area: 6,
      name: "polygon",
      round: false,
      label: "key",
    });
  });

  it("legacy { Ok, Err } handlers over a tag-discriminated union (start #8)", () => {
    const { strict, out } = strictRun(`
import { match } from "@typesugar/std";
type Result<T, E> = { tag: "Ok"; value: T } | { tag: "Err"; error: E };
const result = { tag: "Ok", value: 42 } as Result<number, string>;
export const message = match(result, {
  Ok: ({ value }) => \`Got \${value}\`,
  Err: () => "failed",
});
`);
    expect(strict).toEqual([]);
    expect(out.message).toBe("Got 42");
  });
});

// Docs review r3 (guides-b #9): match()'s argument-shape errors used the
// generic TS9999. They now carry the catalogued TS9216 / TS9202 codes.
describe("match() argument errors carry catalogue codes (docs review r3 guides-b #9)", () => {
  const codesOf = (src: string) =>
    (
      transformCode(src, { fileName: path.resolve(here, `__match_codes_${n++}.ts`) }).diagnostics ??
      []
    )
      .filter((d: { severity?: string }) => d.severity === "error")
      .map((d: { code?: number }) => d.code);

  it("too few arguments is TS9216", () => {
    expect(
      codesOf(
        `import { match } from "@typesugar/std";\n// @ts-expect-error -- deliberately missing the handlers\nexport const r = match(1);`
      )
    ).toEqual([9216]);
  });

  it("a non-object handlers argument is TS9202", () => {
    expect(
      codesOf(
        `import { match } from "@typesugar/std";\nexport const r = match(1 as number, 5 as any);`
      )
    ).toEqual([9202]);
  });

  it("a non-exhaustive match is TS9226 with the missing cases in the message", () => {
    const src = (body: string) =>
      transformCode(`import { match } from "@typesugar/std";\n${body}`, {
        fileName: path.resolve(here, `__match_codes_${n++}.ts`),
      }).diagnostics.filter((d: { severity?: string }) => d.severity === "error");
    const lit = src(`export const f = (s: "a" | "b") => match(s).case("a").then(1);`);
    expect(lit.map((d: { code?: number }) => d.code)).toEqual([9226]);
    expect(String(lit[0].message)).toMatch(/missing cases: "b"/);
    const du = src(
      `type U = { kind: "x" } | { kind: "y" };\nexport const f = (u: U) => match(u).case({ kind: "x" }).then(1);`
    );
    expect(du.map((d: { code?: number }) => d.code)).toEqual([9226]);
    expect(String(du[0].message)).toMatch(/missing variants: "?y"?/);
    const ne = src(`export const f = (n: number) => match(n).case(1).then(1);`);
    expect(ne.map((d: { code?: number }) => d.code)).toEqual([9226]);
  });
});
