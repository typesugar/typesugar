/**
 * Re-export the tsup helper (typesugar's esbuild plugin, plus `.d.ts` from the
 * expanded program for tsup's `dts` step).
 */
export { withTypesugar, DTS_CACHE_DIR, type TypesugarPluginOptions } from "unplugin-typesugar/tsup";
