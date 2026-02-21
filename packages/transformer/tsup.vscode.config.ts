import { defineConfig } from "tsup";

/**
 * Special tsup config for building a fully-bundled language-service
 * for the VS Code extension. This bundles all dependencies except
 * TypeScript (which is provided by the TS server).
 */
export default defineConfig({
  entry: {
    "language-service-bundled": "src/language-service.ts",
  },
  format: ["cjs"],
  dts: false,
  sourcemap: true,
  clean: false, // Don't clean - we add to existing dist
  splitting: false,
  external: ["typescript"], // Only TypeScript is external
  noExternal: [
    "@typesugar/core",
    "@typesugar/preprocessor",
    "@ampproject/remapping",
    "magic-string",
  ],
  cjsInterop: true,
  shims: true,
  outDir: "dist",
});
