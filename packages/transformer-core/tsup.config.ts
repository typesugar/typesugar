import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  sourcemap: true,
  clean: true,
  // Mark dependencies as external to avoid bundling them - this ensures
  // the singleton registries in @typesugar/macros and @typesugar/core
  // are shared across all consumers
  external: ["typescript", "@typesugar/macros", "@typesugar/core"],
});
