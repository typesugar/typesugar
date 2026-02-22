import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    transformer: "src/transforms/macro-transformer.ts",
    cli: "src/cli/index.ts",
    "language-service": "src/language-service/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["typescript", "unplugin"],
  // ts-patch expects a default export from the transformer, so we need
  // CJS interop to work correctly
  cjsInterop: true,
  // Shims for __dirname/__filename in ESM
  shims: true,
});
