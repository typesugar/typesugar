import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    core: "src/core.ts",
    transformer: "src/transformer.ts",
    vite: "src/vite.ts",
    webpack: "src/webpack.ts",
    esbuild: "src/esbuild.ts",
    rollup: "src/rollup.ts",
    cli: "src/cli.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "typescript",
    "@typesugar/core",
    "@typesugar/macros",
    "@typesugar/transformer",
    "@typesugar/comptime",
    "@typesugar/reflect",
    "@typesugar/derive",
    "@typesugar/typeclass",
    "@typesugar/specialize",
    "unplugin-typesugar",
  ],
});
