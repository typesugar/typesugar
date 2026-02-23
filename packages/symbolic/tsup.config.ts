import { defineConfig } from "tsup";

export default defineConfig({
  entry: [".typesugar/index.ts"],
  format: ["esm", "cjs"],
  dts: {
    compilerOptions: {
      rootDir: "./.typesugar",
    },
  },
  clean: true,
  sourcemap: true,
});
