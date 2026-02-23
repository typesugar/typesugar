import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: ".typesugar/index.ts",
    "data/index": ".typesugar/data/index.ts",
    "io/index": ".typesugar/io/index.ts",
    "typeclasses/index": ".typesugar/typeclasses/index.ts",
    "syntax/index": ".typesugar/syntax/index.ts",
  },
  format: ["cjs", "esm"],
  dts: {
    compilerOptions: {
      rootDir: "./.typesugar",
    },
  },
  sourcemap: true,
  clean: true,
  external: ["typescript", "@typesugar/type-system"],
});
