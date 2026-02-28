import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "typescript",
    "@typesugar/core",
    "@typesugar/std",
    "@typesugar/units",
    "@typesugar/geometry",
  ],
});
