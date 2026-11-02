/**
 * Execution tests for the @typesugar/testing macros.
 *
 * Each test runs the REAL transformer on a source snippet, transpiles the
 * output, and EXECUTES it against this package's runtime (`../src/index.ts`),
 * so a missing import, a duplicate declaration, a broken string splice or a
 * double evaluation fails here as it would in a user's test suite — not just
 * as a mismatch in output text.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import { transformCode } from "@typesugar/transformer";
import * as runtime from "../src/index.js";
import { createMockFn } from "../src/index.js";

// Registers the testing macros.
import "../src/macro.js";

interface Compiled {
  code: string;
  diagnostics: string[];
}

function compile(source: string, fileName = "/virtual/project/x.test.ts"): Compiled {
  const r = transformCode(source, { fileName });
  return { code: r.code, diagnostics: r.diagnostics.map((d) => d.message) };
}

interface RunResult {
  exports: Record<string, any>;
  tests: Array<{ name: string; fn: () => unknown }>;
}

/** Transpile `code` to CJS and run it with `@typesugar/testing` bound to this package's runtime. */
function run(code: string, extraGlobals: Record<string, unknown> = {}): RunResult {
  const out = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const syntax = (out.diagnostics ?? []).map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, "\n")
  );
  expect(syntax, "transformed output must be syntactically valid").toEqual([]);

  const tests: RunResult["tests"] = [];
  const fakeIt = (name: string, fn: () => unknown) => tests.push({ name, fn });
  const modules: Record<string, unknown> = {
    "@typesugar/testing": runtime,
    typesugar: {},
  };
  const requireFn = (id: string) => {
    if (id in modules) return modules[id];
    throw new Error(`unexpected import of '${id}' in transformed output`);
  };
  const module = { exports: {} as Record<string, any> };
  const names = ["require", "exports", "module", "it", ...Object.keys(extraGlobals)];
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(...names, `"use strict";\n${out.outputText}`);
  fn(requireFn, module.exports, module, fakeIt, ...Object.values(extraGlobals));
  return { exports: module.exports, tests };
}

/** Top-level declaration names that occur more than once (TS2393 / SyntaxError in a module). */
function duplicateTopLevelNames(code: string): string[] {
  const sf = ts.createSourceFile("out.ts", code, ts.ScriptTarget.Latest, true);
  const seen = new Map<string, number>();
  for (const st of sf.statements) {
    const names: string[] = [];
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) {
      names.push(st.name.text);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
      }
    } else if (ts.isImportDeclaration(st) && st.importClause) {
      const nb = st.importClause.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) names.push(el.name.text);
      if (st.importClause.name) names.push(st.importClause.name.text);
    }
    for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  return [...seen].filter(([, c]) => c > 1).map(([n]) => n);
}

describe("mock<T>() — executes (finding #9)", () => {
  it("imports its runtime helper and produces a working, tracked mock", () => {
    const { code, diagnostics } = compile(
      [
        `import { mock } from "@typesugar/testing";`,
        `interface Svc { get(id: string): number; "odd-name"(): string; label: string }`,
        `export const s = mock<Svc>();`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    const { exports } = run(code);
    const s = exports.s;
    s.get.mockReturnValue(42);
    expect(s.get("a")).toBe(42);
    expect(s._calls.get).toEqual([["a"]]);
    s["odd-name"].mockReturnValueOnce("x");
    expect(s["odd-name"]()).toBe("x");
    expect(s["odd-name"]()).toBeUndefined();
    s._reset();
    expect(s._calls.get).toEqual([]);
    expect(s.get("b")).toBeUndefined();
  });

  it("@mock generates a working mock binding", () => {
    const { code, diagnostics } = compile(
      [
        `import { mock } from "@typesugar/testing";`,
        `@mock`,
        `interface Repo { find(id: number): string }`,
        `export { mockRepo };`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    const { exports } = run(code);
    exports.mockRepo.find.mockImplementation((id: number) => `#${id}`);
    expect(exports.mockRepo.find(7)).toBe("#7");
    expect(exports.mockRepo._calls.find).toEqual([[7]]);
  });
});

describe("@derive(Arbitrary) — two derives in one file (finding #12)", () => {
  it("emits no duplicate top-level declarations and both generators run", () => {
    const { code, diagnostics } = compile(
      [
        `import { derive } from "typesugar";`,
        `import { Arbitrary } from "@typesugar/testing";`,
        `@derive(Arbitrary)`,
        `export interface A { x: number; flag: boolean }`,
        `@derive(Arbitrary)`,
        `export interface B { y: string; "weird-key"?: number }`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    expect(duplicateTopLevelNames(code)).toEqual([]);
    const { exports } = run(code);
    const a1 = exports.arbitraryA(5);
    expect(a1).toEqual(exports.arbitraryA(5)); // seeded: deterministic
    expect(typeof a1.x).toBe("number");
    expect(typeof a1.flag).toBe("boolean");
    const b = exports.arbitraryB(3);
    expect(typeof b.y).toBe("string");
    expect(b.y.length).toBeGreaterThan(0);
    expect(exports.arbitraryBMany(4, 1)).toHaveLength(4);
  });
});

describe("assertType<T>() — literal and primitive types (findings #10, #25)", () => {
  const src = (body: string) =>
    [
      `import { assertType } from "@typesugar/testing";`,
      `type Ev = { kind: "click" };`,
      `export function check(v: unknown) { ${body} }`,
    ].join("\n");

  it('literal-typed fields ({ tag: "x" }) compile and are checked by value', () => {
    const { code, diagnostics } = compile(src(`assertType<Ev & { tag: "x" }>(v);`));
    expect(diagnostics).toEqual([]);
    const { exports } = run(code);
    expect(() => exports.check({ kind: "click", tag: "x" })).not.toThrow();
    expect(() => exports.check({ kind: "click", tag: "y" })).toThrow(
      /Field 'tag': expected "x", got "y"/
    );
    expect(() => exports.check({ tag: "x" })).toThrow(/Field 'kind': missing/);
    expect(() => exports.check(null)).toThrow(/expected object, got null/);
  });

  it("primitive and literal-union types are accepted (assertType<number>(5) passes)", () => {
    const { code, diagnostics } = compile(
      [
        `import { assertType } from "@typesugar/testing";`,
        `export const num = (v: unknown) => assertType<number>(v);`,
        `export const dir = (v: unknown) => assertType<"up" | "down">(v, "direction");`,
        `export const arr = (v: unknown) => assertType<number[]>(v);`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    const { exports } = run(code);
    expect(() => exports.num(5)).not.toThrow();
    expect(() => exports.num("5")).toThrow(/expected number, got "5"/);
    expect(() => exports.dir("up")).not.toThrow();
    expect(() => exports.dir("left")).toThrow(/direction: expected "up" \| "down"/);
    expect(() => exports.arr([1, 2])).not.toThrow();
    expect(() => exports.arr({})).toThrow(/expected array/);
  });
});

describe("@testCases — nested macros and awkward labels (finding #18)", () => {
  it("expands macros inside the body and runs each case", () => {
    const { code, diagnostics } = compile(
      [
        `import { testCases, assert } from "@typesugar/testing";`,
        `@testCases([{ a: 1 }, { a: 2 }])`,
        `function t(a: number) {`,
        `  assert(a === 1);`,
        `}`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    const { tests } = run(code);
    expect(tests.map((t) => t.name)).toEqual(["t (case #1: a=1)", "t (case #2: a=2)"]);
    expect(() => tests[0].fn()).not.toThrow();
    // The nested assert() was expanded: the failure is the power-assert diagram.
    expect(() => tests[1].fn()).toThrow(/Power Assert Failed/);
  });

  it("case values with quotes, backslashes and line breaks give a valid test name", () => {
    const { code, diagnostics } = compile(
      [
        `import { testCases } from "@typesugar/testing";`,
        `@testCases([{ s: "say \\"hi\\"\\n", o: {`,
        `  k: 1,`,
        `} }])`,
        `function t(s: string, o: { k: number }) {`,
        `  if (s.length !== 9 || o.k !== 1) throw new Error("bad binding");`,
        `}`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    const { tests } = run(code);
    expect(tests).toHaveLength(1);
    expect(tests[0].name).toBe('t (case #1: s="say \\"hi\\"\\n", o={ k: 1, })');
    expect(() => tests[0].fn()).not.toThrow();
  });
});

describe("assert() — evaluates each sub-expression once (finding #17)", () => {
  it("does not re-run side effects on failure, and still draws the diagram", () => {
    const { code, diagnostics } = compile(
      [
        `import { assert } from "@typesugar/testing";`,
        `export let n = 0;`,
        `export function go() { assert(n++ === 5); }`,
        `export function get() { return n; }`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    const { exports } = run(code);
    let message = "";
    try {
      exports.go();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/Power Assert Failed/);
    expect(message).toContain("assert(n++ === 5)");
    expect(message).toContain("false");
    expect(exports.get()).toBe(1);
  });

  it("keeps `this` for method calls, optional chains and short-circuiting intact", () => {
    const { code, diagnostics } = compile(
      [
        `import { assert } from "@typesugar/testing";`,
        `const box = { v: 2, get() { return this.v; } };`,
        `const maybe: { a?: { b: number } } = {};`,
        `let calls = 0;`,
        `const side = () => { calls++; return true; };`,
        `export function ok() { assert(box.get() === 2 && maybe.a?.b === undefined); }`,
        `export function shortCircuit() { assert(false && side()); }`,
        `export function getCalls() { return calls; }`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    const { exports } = run(code);
    expect(() => exports.ok()).not.toThrow();
    expect(() => exports.shortCircuit()).toThrow(/Power Assert Failed/);
    expect(exports.getCalls()).toBe(0);
  });

  it("supports await inside the assertion", async () => {
    const { code, diagnostics } = compile(
      [
        `import { assert } from "@typesugar/testing";`,
        `export async function go(x: number) { assert((await Promise.resolve(x)) === 1); }`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    const { exports } = run(code);
    await expect(exports.go(1)).resolves.toBeUndefined();
    await expect(exports.go(2)).rejects.toThrow(/Power Assert Failed/);
  });
});

describe("assertSnapshot() — stable snapshot key (finding #13)", () => {
  it("uses a project-relative path and no line number", () => {
    const fileName = `${process.cwd()}/some/dir/snap.test.ts`;
    const { code, diagnostics } = compile(
      [
        `import { assertSnapshot } from "@typesugar/testing";`,
        `export function go(v: number) { assertSnapshot(v + 1); }`,
      ].join("\n"),
      fileName
    );
    expect(diagnostics).toEqual([]);
    const labels: string[] = [];
    const fakeExpect = (value: unknown) => ({
      toMatchSnapshot: (label: string) => labels.push(`${label}=${value}`),
    });
    const { exports } = run(code, { expect: fakeExpect });
    exports.go(1);
    expect(labels).toEqual(["some/dir/snap.test.ts — v + 1=2"]);
  });
});

describe("forAll() — executes", () => {
  it("runs the property for each generated value and reports the failing input", () => {
    const { code, diagnostics } = compile(
      [
        `import { forAll } from "@typesugar/testing";`,
        `export const seen: number[] = [];`,
        `export function ok() { forAll((i: number) => i, 3, (v: number) => { seen.push(v); }); }`,
        `export function bad() { forAll((i: number) => i, (v: number) => { if (v === 2) throw new Error("two"); }); }`,
      ].join("\n")
    );
    expect(diagnostics).toEqual([]);
    const { exports } = run(code);
    exports.ok();
    expect(exports.seen).toEqual([0, 1, 2]);
    expect(() => exports.bad()).toThrow(
      /Property failed after 3 tests\.\nFailing input: 2\nError: two/
    );
  });
});

describe("createMockFn — Vitest/Jest precedence (finding #25)", () => {
  it("the latest persistent stub wins, and *Once stubs share one ordered queue", () => {
    const fn = createMockFn<() => number>();
    fn.mockImplementation(() => 1);
    fn.mockReturnValue(2); // later persistent stub replaces the implementation
    expect(fn()).toBe(2);
    fn.mockReturnValue(3);
    fn.mockImplementation(() => 4); // ...and vice versa
    expect(fn()).toBe(4);

    fn.mockImplementationOnce(() => 10);
    fn.mockReturnValueOnce(11);
    fn.mockImplementationOnce(() => 12);
    expect([fn(), fn(), fn(), fn()]).toEqual([10, 11, 12, 4]);

    fn.mockClear();
    expect(fn.calls).toEqual([]);
    expect(fn()).toBe(4); // mockClear keeps the implementation
    fn.mockReset();
    expect(fn()).toBeUndefined();
  });
});
