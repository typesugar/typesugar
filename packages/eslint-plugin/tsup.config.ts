import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: !process.env.TYPESUGAR_SKIP_DTS,
  clean: true,
  external: ["typescript", "eslint"],
  define: { __TYPESUGAR_ESLINT_PLUGIN_VERSION__: JSON.stringify(version) },
});
