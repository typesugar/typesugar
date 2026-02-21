import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    external: ["typescript", "prettier"],
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    external: ["typescript", "prettier"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
