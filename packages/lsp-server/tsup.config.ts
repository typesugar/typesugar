import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    helpers: "src/helpers.ts",
    manifest: "src/manifest.ts",
    "semantic-tokens": "src/semantic-tokens.ts",
    codelens: "src/codelens.ts",
    "inlay-hints": "src/inlay-hints.ts",
    "code-actions-extra": "src/code-actions-extra.ts",
  },
  format: ["cjs", "esm"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["typescript"],
  cjsInterop: true,
  shims: true,
});
