import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  clean: true,
  external: ["typescript", "eslint"],
});
