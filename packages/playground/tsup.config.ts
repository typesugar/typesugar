import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["typescript"],
    outDir: "dist",
  },
  {
    entry: { browser: "src/browser.ts" },
    format: ["esm"],
    dts: false,
    sourcemap: true,
    clean: false,
    outDir: "dist",
    platform: "browser",
    target: "es2022",
    minify: false,
    bundle: true,
    noExternal: ["@typesugar/core", "@typesugar/macros", "@typesugar/preprocessor", "magic-string"],
    external: ["typescript"],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    esbuildOptions(options) {
      options.alias = {
        fs: "./src/browser-shims/fs.ts",
        path: "./src/browser-shims/path.ts",
        crypto: "./src/browser-shims/crypto.ts",
      };
    },
  },
]);
