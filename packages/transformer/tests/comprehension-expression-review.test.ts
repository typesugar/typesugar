/**
 * Expression-position let:/par: comprehensions (std agent report, review
 * #9 follow-up). Every case transforms through the real pipeline and RUNS
 * the output.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import * as ts from "typescript";
import { TransformationPipeline } from "../src/pipeline.js";
import * as std from "@typesugar/std";
import * as stdDo from "@typesugar/std/syntax/do";
import "@typesugar/macros";
import "@typesugar/std/macros";

const VDIR = path.resolve(__dirname, "__virtual_review__");
let n = 0;

function run(body: string) {
  const file = path.join(VDIR, `comp-expr-${n++}.ts`);
  const code = `import "@typesugar/std/syntax/do";\n${body}`;
  const p = new TransformationPipeline(
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      lib: ["lib.es2023.d.ts"],
    },
    [file],
    {
      readFile: (f) => (f === file ? code : ts.sys.readFile(f)),
      fileExists: (f) => f === file || ts.sys.fileExists(f),
      cacheDir: false,
    }
  );
  const r = p.transform(file);
  const errors = r.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
  const js = ts.transpileModule(r.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const req = (s: string) =>
    s === "@typesugar/std" ? std : s === "@typesugar/std/syntax/do" ? stdDo : {};
  let runError: unknown;
  // Only run output that compiled cleanly: the output of a failed compile is
  // not meant to run, and running it can leave an async ReferenceError as an
  // unhandled rejection in the suite.
  if (errors.length === 0) {
    try {
      new Function("require", "exports", "module", js)(req, mod.exports, mod);
    } catch (e) {
      runError = e;
    }
  }
  return { code: r.code, errors, exports: mod.exports, runError };
}

function ok(r: ReturnType<typeof run>) {
  if (r.errors.length || r.runError) {
    throw new Error(
      `errors: ${r.errors.join("; ")} run: ${String(r.runError)}\n--- emitted ---\n${r.code}`
    );
  }
  return r.exports;
}

// Shapes the old `const x = let;` merge mis-compiled were a TS9226 error;
// since the docs review (2026-10, A#9) the preprocessor moves them into
// statement position and they compile and run.
describe("(1) leading / nested par: in expression position", () => {
  it("const r = let: { a << ...; par: { b << ... } } yield: {...}", async () => {
    const ex = ok(
      run(
        `export const r = let: { a << Promise.resolve(1); par: { b << Promise.resolve(2) } } yield: { a + b }`
      )
    );
    await expect(ex.r).resolves.toBe(3);
  });

  it("const r = par: { ... } yield: {...}", async () => {
    const ex = ok(
      run(
        `export const r = par: { a << Promise.resolve(1); b << Promise.resolve(2) } yield: { a + b }`
      )
    );
    await expect(ex.r).resolves.toBe(3);
  });

  it("arrow body with a leading par:", async () => {
    const ex = ok(
      run(`export const f = () =>
let: {
  par: { a << Promise.resolve(1); b << Promise.resolve(2) }
}
yield: { a + b }`)
    );
    await expect((ex.f as () => Promise<unknown>)()).resolves.toBe(3);
  });

  it("a `par:` inside a string does not trigger the error", async () => {
    const ex = ok(run(`export const r = let: { a << Promise.resolve("par: {"); } yield: { a }`));
    await expect(ex.r).resolves.toBe("par: {");
  });
});

describe("(2) inside a function body", () => {
  it("const r = let: ... inside a function", () => {
    const ex = ok(
      run(`export function f() {
  const r = let: { x << [1, 2]; } yield: { x * 10 };
  return r;
}`)
    );
    expect((ex.f as () => unknown)()).toEqual([10, 20]);
  });

  it("return let: ... inside a function", () => {
    const ex = ok(
      run(`export function g() {
  return let: { x << [1, 2]; } yield: { x + 1 };
}`)
    );
    expect((ex.g as () => unknown)()).toEqual([2, 3]);
  });
});

describe("(3) arrow body bind of a bare identifier", () => {
  it("infers the type constructor of `a << n`", () => {
    const ex = ok(
      run(`const n = [1, 2];
export const f = () =>
let: {
  a << n;
}
yield: { a + 1 }`)
    );
    expect((ex.f as () => unknown)()).toEqual([2, 3]);
  });
});
