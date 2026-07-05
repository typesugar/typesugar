/**
 * @deprecated Moved to `@typesugar/transformer-core` in PEP-056 Wave 3 — it
 * only ever needed `ts.Program` + injectable file access, no genuine Node
 * dependency. Import from `@typesugar/transformer-core` directly; this
 * re-export exists only for backward-compatible relative import paths within
 * this package's own dist output and will be removed once nothing depends
 * on it.
 */
export {
  discoverOpaqueTypesFromImports,
  resetDtsDiscovery,
  type DtsFileAccess,
} from "@typesugar/transformer-core";
