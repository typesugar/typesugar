/**
 * Extension-method chains through GENERIC extension functions whose return
 * type is a mapped or conditional type over their type parameters, the shape
 * of every remeda utility (remeda case study, finding F6).
 *
 * `users.sortBy(f).groupBy(g)` expanded to `sortBy(users, f).groupBy(g)`: the
 * chained call was left as written and threw at run time, and `typesugar
 * check` reported nothing (the checker types the receiver as an error, so it
 * has no TS2339 to report). The receiver's type was taken from the
 * uninstantiated signature (`ReorderedArray<T>`), which matches no array
 * parameter; and with purried overloads the data-last one (declared first)
 * could be picked, whose return type is a function.
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

function transform(main: string): TransformCodeResult {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "generic-ext-chains-")));
  try {
    const files: Record<string, string> = {
      "node_modules/fakeremeda/package.json": JSON.stringify({
        name: "fakeremeda",
        version: "1.0.0",
        types: "index.d.ts",
      }),
      "node_modules/fakeremeda/index.d.ts": FAKE_REMEDA,
      "main.ts": main,
    };
    for (const [name, content] of Object.entries(files)) {
      const p = path.join(dir, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    const fileName = path.join(dir, "main.ts");
    const program = ts.createProgram([fileName], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    });
    const sf = program.getSourceFile(fileName)!;
    return transformCode(sf.text, { program, fileName });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// remeda's own shapes (packages/remeda/src): purried overloads with the
// data-last one first, a homomorphic mapped return type (ReorderedArray), a
// conditional one (Chunk, simplified) and a conditional object type
// (BoundedPartial).
const FAKE_REMEDA = [
  "type IterableContainer<T = unknown> = readonly T[] | readonly [];",
  "type ReorderedArray<T extends IterableContainer> = { -readonly [P in keyof T]: T[number] };",
  "type Chunk<T extends IterableContainer> = T extends readonly [] ? [] : Array<Array<T[number]>>;",
  "type BoundedPartial<T> = string extends keyof T ? Partial<T> : T;",
  "export declare function sortBy<T extends IterableContainer>(",
  "  ...rules: ReadonlyArray<(x: T[number]) => number>",
  "): (data: T) => ReorderedArray<T>;",
  "export declare function sortBy<T extends IterableContainer>(",
  "  data: T,",
  "  ...rules: ReadonlyArray<(x: T[number]) => number>",
  "): ReorderedArray<T>;",
  "export declare function chunk(size: number): <T extends IterableContainer>(data: T) => Chunk<T>;",
  "export declare function chunk<T extends IterableContainer>(data: T, size: number): Chunk<T>;",
  "export declare function groupBy<T, K extends PropertyKey>(",
  "  fn: (x: T) => K",
  "): (data: readonly T[]) => BoundedPartial<Record<K, T[]>>;",
  "export declare function groupBy<T, K extends PropertyKey>(",
  "  data: readonly T[],",
  "  fn: (x: T) => K",
  "): BoundedPartial<Record<K, T[]>>;",
  "export declare function keys<T extends object>(data: T): Array<keyof T & string>;",
  "export declare function add(addend: number): (value: number) => number;",
  "export declare function add(value: number, addend: number): number;",
].join("\n");

const purried =
  (impl: (...args: any[]) => unknown, arity: number) =>
  (...args: unknown[]) =>
    args.length >= arity ? impl(...args) : (data: unknown) => impl(data, ...args);

const REMEDA_RUNTIME = {
  sortBy: (data: number[] | object[], ...rules: Array<(x: unknown) => number>) =>
    [...data].sort((a, b) => rules[0](a) - rules[0](b)),
  chunk: purried((data: unknown[], size: number) => {
    const out: unknown[][] = [];
    for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
    return out;
  }, 2),
  groupBy: purried((data: unknown[], fn: (x: unknown) => PropertyKey) => {
    const out: Record<PropertyKey, unknown[]> = {};
    for (const x of data) (out[fn(x)] ??= []).push(x);
    return out;
  }, 2),
  keys: (data: object) => Object.keys(data),
  add: purried((value: number, addend: number) => value + addend, 2),
};

/** Transpile to CJS and run; `log` collects console.log output. */
function run(code: string): unknown[] {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const logged: unknown[] = [];
  const req = (m: string) => {
    if (m === "fakeremeda") return REMEDA_RUNTIME;
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", "log", js)({}, req, (v: unknown) => logged.push(v));
  return logged;
}

const errors = (r: TransformCodeResult) => r.diagnostics.filter((d) => d.severity === "error");

const PRELUDE = [
  `import { sortBy, chunk, groupBy, keys, add } from "fakeremeda";`,
  `declare function log(v: unknown): void;`,
  `interface User { readonly name: string; readonly score: number; readonly group: string }`,
  `const users: ReadonlyArray<User> = [`,
  `  { name: "a", score: 3, group: "x" },`,
  `  { name: "b", score: 1, group: "y" },`,
  `  { name: "c", score: 2, group: "x" },`,
  `];`,
].join("\n");

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

describe("extension chains through generic mapped/conditional return types (remeda F6)", () => {
  it("users.sortBy(f).groupBy(g) rewrites both calls and runs", () => {
    const result = transform(
      [
        PRELUDE,
        `const byGroup = users.sortBy((u) => u.score).groupBy((u) => u.group);`,
        `log(byGroup.x?.map((u) => u.name));`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("groupBy(sortBy(users");
    expect(run(result.code)).toEqual([["c", "a"]]);
  });

  it("through a variable: const s = users.sortBy(f); s.groupBy(g)", () => {
    const result = transform(
      [
        PRELUDE,
        `const sorted = users.sortBy((u) => u.score);`,
        `log(sorted.groupBy((u) => u.group).y?.length);`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("groupBy(sorted");
    expect(run(result.code)).toEqual([1]);
  });

  it("through a conditional return type: users.chunk(2).groupBy(g)", () => {
    const result = transform(
      [PRELUDE, `log(users.chunk(2).groupBy((c) => String(c.length)).keys());`].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("keys(groupBy(chunk(users, 2)");
    expect(run(result.code)).toEqual([["1", "2"]]);
  });

  it("a native method on the result is left alone: users.sortBy(f).map(g)", () => {
    const result = transform(
      [PRELUDE, `log(users.sortBy((u) => u.score).map((u) => u.name));`].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("sortBy(users, (u) => u.score).map(");
    expect(run(result.code)).toEqual([["b", "c", "a"]]);
  });

  it("picks the overload the rewritten call's argument count selects (purried add)", () => {
    // add's data-last overload (declared first) also takes a number first,
    // but returns a function; the rewritten call has two arguments.
    const result = transform([PRELUDE, `log((1).add(2).add(3).toFixed(1));`].join("\n"));
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("add(add((1), 2), 3).toFixed(1)");
    expect(run(result.code)).toEqual(["6.0"]);
  });

  it("reports an error when the chained call cannot be rewritten, instead of leaving a TypeError", () => {
    const result = transform([PRELUDE, `log(users.sortBy((u) => u.score).nosuch());`].join("\n"));
    const errs = errors(result);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("'nosuch'");
  });
});
