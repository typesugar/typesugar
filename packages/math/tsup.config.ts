import { defineConfig } from "tsup";

export default defineConfig({
  entry: [".typesugar/index.ts"],
  format: ["cjs", "esm"],
  dts: {
    compilerOptions: {
      rootDir: "./.typesugar",
    },
  },
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
