/**
 * Type Rewrite Registry
 *
 * Maps opaque type names to their underlying representations. Populated by
 * PEP-012's `@opaque` macro at transformer init time; consulted by the
 * TypeRewriteAssignment SFINAE rule (PEP-011 Wave 5) to suppress assignment
 * errors when the other side of the assignment matches the underlying type.
 *
 * @example
 * ```typescript
 * // @opaque transforms `type Option<T> = T | null` into an interface,
 * // but registers the underlying type so SFINAE can still suppress:
 * registerTypeRewrite("Option", "T | null");
 *
 * // The SFINAE rule then allows:
 * //   const o: Option<number> = nullableValue;  // no error
 * //   const n: number | null  = someOption;     // no error
 * ```
 *
 * @see PEP-011 Wave 5 — TypeRewriteAssignment SFINAE rule
 * @see PEP-012 — Type Macros (@opaque)
 */

/**
 * Entry in the type rewrite registry describing how an opaque type
 * maps to its underlying runtime representation.
 */
export interface TypeRewriteEntry {
  /**
   * The opaque type name as it appears in source code.
   * For generic types, this is the unparameterized name (e.g., "Option").
   */
  readonly typeName: string;

  /**
   * A string representation of the underlying type that the opaque type
   * erases to at runtime. Used for display/audit purposes.
   *
   * For generic types, type parameters appear as-is (e.g., "T | null").
   */
  readonly underlyingTypeText: string;

  /**
   * Optional callback that checks whether a given TypeScript type (as a
   * string from `checker.typeToString()`) matches the underlying
   * representation.
   *
   * When not provided, the SFINAE rule falls back to structural
   * assignability checking via the type checker.
   */
  readonly matchesUnderlying?: (typeText: string) => boolean;
}

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

const registry = new Map<string, TypeRewriteEntry>();

/**
 * Register an opaque type's underlying representation.
 *
 * Called by `@opaque` macro processing (PEP-012) during transformer init.
 * The SFINAE rule consults this registry to decide whether to suppress
 * assignment errors involving the registered type.
 *
 * @param entry - The type rewrite entry to register
 */
export function registerTypeRewrite(entry: TypeRewriteEntry): void {
  registry.set(entry.typeName, entry);
}

/**
 * Look up a type rewrite entry by opaque type name.
 *
 * @param typeName - The opaque type name (unparameterized, e.g., "Option")
 * @returns The registry entry, or `undefined` if not registered
 */
export function getTypeRewrite(typeName: string): TypeRewriteEntry | undefined {
  return registry.get(typeName);
}

/**
 * Check whether a type name is registered in the rewrite registry.
 */
export function hasTypeRewrite(typeName: string): boolean {
  return registry.has(typeName);
}

/**
 * Get all registered type rewrite entries (snapshot).
 */
export function getAllTypeRewrites(): readonly TypeRewriteEntry[] {
  return Array.from(registry.values());
}

/**
 * Remove all registered type rewrites. Intended for testing only.
 */
export function clearTypeRewrites(): void {
  registry.clear();
}

/**
 * Try to find a type rewrite entry for a type string.
 *
 * Handles both exact matches and generic type names by stripping
 * type parameters (e.g., "Option<number>" → "Option").
 *
 * @param typeText - The type as rendered by `checker.typeToString()`
 * @returns The matching entry, or `undefined`
 */
export function findTypeRewrite(typeText: string): TypeRewriteEntry | undefined {
  // Exact match
  const exact = registry.get(typeText);
  if (exact) return exact;

  // Strip generic parameters: "Option<number>" → "Option"
  const stripped = typeText.replace(/<.*>$/, "");
  if (stripped !== typeText) {
    const generic = registry.get(stripped);
    if (generic) return generic;
  }

  return undefined;
}
