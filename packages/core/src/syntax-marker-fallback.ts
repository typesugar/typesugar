/**
 * Resolution-free syntax-activation fallback (PEP-052 Wave 6, unified with
 * Wave 2's `syntaxModule` mechanism in a later pass).
 *
 * `readSyntaxActivationMarkers` (`resolution-scope.ts`) discovers
 * `@syntax-operators`/`@syntax-methods` markers by resolving the imported
 * module via the TypeScript checker (`checker.getSymbolAtLocation`) and
 * reading its JSDoc tags. That resolution fails in hosts with no real module
 * resolution — the `@typesugar/playground` package's in-memory compiler host,
 * or a virtual/synthetic file name outside any real `node_modules` tree — so
 * operator/method activation was silently unavailable there.
 *
 * Wave 2 gave labeled-block/trigger-label macros an equivalent fallback via
 * each `MacroDefinition`'s own `syntaxModule` field (`types.ts`), originally
 * consulted through a SEPARATE index (`syntaxModuleIndex` in
 * `resolution-scope.ts`) that was rebuilt from `globalRegistry.getAll()` on
 * every single scan — real per-scan work for data that never changes once a
 * macro package has loaded. This registry now serves BOTH purposes: the
 * registry's `register()` method populates the `labels` field here directly
 * from a macro's `syntaxModule` at macro-registration time (once, not
 * per-scan), and `scanImportsForScope` consults this ONE registry instead of
 * two. (Wave 3's do-notation fallback,
 * `resolveStdDoFallback`/`DO_FALLBACK_BY_SPECIFIER`, is NOT folded in here —
 * its payload is do-instance *resolution metadata* consumed at
 * macro-expansion time, not a scan-time activation effect, so it's a
 * genuinely different mechanism despite the surface-level similarity.)
 *
 * For typeclass operators/methods specifically (which are NOT
 * `MacroDefinition`s and have no `syntaxModule` field to key off of), this is
 * a small, PROVIDER-DECLARED registry: a package that ships a marker module
 * calls {@link registerSyntaxMarkerFallback} with the exact import specifier
 * and the typeclass names it activates, at the same compile-time load point
 * where it registers its macros. This keeps the knowledge with the
 * declaring package — `@typesugar/core` never hardcodes `@typesugar/std`'s
 * or any third party's module layout, unlike the `KNOWN_DO_INSTANCE_MODULES`
 * static table Wave 5's review flagged for doing exactly that.
 *
 * A provider-declared JSDoc tag (the `@do-instance-module` pattern from Wave
 * 4/5) is not an alternative here: that mechanism scans the PROGRAM for
 * declarations, which by construction cannot see anything in a host that
 * has no real module resolution — the exact hosts this fallback exists for.
 *
 * Consulted by `scanImportsForScope` for every import specifier, additive
 * only (like the do fallback): it can only ADD activations the
 * checker-based scan missed, never remove ones it found.
 */

/** What a marker module's import activates, by tier. */
export interface SyntaxMarkerFallbackEntry {
  /** Typeclasses whose OPERATOR syntax (tier 3) this specifier activates. */
  operators?: readonly string[];
  /** Typeclasses whose METHOD syntax (tier 2) this specifier activates. */
  methods?: readonly string[];
  /**
   * Labeled-block/trigger-label macro names this specifier activates (the
   * Wave 2 `syntaxModule` mechanism, folded into this registry). Distinct
   * from `methods`/`operators`: these are macro NAMES
   * (`tracker.activateLabelSyntax`), not typeclass names.
   */
  labels?: readonly string[];
}

const syntaxMarkerFallbackRegistry = new Map<string, SyntaxMarkerFallbackEntry>();

/**
 * Register a resolution-free fallback for a syntax-activation marker module:
 * an import specifier whose text exactly matches `specifier` activates the
 * named typeclasses' operator/method syntax, even when the checker cannot
 * resolve the module. Call this at the same compile-time load point where
 * the declaring package registers its macros (e.g. its `./macros` entry).
 *
 * Merges with any existing entry for the same specifier (union of
 * `operators`/`methods`) rather than replacing it, so two registration calls
 * for the same specifier — e.g. one adding methods, a later one adding
 * operators — compose instead of one clobbering the other.
 */
export function registerSyntaxMarkerFallback(
  specifier: string,
  entry: SyntaxMarkerFallbackEntry
): void {
  const existing = syntaxMarkerFallbackRegistry.get(specifier);
  if (!existing) {
    syntaxMarkerFallbackRegistry.set(specifier, entry);
    return;
  }
  syntaxMarkerFallbackRegistry.set(specifier, {
    operators: [...new Set([...(existing.operators ?? []), ...(entry.operators ?? [])])],
    methods: [...new Set([...(existing.methods ?? []), ...(entry.methods ?? [])])],
    labels: [...new Set([...(existing.labels ?? []), ...(entry.labels ?? [])])],
  });
}

/** Look up the fallback entry for an import specifier, if one is registered. */
export function getSyntaxMarkerFallback(specifier: string): SyntaxMarkerFallbackEntry | undefined {
  return syntaxMarkerFallbackRegistry.get(specifier);
}

/** Test-only: clear all registrations. */
export function clearSyntaxMarkerFallbackRegistry(): void {
  syntaxMarkerFallbackRegistry.clear();
}
