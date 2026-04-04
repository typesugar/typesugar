import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/macro.ts"],
  format: ["esm", "cjs"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  sourcemap: true,
  clean: true,
  external: ["typescript", "vitest", "@typesugar/core", "@typesugar/macros"],
});
