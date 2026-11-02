/**
 * Typeclass instances for enums (turf case study, round 2).
 *
 * 1. An enum member resolved the PRIMITIVE's instance: `Color.Green.show()`
 *    became `showNumber.show(Color.Green)` beside an `@impl Show<Color>`,
 *    because the member's literal type is mutually assignable with `number`
 *    and was resolved before being widened to its enum. Resolution now tries
 *    the member's own enum (by symbol) first, and falls back to the
 *    primitive's instance only when the enum has none.
 * 2. `@impl Show<Color>` on an enum declared in the same file warned
 *    "'Color' is not declared in this file". It now generates no companion
 *    and says nothing: a companion merged into the enum object overwrote a
 *    same-named member and polluted `Object.values` (review 5, item 2).
 *
 * Each test transforms a real on-disk program and executes the output.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import { clearTypeRewrites, standaloneExtensionRegistry } from "@typesugar/core";
import "@typesugar/macros";

import { transformCode, type TransformCodeResult } from "../src/transform.js";
import { resetDtsDiscovery } from "../src/dts-opaque-discovery.js";

function transform(main: string, extraFiles: Record<string, string> = {}): TransformCodeResult {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "enum-instances-")));
  try {
    const files: Record<string, string> = { ...extraFiles, "main.ts": main };
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    const fileName = path.join(dir, "main.ts");
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    };
    const program = ts.createProgram([fileName], options);
    const sf = program.getSourceFile(fileName)!;
    return transformCode(sf.text, { program, fileName });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Transpile to CJS and run; `log` collects console.log output. */
function run(code: string, modules: Record<string, unknown> = {}): unknown[] {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const logged: unknown[] = [];
  const req = (m: string) => {
    if (m in modules) return modules[m];
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", "log", js)({}, req, (v: unknown) => logged.push(v));
  return logged;
}

const TYPESUGAR_STUBS = { typesugar: { implicit: () => undefined, summon: () => undefined } };

const errors = (r: TransformCodeResult) => r.diagnostics.filter((d) => d.severity === "error");
const warnings = (r: TransformCodeResult) => r.diagnostics.filter((d) => d.severity === "warning");

beforeEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

afterEach(() => {
  clearTypeRewrites();
  resetDtsDiscovery();
  standaloneExtensionRegistry.length = 0;
});

const SHOW = [
  `import { summon, implicit } from "typesugar";`,
  `declare function log(v: unknown): void;`,
  `/** @typeclass */`,
  `interface Show<A> {`,
  `  show(value: A): string;`,
  `}`,
].join("\n");

const SHOW_NUMBER = [
  `/** @impl Show<number> */`,
  `const showNumber: Show<number> = { show: (n) => "num:" + n };`,
].join("\n");

const COLOR = `enum Color { Red, Green, Blue }`;

const SHOW_COLOR = [
  `/** @impl Show<Color> */`,
  `const showColor: Show<Color> = { show: (c) => "color:" + Color[c] };`,
].join("\n");

const USES = [
  `function show<A>(value: A, S: Show<A> = implicit()): string {`,
  `  return S.show(value);`,
  `}`,
  `const c: Color = Color.Blue;`,
  `log(Color.Green.show());`,
  `log(c.show());`,
  `log(show(Color.Green));`,
  `log(show(c));`,
  `log(summon<Show<Color>>().show(Color.Red));`,
].join("\n");

describe("an enum member resolves its enum's instance before the primitive's", () => {
  it("method sugar, implicit() and summon pick Show<Color> over Show<number>", () => {
    const result = transform([SHOW, SHOW_NUMBER, COLOR, SHOW_COLOR, USES].join("\n"));
    expect(errors(result)).toEqual([]);
    expect(run(result.code, TYPESUGAR_STUBS)).toEqual([
      "color:Green",
      "color:Blue",
      "color:Green",
      "color:Blue",
      "color:Red",
    ]);
  });

  it("Show<number> declared after Show<Color> makes no difference", () => {
    const result = transform([SHOW, COLOR, SHOW_COLOR, SHOW_NUMBER, USES].join("\n"));
    expect(errors(result)).toEqual([]);
    expect(run(result.code, TYPESUGAR_STUBS)).toEqual([
      "color:Green",
      "color:Blue",
      "color:Green",
      "color:Blue",
      "color:Red",
    ]);
  });

  it("an imported enum instance beats a local primitive instance", () => {
    // showColor is found by scanning ./color (not imported by name, which
    // would make it an extension provider instead).
    const result = transform(
      [
        `import { implicit } from "typesugar";`,
        `import { Show, Color } from "./color";`,
        `declare function log(v: unknown): void;`,
        SHOW_NUMBER,
        `function show<A>(value: A, S: Show<A> = implicit()): string {`,
        `  return S.show(value);`,
        `}`,
        `const c: Color = Color.Blue;`,
        `log(show(Color.Green));`,
        `log(show(c));`,
        `log(show(7));`,
      ].join("\n"),
      {
        "color.ts": [
          `/** @typeclass */`,
          `export interface Show<A> { show(value: A): string; }`,
          `export enum Color { Red, Green, Blue }`,
          `/** @impl Show<Color> */`,
          `export const showColor: Show<Color> = { show: (c) => "color:" + Color[c] };`,
        ].join("\n"),
      }
    );
    expect(errors(result)).toEqual([]);
    // The program, run against a stand-in for ./color.
    const Color = { Red: 0, Green: 1, Blue: 2, 0: "Red", 1: "Green", 2: "Blue" } as const;
    const showColor = { show: (c: 0 | 1 | 2) => "color:" + Color[c] };
    expect(run(result.code, { ...TYPESUGAR_STUBS, "./color": { Color, showColor } })).toEqual([
      "color:Green",
      "color:Blue",
      "num:7",
    ]);
  });

  it("with no enum instance, the member falls back to the primitive's", () => {
    const result = transform(
      [
        SHOW,
        SHOW_NUMBER,
        COLOR,
        `const c: Color = Color.Blue;`,
        `log(Color.Green.show());`,
        `log(c.show());`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(run(result.code, TYPESUGAR_STUBS)).toEqual(["num:1", "num:2"]);
  });

  it("=== on enum operands stays the native comparison", () => {
    const result = transform(
      [
        `declare function log(v: unknown): void;`,
        `/** @typeclass */`,
        `interface Eq<A> {`,
        `  /** @op === */`,
        `  equals(a: A, b: A): boolean;`,
        `}`,
        `/** @impl Eq<number> */`,
        `const eqNumber: Eq<number> = { equals: () => false };`,
        COLOR,
        `/** @impl Eq<Color> */`,
        `const eqColor: Eq<Color> = { equals: () => false };`,
        `const c: Color = Color.Green as Color;`,
        `log(c === Color.Green);`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(result.code).toMatch(/c === Color\.Green/);
    expect(run(result.code)).toEqual([true]);
  });
});

describe("@impl on an enum generates no companion (the enum object is user data)", () => {
  // 592d66b4 merged `namespace Color { export const Show = showColor }` into
  // the enum: an `@impl Eq<Op>` overwrote the member `Op.Eq` with the
  // instance, and a string enum's `Object.values` listed the instance
  // (review 5, item 2). The instance resolves by its declared type, so no
  // companion is needed, and none is generated; nothing is reported.
  const EQ = [
    `declare function log(v: unknown): void;`,
    `/** @typeclass */`,
    `interface Eq<A> {`,
    `  equals(a: A, b: A): boolean;`,
    `}`,
  ].join("\n");

  it("an @impl Eq<Op> leaves the member Op.Eq alone", () => {
    const result = transform(
      [
        EQ,
        `export enum Op { Eq, Ne }`,
        `/** @impl Eq<Op> */`,
        `export const eqOp: Eq<Op> = { equals: (a, b) => a === b };`,
        `log(Op.Eq);`,
        `log(Op.Ne);`,
        `log(Op[0]);`,
      ].join("\n")
    );
    expect(errors(result).map((d) => d.message)).toEqual([]);
    expect(warnings(result).map((d) => d.message)).toEqual([]);
    expect(result.code).not.toMatch(/namespace Op/);
    expect(run(result.code)).toEqual([0, 1, "Eq"]);
  });

  it("a string enum's Object.values holds only its members", () => {
    const result = transform(
      [
        SHOW,
        `enum Status { Active = "active", Done = "done" }`,
        `/** @impl Show<Status> */`,
        `const showStatus: Show<Status> = { show: (s) => "status:" + s };`,
        `log(Object.values(Status));`,
        `log(Status.Done.show());`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(warnings(result).map((d) => d.message)).toEqual([]);
    expect(run(result.code, TYPESUGAR_STUBS)).toEqual([["active", "done"], "status:done"]);
  });

  it("the instance still resolves, with no companion and no warning", () => {
    const result = transform([SHOW, SHOW_NUMBER, COLOR, SHOW_COLOR, USES].join("\n"));
    expect(errors(result)).toEqual([]);
    expect(warnings(result).map((d) => d.message)).toEqual([]);
    expect(result.code).not.toMatch(/namespace Color/);
    expect(run(result.code, TYPESUGAR_STUBS)).toEqual([
      "color:Green",
      "color:Blue",
      "color:Green",
      "color:Blue",
      "color:Red",
    ]);
  });

  it("a const enum is quiet too", () => {
    const result = transform(
      [
        SHOW,
        `const enum Color { Red, Green, Blue }`,
        `/** @impl Show<Color> */`,
        `const showColor: Show<Color> = { show: (c) => "color:" + c };`,
      ].join("\n")
    );
    expect(warnings(result).map((d) => d.message)).toEqual([]);
    expect(result.code).not.toMatch(/namespace Color/);
  });
});
