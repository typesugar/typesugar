import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", macros: "src/macros.ts", "syntax/do": "src/syntax/do.ts" },
  format: ["cjs", "esm"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  sourcemap: true,
  clean: true,
  external: [
    "typescript",
    "@typesugar/core",
    "@typesugar/std",
    "@typesugar/testing",
    "@typesugar/type-system",
    "effect",
  ],
});
