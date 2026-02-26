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
  },
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["typescript", "@typesugar/core"],
  cjsInterop: true,
  shims: true,
});
