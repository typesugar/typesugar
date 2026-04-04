import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  clean: true,
  sourcemap: true,
  external: ["@typesugar/macros", "@typesugar/std"],
});
