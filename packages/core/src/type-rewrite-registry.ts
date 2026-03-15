/**
 * Type Rewrite Registry
 *
 * Maps opaque type names to their underlying representations. Populated by
 * PEP-012's `@opaque` macro at transformer init time; consulted by:
 *
 * - The transformer (for method/constructor/accessor erasure)
 * - PEP-011's SFINAE Rule 2 (for implicit conversion diagnostics)
 * - The language service plugin (for completions and quick info)
 *
 * @example
 * ```typescript
 * registerTypeRewrite({
 *   typeName: "Option",
 *   sourceModule: "@typesugar/fp/data/option",
 *   underlyingTypeText: "T | null",
 *   methods: new Map([["map", "map"], ["flatMap", "flatMap"]]),
 *   constructors: new Map([
 *     ["Some", { kind: "identity" }],
 *     ["None", { kind: "constant", value: "null" }],
 *   ]),
 *   accessors: new Map(),
 *   transparent: true,
 * });
 * ```
 *
 * @see PEP-011 Wave 5 — TypeRewriteAssignment SFINAE rule
 * @see PEP-012 — Type Macros (@opaque)
 */

// ---------------------------------------------------------------------------
// Rewrite sub-entry interfaces
// ---------------------------------------------------------------------------

/**
 * Describes how a constructor call for an opaque type is erased at runtime.
 *
 * - `"identity"`: erase to the argument itself (e.g., `Some(x)` → `x`)
 * - `"constant"`: erase to a constant value (e.g., `None` → `null`)
 * - `"custom"`: erase to an arbitrary expression in {@link value}
 */
export interface ConstructorRewrite {
  readonly kind: "identity" | "constant" | "custom";
  /** The constant or custom expression. Required for `"constant"` and `"custom"`. */
  readonly value?: string;
}

/**
 * Describes how a property access on an opaque type is erased at runtime.
 *
 * - `"identity"`: erase to the receiver itself (e.g., `x.value` → `x`)
 * - `"custom"`: erase to an arbitrary expression in {@link value}
 */
export interface AccessorRewrite {
  readonly kind: "identity" | "custom";
  /** The custom expression. Required for `"custom"`. */
  readonly value?: string;
}

// ---------------------------------------------------------------------------
// TypeRewriteEntry
// ---------------------------------------------------------------------------

/**
 * Entry in the type rewrite registry describing how an opaque type
 * maps to its underlying runtime representation, including method,
 * constructor, and accessor erasure rules.
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

  /**
   * The module where the type and its companion functions are defined.
   * Used for import injection when rewriting method calls.
   *
   * @example "@typesugar/fp/data/option"
   */
  readonly sourceModule?: string;

  /**
   * Method name → standalone function name that implements it.
   * The transformer rewrites `x.method(args)` to `fn(x, args)`.
   */
  readonly methods?: ReadonlyMap<string, string>;

  /**
   * Constructor name → rewrite rule.
   * The transformer erases constructor calls according to the rule.
   */
  readonly constructors?: ReadonlyMap<string, ConstructorRewrite>;

  /**
   * Property name → rewrite rule.
   * The transformer erases property accesses according to the rule.
   */
  readonly accessors?: ReadonlyMap<string, AccessorRewrite>;

  /**
   * Whether the type is transparent within its defining file.
   * When `true`, the transformer skips rewriting inside {@link sourceModule}.
   */
  readonly transparent?: boolean;
}

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

// Module-level singleton registry. Populated by @opaque macro at transformer init,
// consulted by SFINAE rules and the transformer during compilation.
// For test isolation, use clearTypeRewrites() or the test helpers in test-helpers.ts.
const byName = new Map<string, TypeRewriteEntry>();
const byModule = new Map<string, TypeRewriteEntry[]>();

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
  byName.set(entry.typeName, entry);

  if (entry.sourceModule) {
    const list = byModule.get(entry.sourceModule);
    if (list) {
      const idx = list.findIndex((e) => e.typeName === entry.typeName);
      if (idx >= 0) {
        list[idx] = entry;
      } else {
        list.push(entry);
      }
    } else {
      byModule.set(entry.sourceModule, [entry]);
    }
  }
}

/**
 * Look up a type rewrite entry by opaque type name.
 *
 * @param typeName - The opaque type name (unparameterized, e.g., "Option")
 * @returns The registry entry, or `undefined` if not registered
 */
export function getTypeRewrite(typeName: string): TypeRewriteEntry | undefined {
  return byName.get(typeName);
}

/**
 * Check whether a type name is registered in the rewrite registry.
 */
export function hasTypeRewrite(typeName: string): boolean {
  return byName.has(typeName);
}

/**
 * Get all registered type rewrite entries (snapshot).
 */
export function getAllTypeRewrites(): readonly TypeRewriteEntry[] {
  return Array.from(byName.values());
}

/**
 * Remove all registered type rewrites. Intended for testing only.
 */
export function clearTypeRewrites(): void {
  byName.clear();
  byModule.clear();
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
  const exact = byName.get(typeText);
  if (exact) return exact;

  // Greedy match is intentional: strips everything from the first '<' to the final '>'
  // at end of string, correctly handling nested generics (e.g., "Map<string, Option<number>>" → "Map")
  const stripped = typeText.replace(/<.*>$/, "");
  if (stripped !== typeText) {
    const generic = byName.get(stripped);
    if (generic) return generic;
  }

  return undefined;
}

/**
 * Look up all type rewrite entries originating from a given source module.
 *
 * @param sourceModule - The module specifier (e.g., "@typesugar/fp/data/option")
 * @returns Matching entries (snapshot), or an empty array
 */
export function getTypeRewritesByModule(sourceModule: string): readonly TypeRewriteEntry[] {
  return byModule.get(sourceModule) ?? [];
}

/**
 * Find a type rewrite entry whose {@link TypeRewriteEntry.typeName} matches
 * the name of a TypeScript `ts.Symbol`.
 *
 * This is a convenience for transformer code that already has a resolved
 * symbol and needs to check the registry without calling `typeToString`.
 *
 * @param symbolName - The symbol's `getName()` result
 * @returns The matching entry, or `undefined`
 */
export function getTypeRewriteBySymbol(symbolName: string): TypeRewriteEntry | undefined {
  return byName.get(symbolName);
}
