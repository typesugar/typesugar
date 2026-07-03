import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/macros.ts", "src/syntax.ts"],
  format: ["cjs", "esm"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  sourcemap: true,
  clean: true,
  external: ["typescript", "@typesugar/core", "@typesugar/type-system"],
});
