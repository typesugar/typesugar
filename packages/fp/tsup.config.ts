import { defineConfig } from "tsup";
import typesugar from "unplugin-typesugar/esbuild";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "data/index": "src/data/index.ts",
    "io/index": "src/io/index.ts",
    "typeclasses/index": "src/typeclasses/index.ts",
    "syntax/index": "src/syntax/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["typescript", "@typesugar/type-system"],
  esbuildPlugins: [typesugar()],
});
