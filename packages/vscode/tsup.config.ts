import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    extension: "src/extension.ts",
  },
  format: ["cjs"],
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["vscode", "typescript"],
  noExternal: ["vscode-languageclient"],
  // VSCode extensions use CJS
  platform: "node",
  target: "node18",
});
