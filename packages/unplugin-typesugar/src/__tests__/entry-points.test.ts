/**
 * Every bundler entry point is wired end to end: a src module whose default
 * export is the matching unplugin factory, a tsup entry that builds it, and a
 * package.json subpath export that publishes it. A bundler with only a
 * `case` in unplugin.ts and no subpath (rolldown/tsdown, found by the
 * dinero.js case study) can't be imported as `unplugin-typesugar/<bundler>`.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { unplugin } from "../unplugin.js";

// Vite can't analyse a template-string dynamic import, so each entry is loaded by name.
const ENTRIES: Record<string, () => Promise<{ default: unknown }>> = {
  vite: () => import("../vite.js"),
  webpack: () => import("../webpack.js"),
  esbuild: () => import("../esbuild.js"),
  rollup: () => import("../rollup.js"),
  rolldown: () => import("../rolldown.js"),
};

const pkgDir = path.resolve(__dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const tsupConfig = fs.readFileSync(path.join(pkgDir, "tsup.config.ts"), "utf8");

const BUNDLERS = ["vite", "webpack", "esbuild", "rollup", "rolldown"] as const;

describe("bundler entry points", () => {
  for (const bundler of BUNDLERS) {
    describe(bundler, () => {
      it(`has a src module whose default export makes the ${bundler} plugin`, async () => {
        const mod = await ENTRIES[bundler]();
        // unplugin.<bundler> is a getter that returns a new factory each time,
        // and the hooks are fresh closures, so compare the shape of what the
        // factories make.
        const made = (mod.default as (o: object) => object)({});
        expect(Object.keys(made).sort()).toEqual(Object.keys(unplugin[bundler]({})).sort());
      });

      it("is built by tsup", () => {
        expect(tsupConfig).toContain(`${bundler}: "src/${bundler}.ts"`);
      });

      it(`is published as unplugin-typesugar/${bundler}`, () => {
        const entry = pkg.exports[`./${bundler}`];
        expect(entry).toEqual({
          import: { types: `./dist/${bundler}.d.ts`, default: `./dist/${bundler}.js` },
          require: { types: `./dist/${bundler}.d.cts`, default: `./dist/${bundler}.cjs` },
        });
      });
    });
  }
});
