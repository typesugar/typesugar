/**
 * The plugin's version, injected from package.json at build time (tsup
 * `define`; vitest.config.ts defines it for tests) rather than hard-coded.
 *
 * When the define is absent (e.g. the repo-root vitest run, where the
 * package's own `define` does not apply), read package.json directly: it is
 * one directory up from both `src/version.ts` and the bundled `dist/index.js`.
 */
import { readFileSync } from "node:fs";

declare const __TYPESUGAR_ESLINT_PLUGIN_VERSION__: string | undefined;

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      name?: string;
      version?: string;
    };
    if (pkg.name === "@typesugar/eslint-plugin" && typeof pkg.version === "string") {
      return pkg.version;
    }
  } catch {
    // fall through
  }
  return "0.0.0-dev";
}

export const PLUGIN_VERSION: string =
  typeof __TYPESUGAR_ESLINT_PLUGIN_VERSION__ === "string"
    ? __TYPESUGAR_ESLINT_PLUGIN_VERSION__
    : readPackageVersion();
