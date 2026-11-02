/**
 * Asynchronous module hooks for `module.register()`, used by `register.ts`
 * on Node versions without `module.registerHooks()`. Runs in Node's loader
 * worker thread.
 */

import { createNodeLoaderHooks } from "./node-loader.js";

const hooks = createNodeLoaderHooks();

export const resolve = hooks.resolveAsync;
export const load = hooks.loadAsync;
