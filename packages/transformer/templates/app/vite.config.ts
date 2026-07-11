import { defineConfig } from "vite";
import typesugar from "unplugin-typesugar/vite";

export default defineConfig({
  plugins: [typesugar()],
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
