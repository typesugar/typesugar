/**
 * @deprecated Moved to `@typesugar/core` in PEP-056 Wave 3 (shared by both
 * the CLI/legacy pipeline and `@typesugar/transformer-core`, not just this
 * one). Import from `@typesugar/core` directly; this re-export exists only
 * for backward-compatible relative import paths within this package's own
 * dist output and will be removed once nothing depends on it.
 */
export {
  profiler,
  PROFILING_ENABLED,
  type FileTimings,
  type AggregatedStats,
} from "@typesugar/core";
