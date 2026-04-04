import { defineConfig } from "tsup";
import typesugar from "unplugin-typesugar/esbuild";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "typeclasses/index": "src/typeclasses/index.ts",
    "typeclasses/flatmap": "src/typeclasses/flatmap.ts",
    "extensions/index": "src/extensions/index.ts",
    "data/index": "src/data/index.ts",
    "macros/index": "src/macros/index.ts",
  },
  format: ["cjs", "esm"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  sourcemap: true,
  clean: true,
  external: ["typescript", "@typesugar/core", "@typesugar/macros"],
  esbuildPlugins: [typesugar()],
});
