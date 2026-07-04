/**
 * Resolution-free operator/method syntax-activation fallback (PEP-052 Wave 6).
 *
 * `readSyntaxActivationMarkers` (`resolution-scope.ts`) discovers
 * `@syntax-operators`/`@syntax-methods` markers by resolving the imported
 * module via the TypeScript checker (`checker.getSymbolAtLocation`) and
 * reading its JSDoc tags. That resolution fails in hosts with no real module
 * resolution — the `@typesugar/playground` package's in-memory compiler host,
 * or a virtual/synthetic file name outside any real `node_modules` tree — so
 * operator/method activation was silently unavailable there (Wave 2 gave
 * labeled-block macros an equivalent fallback via each macro's `syntaxModule`
 * field; Wave 3 gave do-notation instances one via
 * `resolveStdDoFallback`/`DO_FALLBACK_BY_SPECIFIER`. Neither mechanism
 * covers typeclass operators/methods, since a typeclass is not a
 * `MacroDefinition` registered in `globalRegistry` and has no `syntaxModule`
 * field to key off of).
 *
 * This is a small, PROVIDER-DECLARED registry (mirroring the design Wave 6's
 * scoping settled on after rejecting two alternatives): a package that ships
 * a marker module calls {@link registerSyntaxMarkerFallback} with the exact
 * import specifier and the typeclass names it activates, at the same
 * compile-time load point where it registers its macros. This keeps the
 * knowledge with the declaring package — `@typesugar/core` never hardcodes
 * `@typesugar/std`'s or any third party's module layout, unlike the
 * `KNOWN_DO_INSTANCE_MODULES` static table Wave 5's review flagged for doing
 * exactly that.
 *
 * A provider-declared JSDoc tag (the `@do-instance-module` pattern from Wave
 * 4/5) is not an alternative here: that mechanism scans the PROGRAM for
 * declarations, which by construction cannot see anything in a host that
 * has no real module resolution — the exact hosts this fallback exists for.
 *
 * Consulted by `scanImportsForScope` for every import specifier, additive
 * only (like the label/do fallbacks): it can only ADD activations the
 * checker-based scan missed, never remove ones it found.
 */

/** Typeclass names a marker module's import activates, by tier. */
export interface SyntaxMarkerFallbackEntry {
  /** Typeclasses whose OPERATOR syntax (tier 3) this specifier activates. */
  operators?: readonly string[];
  /** Typeclasses whose METHOD syntax (tier 2) this specifier activates. */
  methods?: readonly string[];
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
