import { defineConfig } from "tsup";

export default defineConfig({
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
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["typescript", "@typesugar/core", "@typesugar/macros"],
  cjsInterop: true,
  shims: true,
});
