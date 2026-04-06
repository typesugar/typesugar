import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "macro-loader": "src/macro-loader.ts",
      cli: "src/cli.ts",
      init: "src/init.ts",
      doctor: "src/doctor.ts",
      create: "src/create.ts",
      "language-service": "src/language-service.ts",
      pipeline: "src/pipeline.ts",
      "virtual-host": "src/virtual-host.ts",
      "position-mapper": "src/position-mapper.ts",
      "source-map-utils": "src/source-map-utils.ts",
      cache: "src/cache.ts",
      profiling: "src/profiling.ts",
      "dts-transform": "src/dts-transform.ts",
      "dts-opaque-discovery": "src/dts-opaque-discovery.ts",
    },
    format: ["cjs", "esm"],
    dts: !process.env.TYPESUGAR_SKIP_DTS,
    sourcemap: true,
    clean: true,
    splitting: false,
    external: ["typescript", "@typesugar/core", "@typesugar/macros"],
    cjsInterop: true,
    shims: true,
  },
  // Fully self-contained CJS bundle for VS Code extension ts-plugin
  {
    entry: { "language-service-bundled": "src/language-service.ts" },
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
