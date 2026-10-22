import { defineConfig } from "tsup";
import { withTypesugar } from "typesugar/tsup";

// withTypesugar adds typesugar's esbuild plugin, which expands the macros, and
// makes `dts: true` emit the declarations from the expanded program (tsup's own
// declaration step would type-check the unexpanded source). tsup bundles them
// into one .d.ts per entry, which keeps instances, derives and extractors
// working for consumers. If you add `@opaque` types, ship per-module
// declarations and JavaScript instead (bundle: false, `typesugar build
// --emitDeclarationOnly`): see "Authoring & Shipping a typesugar Library".
export default defineConfig(
  withTypesugar({
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
  })
);
