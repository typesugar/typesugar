/**
 * Docs review 2026-10 (docs-guides-c #5, #6): summon() examples from
 * docs/guides/typeclasses.md, run through the REAL transformer pipeline
 * (built dist) and executed.
 *
 * - C#6: `summon<Functor<Array>>()` resolved to the Option instance (the
 *   checker's `any` error type for a bare `Array` matched every instance), so
 *   it printed NaN with no diagnostic.
 * - C#5: `S: Show<A> = summon<Show<A>>()` gave a bare TS9001; it now says
 *   to use `= implicit()`.
 */
import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-ignore -- load the transformer's built pipeline directly (as other e2e tests do)
import { transformCode } from "../../transformer/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let counter = 0;

function transformAndRun(code: string): { code: string; errors: string[]; logs: unknown[] } {
  const fileName = path.resolve(here, `__summon_docs_${counter++}.ts`);
  const r = transformCode(code, { fileName });
  const errors = (r.diagnostics ?? [])
    .filter((d: { severity?: string }) => d.severity === "error")
    .map((d: { message?: string }) => String(d.message));
  const logs: unknown[] = [];
  if (errors.length === 0) {
    const js = ts.transpileModule(r.code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const mod = { exports: {} };
    const req = (spec: string) => {
      if (spec === "typesugar") return {};
      throw new Error(`unexpected require(${spec}) in emitted code`);
    };
    new Function("require", "exports", "module", "console", js)(req, mod.exports, mod, {
      log: (v: unknown) => logs.push(v),
    });
  }
  return { code: r.code, errors, logs };
}

const HKT_PRELUDE = `import { summon } from "typesugar";
type Option<A> = A | null;
type Either<E, A> = { _tag: "Left"; error: E } | { _tag: "Right"; value: A };

/** @typeclass */
interface Functor<F> {
  map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
}

/** @impl Functor<Option> */
const optionFunctor = {
  map: (fa, f) => (fa === null ? null : f(fa)),
};

/** @impl Functor<Either<string>> */
const eitherStringFunctor = {
  map: (fa, f) => (fa._tag === "Left" ? fa : { _tag: "Right", value: f(fa.value) }),
};
`;

describe("summon<Functor<F>>() for a bare type constructor (C#6)", () => {
  it("reports TS9001 for Functor<Array> when no Array instance exists (not the Option one)", () => {
    const r = transformAndRun(
      HKT_PRELUDE + `console.log(summon<Functor<Array>>().map([1, 2, 3], (x) => x * 2));\n`
    );
    expect(r.errors.join("\n")).toContain("TS9001");
    expect(r.errors.join("\n")).toContain("Functor<Array>");
    expect(r.code).not.toContain("optionFunctor.map([1, 2, 3]");
  });

  it("resolves Functor<Array> to a declared Array instance, and Option still to Option", () => {
    const r = transformAndRun(
      HKT_PRELUDE +
        `/** @impl Functor<Array> */
const arrayFunctor = { map: (fa, f) => fa.map(f) };
console.log(summon<Functor<Array>>().map([1, 2, 3], (x) => x * 2));
console.log(summon<Functor<Option>>().map(3, (x: number) => x + 1));
console.log(summon<Functor<Option>>().map(null, (x: number) => x));
`
    );
    expect(r.errors).toEqual([]);
    expect(r.logs).toEqual([[2, 4, 6], 4, null]);
  });
});

describe("summon<TC<A>>() for a type parameter A (C#5)", () => {
  it("TS9001 suggests `= implicit()` for a generic instance-parameter default", () => {
    const r = transformAndRun(`import { summon } from "typesugar";
/** @typeclass */
interface Show<A> { show(a: A): string; }
function print<A>(value: A, S: Show<A> = summon<Show<A>>()): void {
  console.log(S.show(value));
}
`);
    const msg = r.errors.join("\n");
    expect(msg).toContain("TS9001");
    expect(msg).toContain("type parameter");
    expect(msg).toContain("= implicit()");
  });
});

describe("extend(x) stored in a variable (round-2 docs finding)", () => {
  // extend(value).method(args) compiles to instance.method(value, args): it
  // is a call form, not a wrapper value, so `const e = extend(x)` has nothing
  // to bind. That stays an error, but it says what to write instead.
  it("says to call the method in the same expression, or use method syntax or summon", () => {
    const r = transformAndRun(`import { extend } from "typesugar";
/** @typeclass */
interface Show<A> { show(a: A): string; }
/** @impl Show<number> */
const showNumber: Show<number> = { show: (n) => "#" + n };
const x: number = 3;
const e = extend(x);
console.log(e.show());
`);
    const msg = r.errors.join("\n");
    expect(msg).toContain("extend(x).show()");
    expect(msg).toContain("x.show()");
    expect(msg).toContain("summon<Show<");
    expect(msg).not.toContain("extend(value)");
  });

  it("extend(x).show() in one expression compiles to the instance call and runs", () => {
    const r = transformAndRun(`import { extend } from "typesugar";
/** @typeclass */
interface Show<A> { show(a: A): string; }
/** @impl Show<number> */
const showNumber: Show<number> = { show: (n) => "#" + n };
const x: number = 3;
console.log(extend(x).show());
`);
    expect(r.errors).toEqual([]);
    expect(r.logs).toEqual(["#3"]);
  });
});
