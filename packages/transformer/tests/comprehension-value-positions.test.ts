/**
 * Comprehensions in value positions (docs review 2026-10: S#2 / A#1 / W#6,
 * A#9, A#10). Every case transforms through the real pipeline and RUNS the
 * output.
 *
 *  - `yield: <expression>` (e.g. `yield: ({ a, b })`, the form the docs use)
 *    is equivalent to `yield: { <expression> }`, for let:/seq:/par:, in every
 *    position.
 *  - `par:` / `all:` (and a `let:` with a nested `par:` group) work in value
 *    positions: `const x = par: …`, an arrow body, after `return`, inside a
 *    function body.
 *  - a `||` / `??` fallback on the FIRST bind works in value positions.
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
  const file = path.join(VDIR, `comp-value-${n++}.ts`);
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
  const warnings = r.diagnostics.filter((d) => d.severity === "warning").map((d) => d.message);
  const js = ts.transpileModule(r.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  const req = (s: string) =>
    s === "@typesugar/std" ? std : s === "@typesugar/std/syntax/do" ? stdDo : {};
  let runError: unknown;
  if (errors.length === 0) {
    try {
      new Function("require", "exports", "module", js)(req, mod.exports, mod);
    } catch (e) {
      runError = e;
    }
  }
  return { code: r.code, errors, warnings, exports: mod.exports, runError };
}

function ok(r: ReturnType<typeof run>) {
  if (r.errors.length || r.runError || /\b(let|par|seq|all|yield)\s*:/.test(r.code)) {
    throw new Error(
      `errors: ${r.errors.join("; ")} run: ${String(r.runError)}\n--- emitted ---\n${r.code}`
    );
  }
  return r.exports;
}

const P = (v: string) => `Promise.resolve(${v})`;

describe("yield: <expression> (S#2, A#1, W#6)", () => {
  it("statement position, let:", () => {
    const ex = ok(
      run(`export const out: unknown[] = [];
let: { a << [1]; b << [2]; } yield: (out.push({ a, b }));`)
    );
    expect(ex.out).toEqual([{ a: 1, b: 2 }]);
  });

  it("statement position, the doc form `yield: ({ a, b })`, compiles cleanly", () => {
    const r = run(`function f() { let: { a << ${P("1")}; b << ${P("2")}; } yield: ({ a, b }); }
export const g = f;`);
    ok(r);
  });

  it("statement position, par:", () => {
    const ex = ok(
      run(`export const out: unknown[] = [];
par: { a << [1]; b << [2]; } yield: (out.push({ a, b }));`)
    );
    expect(ex.out).toEqual([{ a: 1, b: 2 }]);
  });

  it("module-level const, let:", async () => {
    const ex = ok(
      run(`export const r = let: { a << ${P("1")}; b << ${P("2")}; } yield: ({ a, b });`)
    );
    await expect(ex.r).resolves.toEqual({ a: 1, b: 2 });
  });

  it("module-level const, seq:, multi-line", async () => {
    const ex = ok(
      run(`export const r =
seq: {
  a << ${P("1")};
  b << ${P("a + 1")};
}
yield: ({ a, b })
export const after = 3;`)
    );
    await expect(ex.r).resolves.toEqual({ a: 1, b: 2 });
    expect(ex.after).toBe(3);
  });

  it("arrow body", async () => {
    const ex = ok(
      run(`export const f = (x: number) =>
let: {
  a << ${P("x")};
  b << ${P("a * 2")};
}
yield: ({ a, b })
export const after = 3;`)
    );
    await expect((ex.f as (x: number) => Promise<unknown>)(5)).resolves.toEqual({ a: 5, b: 10 });
    expect(ex.after).toBe(3);
  });

  it("after return", () => {
    const ex = ok(
      run(`export function f() {
  return let: { a << [1, 2]; } yield: ({ v: a });
}`)
    );
    expect((ex.f as () => unknown)()).toEqual([{ v: 1 }, { v: 2 }]);
  });

  it("const inside a function body", () => {
    const ex = ok(
      run(`export function f() {
  const r = let: { a << [1, 2]; } yield: ({ v: a });
  return r;
}`)
    );
    expect((ex.f as () => unknown)()).toEqual([{ v: 1 }, { v: 2 }]);
  });

  it("the block form `yield: { ({ a, b }) }` still works", async () => {
    const ex = ok(run(`export const r = let: { a << ${P("1")}; } yield: { ({ a }) }`));
    await expect(ex.r).resolves.toEqual({ a: 1 });
  });

  it("the `yield: { { a, b } }` hint suggests a form that works", () => {
    const r = run(`export const out: unknown[] = [];
let: { a << [1]; b << [2]; } yield: { { a, b } }`);
    const hint = r.errors.join("\n");
    expect(hint).toMatch(/nested block/);
    expect(hint).toMatch(/yield: \(\{ user, posts \}\)/);
  });
});

describe("par: in value positions (A#9)", () => {
  it("module-level const x = par:", async () => {
    const ex = ok(
      run(`export const r = par: { a << ${P("1")}; b << ${P("2")}; } yield: ({ a, b });`)
    );
    await expect(ex.r).resolves.toEqual({ a: 1, b: 2 });
  });

  it("module-level const x = par: with a block yield", async () => {
    const ex = ok(
      run(`export const r = par: { a << ${P("1")}; b << ${P("2")}; } yield: { a + b }`)
    );
    await expect(ex.r).resolves.toBe(3);
  });

  it("arrow body par:", async () => {
    const ex = ok(
      run(`export const f = (x: number) =>
par: {
  a << ${P("x")};
  b << ${P("x + 1")};
}
yield: ({ a, b })`)
    );
    await expect((ex.f as (x: number) => Promise<unknown>)(1)).resolves.toEqual({ a: 1, b: 2 });
  });

  it("return par: inside a function", async () => {
    const ex = ok(
      run(`export function f() {
  return par: { a << ${P("1")}; b << ${P("2")}; } yield: { a + b };
}`)
    );
    await expect((ex.f as () => Promise<unknown>)()).resolves.toBe(3);
  });

  it("const x = par: inside a function body", async () => {
    const ex = ok(
      run(`export async function f() {
  const p = par: { a << ${P("1")}; b << ${P("2")}; } yield: ({ a, b });
  return await p;
}`)
    );
    await expect((ex.f as () => Promise<unknown>)()).resolves.toEqual({ a: 1, b: 2 });
  });

  it("let: with a leading par: group, as a const", async () => {
    const ex = ok(
      run(
        `export const r = let: { par: { a << ${P("1")}; b << ${P("2")}; } c << ${P("a + b")}; } yield: { c * 10 }`
      )
    );
    await expect(ex.r).resolves.toBe(30);
  });

  it("let: with a nested par: group, as an arrow body", async () => {
    const ex = ok(
      run(`export const f = () =>
let: {
  a << ${P("1")};
  par: { b << ${P("2")}; c << ${P("3")}; }
}
yield: ({ a, b, c })`)
    );
    await expect((ex.f as () => Promise<unknown>)()).resolves.toEqual({ a: 1, b: 2, c: 3 });
  });

  it("the TS9222 help for a discarded par: suggests a form that works", () => {
    const r = run(`par: { a << ${P("1")}; b << ${P("2")}; } yield: { a + b }`);
    const help = r.warnings.join("\n");
    expect(help).toMatch(/discarded/);
  });
});

describe("fallback on the first bind in value positions (A#10)", () => {
  const decls = `const loadConfig = (): Promise<{ v: number }> => Promise.reject(new Error("x"));
const defaultConfig = () => ({ v: 7 });`;

  it("module-level const, || fallback", async () => {
    const ex = ok(
      run(`${decls}
export const r = let: { config << loadConfig() || defaultConfig(); } yield: { config.v };`)
    );
    await expect(ex.r).resolves.toBe(7);
  });

  it("module-level const, ?? fallback, more binds", async () => {
    const ex = ok(
      run(`${decls}
export const r = let: {
  config << loadConfig() ?? defaultConfig();
  b << ${P("config.v + 1")};
} yield: ({ v: config.v, b });`)
    );
    await expect(ex.r).resolves.toEqual({ v: 7, b: 8 });
  });

  it("arrow body, || fallback", async () => {
    const ex = ok(
      run(`${decls}
export const f = () =>
let: {
  config << loadConfig() || defaultConfig();
}
yield: { config.v }`)
    );
    await expect((ex.f as () => Promise<unknown>)()).resolves.toBe(7);
  });
});

describe("module-level const: shapes the old error-recovery merge mangled", () => {
  it("a generic type argument inside the first bind", async () => {
    const ex = ok(
      run(
        `export const r = let: { x << (Promise.resolve(2) as Promise<number>); } yield: { x * 2 }`
      )
    );
    await expect(ex.r).resolves.toBe(4);
  });

  it("a failed expansion is a clean error and keeps the declaration", () => {
    const r = run(`export const r = let: { x << 42; } yield: { x }`);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.code).toMatch(/const r = __letyield_\d+/);
  });
});
