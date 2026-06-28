import { defineConfig } from "tsup";

export default defineConfig({
  // Per-module emit (bundle:false) so the published package mirrors `src`: every
  // module is a real, importable file with stable export names. This is required for
  // a shippable typesugar library (PEP-050): companion functions like Option's `map`
  // must be importable from their own subpath (`@typesugar/fp/data/option`) — both
  // for standalone consumers and for the transformer's `opt.map(f)` → `map(opt, f)`
  // rewrite. Bundling collapsed modules into chunks and renamed collisions (`map` →
  // `map$1`), breaking both.
  entry: ["src/**/*.ts", "!src/**/*.test.ts", "!src/examples/**", "!src/effect/**"],
  bundle: false,
  format: ["cjs", "esm"],
  // Declarations are emitted per-module by `tsc` (see the build script), NOT bundled
  // by rollup-plugin-dts (same reasoning as above).
  dts: false,
  sourcemap: true,
  clean: true,
  external: ["typescript", "@typesugar/core", "@typesugar/macros", "@typesugar/type-system"],
});
