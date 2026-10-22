/**
 * An `@impl` HKT instance keeps its own members in the expansion (turf case
 * study, round 2, item 2).
 *
 * `@impl FlatMap<OptionF>` on an unannotated const used to annotate it with
 * the typeclass's expanded type (`const flatMapOption: { readonly flatMap:
 * ...; readonly ap: ...; readonly map: ... } = { _tag: "Option", ..., orElse
 * }`), so `typesugar check --strict` reported TS2353 for every member the
 * typeclass doesn't declare (`_tag`, `orElse` in @typesugar/fp's
 * instances.ts), and the declaration emitted from the expansion dropped them:
 * a consumer couldn't call `inst.orElse`. The instance now keeps the type of
 * its own initializer, which `satisfies` the expanded type.
 *
 * Spawns the BUILT CLI (`pnpm --filter @typesugar/transformer build`).
 */

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pkgRoot, "..", "..");
const cliPath = path.join(pkgRoot, "dist", "cli.js");

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-impl-members-"));
  dirs.push(dir);
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
  fs.writeFileSync(path.join(dir, "package.json"), `{"type":"module"}`);
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        types: [],
        outDir: "out",
        rootDir: "src",
        declaration: true,
      },
      include: ["src"],
    })
  );
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

function cli(dir: string, ...args: string[]): { out: string; status: number | null } {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: dir,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), status: r.status };
}

const TYPECLASSES = `
export type Kind<F, A> = F extends { readonly _: unknown } ? (F & { readonly __kind__: A })["_"] : never;

export type Option<A> = A | null;
export interface OptionF { readonly __kind__: unknown; readonly _: Option<this["__kind__"]> }

export type Either<E, A> = { readonly left: E } | { readonly right: A };
/** A type-level function with its own parameter: E is fixed, A varies. */
export interface EitherF<E> { readonly __kind__: unknown; readonly _: Either<E, this["__kind__"]> }

/** @typeclass */
export interface Functor<F> {
  readonly map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B>;
}

/** @typeclass */
export interface FlatMap<F> extends Functor<F> {
  readonly flatMap: <A, B>(fa: Kind<F, A>, f: (a: A) => Kind<F, B>) => Kind<F, B>;
}
`;

describe("@impl on an unannotated HKT instance", () => {
  it.skipIf(!fs.existsSync(cliPath))(
    "keeps members the typeclass doesn't declare: check --strict is clean, the .d.ts has them",
    () => {
      const dir = project({
        "src/tc.ts": TYPECLASSES,
        "src/instances.ts": `import type { FlatMap, Option, OptionF } from "./tc.js";
/** @impl FlatMap<OptionF> */
export const flatMapOption = {
  _tag: "Option" as const,
  map: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> => (fa !== null ? f(fa) : null),
  flatMap: <A, B>(fa: Option<A>, f: (a: A) => Option<B>): Option<B> =>
    fa !== null ? f(fa) : null,
  orElse: <A>(fa: Option<A>, f: () => Option<A>): Option<A> => (fa !== null ? fa : f()),
};
`,
        "src/main.ts": `import { flatMapOption } from "./instances.js";
const tag: "Option" = flatMapOption._tag;
console.log(tag, flatMapOption.orElse(null, () => 3), flatMapOption.flatMap(2, (n) => n + 1));
`,
      });
      const check = cli(dir, "check", "--strict");
      expect(check.out).toBe("");
      expect(check.status).toBe(0);
      const build = cli(dir, "build");
      expect(build.out).toBe("");
      expect(build.status).toBe(0);
      const dts = fs.readFileSync(path.join(dir, "out", "instances.d.ts"), "utf-8");
      expect(dts).toMatch(/_tag: "Option"/);
      expect(dts).toMatch(/orElse:/);
      const run = spawnSync(process.execPath, [path.join(dir, "out", "main.js")], {
        encoding: "utf-8",
      });
      expect(run.stdout.trim()).toBe("Option 3 3");
    }
  );

  it.skipIf(!fs.existsSync(cliPath))(
    "types `this` in an object-literal method with the typeclass's required members",
    () => {
      // review 8: the satisfies target made every member optional, so
      // `this.map(...)` in `as` was TS2722 (possibly undefined) under strict.
      const dir = project({
        "src/tc.ts": `${TYPECLASSES}
/** @typeclass */
export interface FunctorAs<F> {
  map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
  as<A, B>(fa: Kind<F, A>, b: B): Kind<F, B>;
}
`,
        "src/inst.ts": `import type { FunctorAs, Option, OptionF } from "./tc.js";
/** @impl FunctorAs<OptionF> */
export const optFunctor = {
  map<A, B>(fa: Option<A>, f: (a: A) => B): Option<B> {
    return fa === null ? null : f(fa);
  },
  as<A, B>(fa: Option<A>, b: B): Option<B> {
    return this.map(fa, () => b);
  },
  extra: 1,
};
export const r = optFunctor.as(1, "x");
`,
      });
      const check = cli(dir, "check", "--strict");
      expect(check.out).not.toMatch(/TS2722|error/);
      expect(check.status).toBe(0);
      const build = cli(dir, "build");
      expect(build.status).toBe(0);
      const dts = fs.readFileSync(path.join(dir, "out", "inst.d.ts"), "utf-8");
      expect(dts).toMatch(/extra: number/);
      expect(dts).toMatch(/r: string \| null/);
    }
  );

  it.skipIf(!fs.existsSync(cliPath))(
    "reports a missing or misspelled member at the instance",
    () => {
      // review 8: with every member optional and an index signature, `mapp`
      // for `map` was reported nowhere (the editor used to show it), and
      // `summon<Functor<OptionF>>().map(...)` threw at run time.
      const dir = project({
        "src/tc.ts": TYPECLASSES,
        "src/inst.ts": `import type { Functor, Option, OptionF } from "./tc.js";
/** @impl Functor<OptionF> */
export const typoFunctor = {
  mapp: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> => (fa === null ? null : f(fa)),
};
`,
      });
      // Every mode reports it, at the instance as written (its initializer,
      // line 3), not in the expanded text: the TS1360 is at the generated
      // `satisfies`, which has no source position of its own. Plain `check`
      // and `build` used to drop it (the instance built, and threw at run
      // time); `--strict` reported it at the expansion's line 5.
      for (const args of [["check", "--strict"], ["check"], ["build"]]) {
        const r = cli(dir, ...args);
        expect(r.out, args.join(" ")).toMatch(/src[\\/]inst\.ts\(3,28\): error TS1360/);
        expect(r.out, args.join(" ")).toMatch(/Property 'map' is missing/);
        expect(r.out.match(/error TS1360/g), args.join(" ")).toHaveLength(1);
        expect(r.status, args.join(" ")).not.toBe(0);
      }
    }
  );

  it.skipIf(!fs.existsSync(cliPath))(
    "an instance for a type-level function with its own parameter (EitherF<E>) gets no wrong expansion",
    () => {
      // `Kind<F, A>` used to expand to `EitherF<A>` (EitherF's own parameter
      // is the FIXED E, not the hole), which check --strict reported as soon
      // as the instance's members were checked against it.
      const dir = project({
        "src/tc.ts": TYPECLASSES,
        "src/instances.ts": `import type { FlatMap, Either, EitherF } from "./tc.js";
const isRight = <E, A>(e: Either<E, A>): e is { readonly right: A } => "right" in e;
/** @impl FlatMap<EitherF> */
export const flatMapEither = {
  map: <A, B>(fa: Either<unknown, A>, f: (a: A) => B): Either<unknown, B> =>
    isRight(fa) ? { right: f(fa.right) } : fa,
  flatMap: <A, B>(fa: Either<unknown, A>, f: (a: A) => Either<unknown, B>): Either<unknown, B> =>
    isRight(fa) ? f(fa.right) : fa,
  orElse: <A>(fa: Either<unknown, A>, f: () => Either<unknown, A>): Either<unknown, A> =>
    isRight(fa) ? fa : f(),
};
`,
        "src/main.ts": `import { flatMapEither } from "./instances.js";
console.log(JSON.stringify(flatMapEither.orElse({ left: "e" }, () => ({ right: 1 }))));
`,
      });
      const check = cli(dir, "check", "--strict");
      // (`orElse` uses the module-private `isRight`: the call isn't inlined,
      // and says so with a TS9602 warning.)
      expect(check.out).not.toMatch(/error/);
      expect(check.status).toBe(0);
    }
  );
});
