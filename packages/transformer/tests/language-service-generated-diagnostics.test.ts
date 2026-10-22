/**
 * The editor reports an error TypeScript finds in macro-generated code at the
 * nearest enclosing node that came from the source, instead of dropping it
 * (review 8 follow-up). Driven through a REAL tsserver with the BUILT plugin.
 *
 * The case that showed it: an unannotated `@impl` instance `satisfies` the
 * typeclass's expanded type, so a missing or misspelled member is TS1360 at
 * the generated `satisfies`, a node with no source position. `typesugar
 * check --strict` reported it; the editor silently didn't, and the typo'd
 * instance built and threw at run time.
 *
 * Build first: `pnpm --filter @typesugar/transformer build`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TsServer, hasPluginBuild, writePluginProbe } from "./tsserver-harness.js";

let root: string;
let probeDir: string;

function write(rel: string, content: string | object): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

const TYPECLASSES = `
export type Kind<F, A> = F extends { readonly _: unknown } ? (F & { readonly __kind__: A })["_"] : never;

export type Option<A> = A | null;
export interface OptionF { readonly __kind__: unknown; readonly _: Option<this["__kind__"]> }

/** @typeclass */
export interface Functor<F> {
  readonly map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B>;
}
`;

describe.skipIf(!hasPluginBuild)("tsserver: errors in generated code are reported", () => {
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-tss-gen-")));
    fs.mkdirSync(path.join(root, ".git"));
    probeDir = writePluginProbe(root);
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("a misspelled @impl member is reported at the instance; a valid instance is clean", async () => {
    write("app/package.json", { name: "app", private: true, type: "module" });
    write("app/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      include: ["src"],
    });
    write("app/src/tc.ts", TYPECLASSES);
    const typo = write(
      "app/src/typo.ts",
      `import type { Functor, Option, OptionF } from "./tc.js";
/** @impl Functor<OptionF> */
export const typoFunctor = {
  mapp: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> => (fa === null ? null : f(fa)),
};
`
    );
    const valid = write(
      "app/src/valid.ts",
      `import type { Functor, Option, OptionF } from "./tc.js";
/** @impl Functor<OptionF> */
export const optionFunctor = {
  _tag: "Option" as const,
  map: <A, B>(fa: Option<A>, f: (a: A) => B): Option<B> => (fa === null ? null : f(fa)),
};
`
    );

    const server = new TsServer(root, probeDir);
    try {
      server.open(typo);
      const diags = await server.semanticDiagnostics(typo);
      const ts1360 = diags.filter((d) => d.code === 1360);
      expect(ts1360).toHaveLength(1);
      expect(ts1360[0].text).toMatch(/Property 'map' is missing/);
      // At the instance as written: its initializer, on line 3.
      expect(ts1360[0].start).toEqual({ line: 3, offset: 28 });

      server.open(valid);
      expect(await server.semanticDiagnostics(valid)).toEqual([]);
    } finally {
      await server.exit();
    }
  }, 120_000);

  it("so is a misspelled member of an instance over a plain type (Show<Date>)", async () => {
    // review 9: only an HKT instance got the `satisfies`, so `shwo` for
    // `show` was reported nowhere and `summon<Show<Date>>().show(...)` threw.
    write("plain/package.json", { name: "plain", private: true, type: "module" });
    write("plain/tsconfig.json", {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        types: [],
      },
      include: ["src"],
    });
    write(
      "plain/src/tc.ts",
      `/** @typeclass */\nexport interface Show<A> {\n  show(a: A): string;\n}\n`
    );
    const typo = write(
      "plain/src/typo.ts",
      `import type { Show } from "./tc.js";
/** @impl Show<Date> */
export const showDate = { shwo: (d: Date) => d.toISOString() };
`
    );
    const valid = write(
      "plain/src/valid.ts",
      `import type { Show } from "./tc.js";
/** @impl Show<number> */
export const showNumber = { show: (n) => n.toFixed(1), extra: 1 };
export const s: string = showNumber.show(1);
`
    );
    const server = new TsServer(root, probeDir);
    try {
      server.open(typo);
      const diags = await server.semanticDiagnostics(typo);
      expect(diags.map((d) => d.code)).toEqual([1360]);
      expect(diags[0].text).toMatch(/Property 'show' is missing/);
      expect(diags[0].start).toEqual({ line: 3, offset: 25 });

      // The typeclass types the method's parameter: no TS7006 in the editor.
      server.open(valid);
      expect(await server.semanticDiagnostics(valid)).toEqual([]);
    } finally {
      await server.exit();
    }
  }, 120_000);
});
