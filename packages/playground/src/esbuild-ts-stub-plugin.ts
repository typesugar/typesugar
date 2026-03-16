/**
 * ESBuild plugin that replaces the 'typescript' module with a lightweight stub
 * containing only enum values and no-op functions.
 *
 * Many @typesugar packages import TypeScript for their macro expand() functions,
 * but those code paths never execute at runtime in the browser sandbox.
 * This plugin avoids bundling the 5MB+ TypeScript compiler.
 */
import type { Plugin } from "esbuild";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_PATH = resolve(__dirname, "browser-shims/typescript-enums.js");

export const typescriptStubPlugin: Plugin = {
  name: "typescript-stub",
  setup(build) {
    build.onResolve({ filter: /^typescript$/ }, () => ({
      path: STUB_PATH,
    }));
  },
};
