import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      // Library entry ("." export) — side-effect free.
      index: "src/index.ts",
      // The runnable server: opens the LSP connection on load. Bin/script only.
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
  },
  // Fully self-contained CJS bundle for VS Code extension packaging
  {
    entry: { "server-bundled": "src/server.ts" },
    format: ["cjs"],
    dts: false,
    sourcemap: true,
    clean: false,
    splitting: false,
    external: ["typescript"],
    noExternal: [/.*/],
    cjsInterop: true,
    shims: true,
  },
]);
