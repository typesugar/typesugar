/**
 * `node --import @typesugar/transformer/register` (or `typesugar/register`):
 * run TypeScript through typesugar's macro expansion in Node, alone or with
 * tsx. See node-loader.ts for the contract.
 *
 * Uses `module.registerHooks()` (synchronous, in-thread; Node 22.15+ /
 * 23.5+), which also covers `require()`. On older Node it falls back to
 * `module.register()` (asynchronous hooks in a worker thread; ESM imports
 * only).
 */

import * as nodeModule from "node:module";
import { createNodeLoaderHooks } from "./node-loader.js";

const REGISTERED = Symbol.for("typesugar.register");

type ModuleWithHooks = typeof nodeModule & {
  registerHooks?: (hooks: { resolve?: unknown; load?: unknown }) => unknown;
  register?: (specifier: string | URL, parentURL?: string | URL) => void;
};

const g = globalThis as { [REGISTERED]?: boolean };
if (!g[REGISTERED]) {
  g[REGISTERED] = true;
  const m = nodeModule as ModuleWithHooks;
  if (typeof m.registerHooks === "function") {
    const hooks = createNodeLoaderHooks();
    m.registerHooks({ resolve: hooks.resolve, load: hooks.load });
  } else if (typeof m.register === "function") {
    m.register(new URL("./register-hooks.js", import.meta.url));
  } else {
    throw new Error(
      `typesugar/register needs Node.js 20.6 or later (module hooks); this is ${process.version}.`
    );
  }
}
