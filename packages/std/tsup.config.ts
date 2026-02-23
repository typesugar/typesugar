import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: ".typesugar/index.ts",
    "typeclasses/index": ".typesugar/typeclasses/index.ts",
    "typeclasses/flatmap": ".typesugar/typeclasses/flatmap.ts",
    "extensions/index": ".typesugar/extensions/index.ts",
    "data/index": ".typesugar/data/index.ts",
    "macros/index": ".typesugar/macros/index.ts",
  },
  format: ["cjs", "esm"],
  dts: {
    compilerOptions: {
      rootDir: "./.typesugar",
    },
  },
  sourcemap: true,
  clean: true,
  external: ["typescript", "@typesugar/core"],
});
