import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "path";
import typesugar from "unplugin-typesugar/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    typesugar({
      tsconfig: path.resolve(__dirname, "../../tsconfig.json"),
      verbose: false,
    }),
  ],
  test: {
    name: "@typesugar/mapper",
    globals: true,
    environment: "node",
  },
});
