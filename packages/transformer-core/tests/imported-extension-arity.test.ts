/**
 * An imported function is an extension for `recv.method(args)` only when it
 * can take the rewritten call: the receiver plus the call's arguments
 * (remeda case study, finding F9).
 *
 * A generic first parameter accepts almost any receiver: remeda's
 * one-parameter `isArray<T>(data: ArrayLike<unknown> | T)` matched
 * `Array.isArray(c)`, which became `isArray(Array, c)`, false for every
 * array. A receiver's own method now wins over imports (typesugar #102), so
 * that call stays native anyway, but the same mismatch picks the wrong
 * provider, or reports a false ambiguity, for a method the receiver lacks.
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
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "imported-ext-arity-")));
  try {
    const files: Record<string, string> = {
      "node_modules/fakeremeda/package.json": JSON.stringify({
        name: "fakeremeda",
        version: "1.0.0",
        types: "index.d.ts",
      }),
      "node_modules/fakeremeda/index.d.ts": FAKE_REMEDA,
      "node_modules/fakeone/package.json": JSON.stringify({
        name: "fakeone",
        version: "1.0.0",
        types: "index.d.ts",
      }),
      "node_modules/fakeone/index.d.ts": FAKE_ONE,
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

// remeda's own shapes: `isArray` takes one argument; `take` and `between`
// take the data plus their own arguments.
const FAKE_REMEDA = [
  "export declare function isArray<T>(data: ArrayLike<unknown> | T): boolean;",
  "export declare function take<T>(data: ReadonlyArray<T>, n: number): T[];",
  "export declare function between<T>(data: ReadonlyArray<T>, from: number, to: number): T[];",
].join("\n");

// A one-parameter function of the same name from another library.
const FAKE_ONE = "export declare function take<T>(data: T): T;";

const RUNTIME: Record<string, unknown> = {
  fakeremeda: {
    isArray: (data: unknown) => Array.isArray(data),
    take: (data: number[], n: number) => data.slice(0, n),
    between: (data: number[], from: number, to: number) => data.slice(from, to),
  },
  fakeone: { take: (data: unknown) => data },
};

/** Transpile to CJS and run; `log` collects console.log output. */
function run(code: string): unknown[] {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const logged: unknown[] = [];
  const req = (m: string) => {
    if (m in RUNTIME) return RUNTIME[m];
    throw new Error(`unexpected runtime import of '${m}'`);
  };
  new Function("exports", "require", "log", js)({}, req, (v: unknown) => logged.push(v));
  return logged;
}

const errors = (r: TransformCodeResult) => r.diagnostics.filter((d) => d.severity === "error");

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

describe("an imported extension must take the rewritten call's arguments (remeda F9)", () => {
  it("picks the import that takes the call over one that can't: xs.take(2)", () => {
    // Both take an array first; only R.take takes the receiver plus `2`.
    const result = transform(
      [
        `import { take } from "fakeone";`,
        `import * as R from "fakeremeda";`,
        `declare function log(v: unknown): void;`,
        `const xs = [3, 1, 2];`,
        `log(xs.take(2));`,
        `log(take(xs));`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("R.take(xs, 2)");
    expect(run(result.code)).toEqual([
      [3, 1],
      [3, 1, 2],
    ]);
  });

  it("a spread argument does not rule an import out", () => {
    const result = transform(
      [
        `import * as R from "fakeremeda";`,
        `declare function log(v: unknown): void;`,
        `const xs = [3, 1, 2];`,
        `const range: [number, number] = [1, 3];`,
        `log(xs.between(...range));`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    // Counted as written, the call passes 2 arguments and `between` needs 3.
    expect(result.code).toContain("R.between(xs, ...range)");
    expect(run(result.code)).toEqual([[1, 2]]);
  });

  it("Array.isArray(c) stays native with remeda's isArray imported", () => {
    const result = transform(
      [
        `import { isArray } from "fakeremeda";`,
        `declare function log(v: unknown): void;`,
        `const c: unknown = [1];`,
        `log(Array.isArray(c));`,
        `log(isArray(c));`,
      ].join("\n")
    );
    expect(errors(result)).toEqual([]);
    expect(result.code).toContain("log(Array.isArray(c))");
    expect(run(result.code)).toEqual([true, true]);
  });
});
