import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    vite: "src/vite.ts",
    webpack: "src/webpack.ts",
    esbuild: "src/esbuild.ts",
    rollup: "src/rollup.ts",
  },
  format: ["cjs", "esm"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  sourcemap: true,
  clean: true,
  external: ["typescript", "@typesugar/transformer", "@typesugar/preprocessor", "unplugin"],
});
