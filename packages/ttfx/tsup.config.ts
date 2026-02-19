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
    "@ttfx/core",
    "@ttfx/transformer",
    "@ttfx/comptime",
    "@ttfx/reflect",
    "@ttfx/derive",
    "@ttfx/operators",
    "@ttfx/typeclass",
    "@ttfx/specialize",
    "unplugin-ttfx",
  ],
});
