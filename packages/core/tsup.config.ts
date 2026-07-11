import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  sourcemap: true,
  clean: true,
  external: ["typescript", "cosmiconfig"],
  // Without this, tsup's CJS output replaces `import.meta.url` with an
  // empty object literal instead of a working polyfill, breaking
  // `config.ts`'s `createRequire(import.meta.url)` for CJS consumers.
  // Matches `packages/transformer`'s tsup config, which needs the same
  // shim for its own `createRequire(import.meta.url)` use.
  shims: true,
});
