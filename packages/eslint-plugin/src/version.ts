/**
 * The plugin's version, injected from package.json at build time (tsup
 * `define`; vitest.config.ts defines it for tests) rather than hard-coded.
 */
declare const __TYPESUGAR_ESLINT_PLUGIN_VERSION__: string | undefined;

export const PLUGIN_VERSION: string =
  typeof __TYPESUGAR_ESLINT_PLUGIN_VERSION__ === "string"
    ? __TYPESUGAR_ESLINT_PLUGIN_VERSION__
    : "0.0.0-dev";
