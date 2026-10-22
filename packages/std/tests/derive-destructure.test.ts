/**
 * `@derive(Destructure)` (PEP-008 Wave 11): extractor patterns for a user's
 * own product interfaces and discriminated unions.
 *
 * The derive generates, next to the type, a constructor FUNCTION per
 * extractor (`Point(x, y)`, `Circle(r)`) — the value a pattern names — and a
 * `Destructure` instance with a `@destructure` descriptor, which the match
 * macro inlines. Every behavioural assertion runs the emitted code; the
 * expanded program is type-checked and its `.d.ts` emitted, as
 * `typesugar build` does.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as std from "@typesugar/std";

import "@typesugar/macros";
import "@typesugar/std/macros";

import { TransformationPipeline } from "@typesugar/transformer";

const here = path.dirname(fileURLToPath(import.meta.url));
let counter = 0;

const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  skipLibCheck: true,
  lib: ["lib.es2023.d.ts"],
};

interface Output {
  /** Expanded TypeScript per file. */
  code: Record<string, string>;
  errors: string[];
  warnings: string[];
  exports: Record<string, unknown>;
  /** Type errors in the EXPANDED program (what the language service and build check). */
  typeErrors: string[];
  /** `.d.ts` emitted from the expanded program, per source file. */
  dts: Record<string, string>;
}

/**
 * Transform several files (keys are relative names, `main.ts` is the entry;
 * `.d.ts` keys are served as declaration files and not transformed),
 * transpile to CommonJS and run `main.ts`. The expanded files are then
 * type-checked as a program of their own, and their declarations emitted.
 */
function run(files: Record<string, string>): Output {
  const dir = path.resolve(here, `__derive_destructure_${counter++}`);
  const abs = (rel: string) => path.join(dir, rel);
  const byPath = new Map(Object.entries(files).map(([rel, text]) => [abs(rel), text]));
  const pipeline = new TransformationPipeline(COMPILER_OPTIONS, [...byPath.keys()], {
    readFile: (f) => byPath.get(f) ?? ts.sys.readFile(f),
    fileExists: (f) => byPath.has(f) || ts.sys.fileExists(f),
  });
  const code: Record<string, string> = {};
  const js: Record<string, string> = {};
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const rel of Object.keys(files)) {
    if (rel.endsWith(".d.ts")) {
      code[rel] = files[rel];
      continue;
    }
    const r = pipeline.transform(abs(rel));
    code[rel] = r.code;
    for (const d of r.diagnostics ?? []) {
      const msg = String((d as { message?: string }).message ?? "");
      if ((d as { severity?: string }).severity === "error") errors.push(msg);
      else warnings.push(msg);
    }
    js[rel] = ts.transpileModule(r.code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
  }

  // The expanded program: type errors and declarations.
  const expanded = new Map(Object.keys(files).map((rel) => [abs(rel), code[rel]]));
  const host = ts.createCompilerHost({ ...COMPILER_OPTIONS, declaration: true });
  const baseGet = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, onErr, create) => {
    const text = expanded.get(f);
    return text !== undefined
      ? ts.createSourceFile(f, text, lang, true)
      : baseGet(f, lang, onErr, create);
  };
  host.fileExists = (f) => expanded.has(f) || ts.sys.fileExists(f);
  host.directoryExists = (d) => d === dir || ts.sys.directoryExists(d);
  host.readFile = (f) => expanded.get(f) ?? ts.sys.readFile(f);
  const dts: Record<string, string> = {};
  host.writeFile = (f, text) => {
    if (f.endsWith(".d.ts")) dts[path.relative(dir, f).replace(/\.d\.ts$/, ".ts")] = text;
  };
  const program = ts.createProgram(
    [...expanded.keys()],
    { ...COMPILER_OPTIONS, declaration: true, emitDeclarationOnly: true },
    host
  );
  const typeErrors = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && expanded.has(d.file.fileName))
    .map(
      (d) =>
        `${path.basename(d.file!.fileName)}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`
    );
  program.emit();

  const cache = new Map<string, Record<string, unknown>>();
  const load = (rel: string): Record<string, unknown> => {
    const hit = cache.get(rel);
    if (hit) return hit;
    const mod = { exports: {} as Record<string, unknown> };
    cache.set(rel, mod.exports);
    const req = (spec: string) => {
      if (spec === "@typesugar/std") return std;
      if (spec.startsWith("@typesugar/std/syntax/")) return {}; // activation markers
      if (spec.startsWith("./")) return load(spec.slice(2).replace(/(\.js)?$/, ".ts"));
      throw new Error(`unexpected require(${spec})`);
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("require", "exports", "module", js[rel])(req, mod.exports, mod);
    return mod.exports;
  };
  let exports: Record<string, unknown> = {};
  if (errors.length === 0) exports = load("main.ts");
  return { code, errors, warnings, exports, typeErrors, dts };
}

type Fn = (...args: never[]) => unknown;

/** The derived declarations in an expanded file: everything after the type. */
function generated(code: string, after: string): string {
  const at = code.indexOf(after);
  expect(at).toBeGreaterThanOrEqual(0);
  return code
    .slice(at + after.length)
    .split("\nexport const area")[0]
    .split("\nexport const sum")[0];
}

const POINT = `/** @derive(Destructure) */
export interface Point {
  readonly x: number;
  readonly y: number;
}
`;

const SHAPE = `/** @derive(Destructure) */
export type Shape =
  | { kind: "circle"; r: number }
  | { kind: "rect"; w: number; h: number }
  | { kind: "empty" };
`;

describe("@derive(Destructure) on a product interface", () => {
  it("generates a constructor function and a zero-cost instance (pinned)", () => {
    const r = run({ "main.ts": POINT });
    expect(r.errors).toEqual([]);
    expect(generated(r.code["main.ts"], "readonly y: number;\n}")).toBe(`
/** Builds a Point. In a pattern, \`Point(x, y)\` destructures one (@derive(Destructure)). */
export function Point(x: number, y: number): Point {
    return { x, y };
}
/**
 * @impl Destructure<typeof Point, Point, [number, number]>
 * @destructure always -> x, y
 */
export const destructurePoint = { extract: (v: Point): [number, number] => [v.x, v.y] };
`);
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.Point as Fn)(1 as never, 2 as never)).toEqual({ x: 1, y: 2 });
  });

  it("Point(x, y) in a fluent match is two field reads", () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
${POINT}
export const sum = (p: Point) => match(p).case(Point(x, y)).then(x + y);
`,
    });
    expect(r.errors).toEqual([]);
    const sum = r.code["main.ts"].slice(r.code["main.ts"].indexOf("export const sum"));
    expect(sum).toContain("const x = _p.x;");
    expect(sum).toContain("const y = _p.y;");
    expect(sum).not.toMatch(/extract|destructurePoint|Point\(/);
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.sum as Fn)({ x: 2, y: 3 } as never)).toBe(5);
  });

  it("in a match: switch", () => {
    const r = run({
      "main.ts": `import "@typesugar/std/syntax/match";
${POINT}
export function sum(p: Point): number {
  match: switch (p) {
    case Point(x, y):
      return x * y;
  }
}
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toMatch(/const x = p\.x;\s*const y = p\.y;\s*return x \* y;/);
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.sum as Fn)({ x: 4, y: 5 } as never)).toBe(20);
  });

  it("works when the match comes before the declaration", () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
export const sum = (p: Point) => match(p).case(Point(x, y)).then(x - y);
${POINT}`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toContain("const x = _p.x;");
    expect((r.exports.sum as Fn)({ x: 5, y: 3 } as never)).toBe(2);
  });

  it("works from another file", () => {
    const r = run({
      "point.ts": POINT,
      "main.ts": `import { match } from "@typesugar/std";
import { Point } from "./point.js";
export const sum = (p: Point) => match(p).case(Point(x, y)).then(x + y);
export const make = () => Point(7, 8);
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toContain("const x = _p.x;");
    expect(r.code["main.ts"]).not.toContain("extract");
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.sum as Fn)({ x: 1, y: 2 } as never)).toBe(3);
    expect((r.exports.make as Fn)()).toEqual({ x: 7, y: 8 });
  });

  it("merges with the companion namespace of other derives (function first)", () => {
    const r = run({
      "main.ts": `import "@typesugar/std/syntax/eq/ops";
/** @derive(Eq, Destructure) */
export interface Point { x: number; y: number }
export const same = (a: Point, b: Point) => Point.Eq.equals(a, b);
`,
    });
    expect(r.errors).toEqual([]);
    const code = r.code["main.ts"];
    expect(code.indexOf("export function Point(")).toBeLessThan(
      code.indexOf("export namespace Point")
    );
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.same as Fn)({ x: 1, y: 2 } as never, { x: 1, y: 2 } as never)).toBe(true);
    expect((r.exports.Point as Fn)(1 as never, 2 as never)).toEqual({ x: 1, y: 2 });
  });

  it("a generic interface gets a generic constructor and instance", () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
/** @derive(Destructure) */
export interface Box<T> { value: T; label?: string }
export const open = (b: Box<number>) => match(b).case(Box(v, l)).then(v + (l ?? "").length);
export const make = () => [Box(1), Box("a", "b")];
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toContain(
      "export function Box<T>(value: T, label?: string): Box<T> {"
    );
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.open as Fn)({ value: 1, label: "ab" } as never)).toBe(3);
    expect((r.exports.make as Fn)()).toEqual([{ value: 1 }, { value: "a", label: "b" }]);
  });
});

describe("@derive(Destructure) on a discriminated union", () => {
  it("generates one extractor per variant, named from the discriminant (pinned)", () => {
    const r = run({ "main.ts": SHAPE });
    expect(r.errors).toEqual([]);
    expect(generated(r.code["main.ts"], '| {\n    kind: "empty";\n};')).toBe(`
/** Builds the \`kind: "circle"\` variant of Shape. In a pattern, \`Circle(r)\` destructures one (@derive(Destructure)). */
export function Circle(r: number): {
    kind: "circle";
    r: number;
} {
    return { kind: "circle", r };
}
/** Builds the \`kind: "rect"\` variant of Shape. In a pattern, \`Rect(w, h)\` destructures one (@derive(Destructure)). */
export function Rect(w: number, h: number): {
    kind: "rect";
    w: number;
    h: number;
} {
    return { kind: "rect", w, h };
}
/** Builds the \`kind: "empty"\` variant of Shape. In a pattern, \`Empty\` matches one (@derive(Destructure)). */
export function Empty(): {
    kind: "empty";
} {
    return { kind: "empty" };
}
/**
 * @impl Destructure<typeof Circle, Shape, number>
 * @destructure kind = "circle" -> r
 */
export const destructureCircle = { extract: (v: Shape): number | undefined => v.kind === "circle" ? v.r : undefined };
/**
 * @impl Destructure<typeof Rect, Shape, [number, number]>
 * @destructure kind = "rect" -> w, h
 */
export const destructureRect = { extract: (v: Shape): [number, number] | undefined => v.kind === "rect" ? [v.w, v.h] : undefined };
/**
 * @impl Destructure<typeof Empty, Shape, true>
 * @destructure kind = "empty"
 */
export const destructureEmpty = { extract: (v: Shape): true | undefined => v.kind === "empty" ? true : undefined };
`);
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.Rect as Fn)(2 as never, 3 as never)).toEqual({ kind: "rect", w: 2, h: 3 });
  });

  it("fluent match: discriminant checks and field reads, exhaustive without .else()", () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
${SHAPE}
export const area = (s: Shape) =>
  match(s).case(Circle(r)).then(3 * r * r).case(Rect(w, h)).then(w * h).case(Empty).then(0);
`,
    });
    expect(r.errors).toEqual([]);
    const area = r.code["main.ts"].slice(r.code["main.ts"].indexOf("export const area"));
    expect(area).toContain('_s.kind === "circle"');
    expect(area).toContain("const r = _s.r;");
    expect(area).toContain("const w = _s.w;");
    expect(area).not.toMatch(/extract|destructure|Circle\(|Rect\(/);
    expect(r.typeErrors).toEqual([]);
    const f = r.exports.area as Fn;
    expect(f({ kind: "circle", r: 2 } as never)).toBe(12);
    expect(f({ kind: "rect", w: 2, h: 5 } as never)).toBe(10);
    expect(f({ kind: "empty" } as never)).toBe(0);
  });

  it("a missing variant is a compile error", () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
${SHAPE}
export const area = (s: Shape) => match(s).case(Circle(r)).then(r).case(Empty).then(0);
`,
    });
    expect(r.errors.join("\n")).toMatch(/Non-exhaustive[\s\S]*rect/);
  });

  it("match: switch is a switch on the discriminant (pinned)", () => {
    const r = run({
      "main.ts": `import "@typesugar/std/syntax/match";
${SHAPE}
export function area(s: Shape): number {
  match: switch (s) {
    case Circle(r):
      return 3 * r * r;
    case Rect(w, h):
      return w * h;
    case Empty:
      return 0;
  }
}
`,
    });
    expect(r.errors).toEqual([]);
    const code = r.code["main.ts"];
    expect(code.slice(code.indexOf("export function area")))
      .toBe(`export function area(s: Shape): number {
    switch (s.kind) {
        case "circle": {
            const r = s.r;
            return 3 * r * r;
        }
        case "rect": {
            const w = s.w;
            const h = s.h;
            return w * h;
        }
        case "empty": return 0;
    }
}
`);
    expect(r.typeErrors).toEqual([]);
    const f = r.exports.area as Fn;
    expect(f({ kind: "circle", r: 1 } as never)).toBe(3);
    expect(f({ kind: "rect", w: 2, h: 2 } as never)).toBe(4);
  });

  it("variants that are named interfaces keep their names", () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
/** @derive(Destructure) */
export type Result = Ok | Err;
export interface Ok { ok: true; value: number }
export interface Err { ok: false; error: string }
export const show = (x: Result) => match(x).case(Ok(v)).then(\`ok \${v}\`).case(Err(e)).then(\`err \${e}\`);
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toContain("export function Ok(value: number): Ok {");
    expect(r.code["main.ts"]).toContain("@destructure ok = true -> value");
    expect(r.code["main.ts"]).toContain("_x.ok === true");
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.show as Fn)({ ok: true, value: 1 } as never)).toBe("ok 1");
    expect((r.exports.show as Fn)({ ok: false, error: "no" } as never)).toBe("err no");
    expect((r.exports.Err as Fn)("x" as never)).toEqual({ ok: false, error: "x" });
  });

  it("works from another file, for inline and named variants", () => {
    const r = run({
      "shape.ts": `${SHAPE}
/** @derive(Destructure) */
export type Pet = Cat | Dog;
export interface Cat { tag: "cat"; lives: number }
export interface Dog { tag: "dog"; good: boolean }
`,
      "main.ts": `import { match } from "@typesugar/std";
import { type Shape, Circle, Rect, Empty, type Pet, Cat, Dog } from "./shape.js";
export const area = (s: Shape) =>
  match(s).case(Circle(r)).then(r).case(Rect(w, h)).then(w + h).case(Empty).then(0);
export const pet = (p: Pet) => match(p).case(Cat(n)).then(n).case(Dog(g)).then(g ? 1 : 0);
export const make = () => [Circle(1), Dog(true)];
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toContain('_s.kind === "circle"');
    expect(r.code["main.ts"]).toContain('_p.tag === "cat"');
    expect(r.code["main.ts"]).not.toContain("extract");
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.area as Fn)({ kind: "rect", w: 1, h: 2 } as never)).toBe(3);
    expect((r.exports.pet as Fn)({ tag: "cat", lives: 9 } as never)).toBe(9);
    expect((r.exports.make as Fn)()).toEqual([
      { kind: "circle", r: 1 },
      { tag: "dog", good: true },
    ]);
  });

  it("a generic union: Option-style", () => {
    const r = run({
      "main.ts": `import { match } from "@typesugar/std";
/** @derive(Destructure) */
export type Maybe<A> = { _tag: "Just"; value: A } | { _tag: "Nothing" };
export const get = (m: Maybe<number>) => match(m).case(Just(v)).then(v).case(Nothing).then(-1);
export const make = () => [Just("x"), Nothing()];
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toContain("export function Just<A>(value: A): {");
    expect(r.typeErrors).toEqual([]);
    expect((r.exports.get as Fn)({ _tag: "Just", value: 3 } as never)).toBe(3);
    expect((r.exports.get as Fn)({ _tag: "Nothing" } as never)).toBe(-1);
    expect((r.exports.make as Fn)()).toEqual([{ _tag: "Just", value: "x" }, { _tag: "Nothing" }]);
  });
});

describe("published libraries: the .d.ts carries the extractors", () => {
  it("declares the functions and the instances with their descriptors", () => {
    const r = run({ "main.ts": POINT + SHAPE });
    expect(r.errors).toEqual([]);
    const dts = r.dts["main.ts"];
    expect(dts).toContain("export declare function Point(x: number, y: number): Point;");
    expect(dts).toMatch(
      /@destructure always -> x, y\s*\*\/\s*export declare const destructurePoint/
    );
    expect(dts).toContain("export declare function Circle(r: number): {");
    expect(dts).toMatch(
      /@destructure kind = "circle" -> r\s*\*\/\s*export declare const destructureCircle/
    );
  });

  it("a consumer of the .d.ts inlines them (no extract() call)", () => {
    const lib = run({ "shape.ts": POINT + SHAPE, "main.ts": "export {};\n" });
    const r = run({
      "shape.d.ts": lib.dts["shape.ts"],
      "main.ts": `import { match } from "@typesugar/std";
import { type Point, type Shape, Point as P, Circle, Rect, Empty } from "./shape.js";
export const sum = (p: Point) => match(p).case(P(x, y)).then(x + y);
export const area = (s: Shape) =>
  match(s).case(Circle(r)).then(r).case(Rect(w, h)).then(w * h).case(Empty).then(0);
`,
    });
    expect(r.errors).toEqual([]);
    expect(r.code["main.ts"]).toContain("const x = _p.x;");
    expect(r.code["main.ts"]).toContain('_s.kind === "rect"');
    expect(r.code["main.ts"]).not.toContain("extract");
    expect((r.exports.sum as Fn)({ x: 1, y: 2 } as never)).toBe(3);
    expect((r.exports.area as Fn)({ kind: "rect", w: 2, h: 3 } as never)).toBe(6);
  });
});

describe("ambiguities are compile errors", () => {
  const errorsFor = (src: string) => run({ "main.ts": src }).errors;

  it("a value of the same name already exists", () => {
    expect(
      errorsFor(`/** @derive(Destructure) */
export interface Point { x: number }
export const Point = 1;
`)
    ).toEqual([expect.stringContaining("'Point' already names a value")]);
  });

  it("a variant name would shadow a global", () => {
    expect(
      errorsFor(`/** @derive(Destructure) */
export type Res = { kind: "error"; message: string } | { kind: "done" };
`)
    ).toEqual([expect.stringContaining("'Error' would shadow the global Error")]);
  });

  it("two variants get the same name", () => {
    expect(
      errorsFor(`/** @derive(Destructure) */
export type T = { kind: "a-b"; x: number } | { kind: "a_b"; y: number };
`)
    ).toEqual([expect.stringContaining("both variants would be named AB")]);
  });

  it("a variant tag that isn't a name", () => {
    expect(
      errorsFor(`/** @derive(Destructure) */
export type T = { kind: "2d"; x: number } | { kind: "3d"; y: number };
`)
    ).toEqual([expect.stringContaining('"2d" does not make an extractor name')]);
  });

  it("an inline variant with a boolean discriminant has no name", () => {
    expect(
      errorsFor(`/** @derive(Destructure) */
export type R = { ok: true; value: number } | { ok: false; error: string };
`)
    ).toEqual([expect.stringContaining("name the variants with interfaces")]);
  });

  it("no discriminant, or more than one", () => {
    expect(
      errorsFor(`/** @derive(Destructure) */
export type U = { a: number } | { b: string };
`)
    ).toEqual([expect.stringContaining("no discriminant")]);
    expect(
      errorsFor(`/** @derive(Destructure) */
export type U = { kind: "a"; type: "x" } | { kind: "b"; type: "y" };
`)
    ).toEqual([expect.stringContaining("more than one discriminant (kind, type)")]);
  });

  it("an interface that extends another: the field order is ambiguous", () => {
    expect(
      errorsFor(`interface Base { id: string }
/** @derive(Destructure) */
export interface Point extends Base { x: number }
`)
    ).toEqual([expect.stringContaining("extends another type")]);
  });

  it("a named variant with derives of its own, declared before the union", () => {
    expect(
      errorsFor(`/** @derive(Eq) */
export interface Circle { kind: "circle"; r: number }
export interface Square { kind: "square"; s: number }
/** @derive(Destructure) */
export type Shape = Circle | Square;
`)
    ).toEqual([expect.stringContaining("declare Shape before Circle")]);
  });

  it("a class is not supported", () => {
    expect(
      errorsFor(`/** @derive(Destructure) */
export class Point { constructor(public x: number) {} }
`)
    ).toEqual([expect.stringContaining("not on a class")]);
  });
});
