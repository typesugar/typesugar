import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: { __TYPESUGAR_ESLINT_PLUGIN_VERSION__: JSON.stringify(version) },
  test: {
    name: "@typesugar/eslint-plugin",
    globals: true,
    environment: "node",
  },
});
