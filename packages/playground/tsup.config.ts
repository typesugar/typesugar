import { defineConfig } from "tsup";
import { typescriptStubPlugin } from "./src/esbuild-ts-stub-plugin";

const runtimePackages = [
  "@typesugar/codec",
  "@typesugar/collections",
  "@typesugar/contracts",
  "@typesugar/core",
  "@typesugar/fp",
  "@typesugar/graph",
  "@typesugar/mapper",
  "@typesugar/parser",
  "@typesugar/std",
  "@typesugar/symbolic",
  "@typesugar/type-system",
  "@typesugar/typeclass",
  "@typesugar/units",
  "@typesugar/validate",
];

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
    noExternal: [
      "@typesugar/core",
      "@typesugar/macros",
      "@typesugar/std",
      "@typesugar/preprocessor",
      "@typesugar/transformer-core",
      "magic-string",
    ],
    external: ["typescript"],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    esbuildOptions(options) {
      options.alias = {
        fs: "./src/browser-shims/fs.ts",
        path: "./src/browser-shims/path.ts",
        crypto: "./src/browser-shims/crypto.ts",
        process: "./src/browser-shims/process.ts",
        vm: "./src/browser-shims/vm.ts",
      };
    },
  },
  {
    entry: { runtime: "src/runtime-entry.ts" },
    format: ["iife"],
    dts: false,
    sourcemap: false,
    clean: false,
    outDir: "dist",
    platform: "browser",
    target: "es2022",
    minify: true,
    bundle: true,
    noExternal: [...runtimePackages, "@typesugar/macros", "magic-string"],
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    esbuildPlugins: [typescriptStubPlugin],
    esbuildOptions(options) {
      options.alias = {
        fs: "./src/browser-shims/fs.ts",
        path: "./src/browser-shims/path.ts",
        crypto: "./src/browser-shims/crypto.ts",
        process: "./src/browser-shims/process.ts",
        vm: "./src/browser-shims/vm.ts",
        os: "./src/browser-shims/os.ts",
      };
    },
  },
]);
