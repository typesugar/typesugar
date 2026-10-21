import { defineConfig } from "tsup";
import { withTypesugar } from "typesugar/tsup";

// withTypesugar adds typesugar's esbuild plugin, which expands the macros, and
// makes `dts: true` emit the declarations from the expanded program (tsup's own
// declaration step would type-check the unexpanded source).
export default defineConfig(
  withTypesugar({
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
  })
);
