/**
 * Type Rewrite Registry
 *
 * Maps opaque type names to their underlying representations. Populated by
 * PEP-012's `@opaque` macro at transformer init time; consulted by:
 *
 * - The transformer (for method/constructor/accessor erasure)
 * - PEP-011's TypeRewriteAssignment diagnostic suppression rule (for implicit conversion diagnostics)
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
 * @see PEP-011 Wave 5 — TypeRewriteAssignment diagnostic suppression rule (renamed by PEP-054)
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

/**
 * Describes how a method call on an @opaque type can be inlined to a
 * null-check expression instead of a standalone function call.
 *
 * - `"null-check-apply"`: `opt != null ? fn(opt) : null` (map, flatMap)
 * - `"null-check-predicate"`: `opt != null && pred(opt) ? opt : null` (filter)
 * - `"null-coalesce-call"`: `opt != null ? opt : defaultFn()` (getOrElse)
 * - `"null-coalesce-value"`: `opt != null ? opt : defaultVal` (getOrElseStrict)
 * - `"fold"`: `opt != null ? onSome(opt) : onNone()` (fold, match)
 */
export interface MethodInlinePattern {
  readonly kind:
    | "null-check-apply"
    | "null-check-predicate"
    | "null-coalesce-call"
    | "null-coalesce-value"
    | "fold";
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
   * When not provided, the diagnostic suppression rule falls back to structural
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
   * Absolute path of the file that declares the type and its companion
   * constructors/functions (a `.ts` source for a same-project `@opaque`/`@adt`,
   * or the `.d.ts` that carries the `@opaque` tag for a library type).
   *
   * This is the entry's identity: the transformer only erases a constructor
   * call, constant reference, method call or accessor when the symbol it
   * resolves to (through import aliases) is declared in this file. Without it,
   * {@link sourceModule} is used as a best-effort fallback. Bare-name matching
   * alone rewrote unrelated same-named code (`function Some`, `enum { None }`)
   * in every file of the process.
   */
  readonly declarationFile?: string;

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

  /**
   * Method name → inline pattern for zero-cost method erasure.
   * When present, the transformer inlines the method body as a null-check
   * expression instead of emitting a standalone function call.
   */
  readonly methodInlines?: ReadonlyMap<string, MethodInlinePattern>;
}

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

// Module-level singleton registry. Populated by @opaque macro at transformer init,
// consulted by diagnostic suppression rules and the transformer during compilation.
// For test isolation, use clearTypeRewrites() or the test helpers in test-helpers.ts.
//
// Several entries may share a type name (two unrelated `Option` types from
// different modules). They are kept side by side, keyed by declaration
// identity ({@link entryIdentity}); the name-only lookups below return the
// most recently registered one for backward compatibility, while the
// transformer picks among `getAllTypeRewrites()` by resolved declaration.
const byName = new Map<string, TypeRewriteEntry[]>();
const byModule = new Map<string, TypeRewriteEntry[]>();

/** Identity of an entry: its declaring file, else its module, else just the name. */
function entryIdentity(entry: TypeRewriteEntry): string {
  return entry.declarationFile ?? entry.sourceModule ?? "";
}

/**
 * Register an opaque type's underlying representation.
 *
 * Called by `@opaque` macro processing (PEP-012) during transformer init.
 * The diagnostic suppression rule consults this registry to decide whether to suppress
 * assignment errors involving the registered type.
 *
 * Re-registering the same type name from the same declaration replaces the
 * earlier entry; the same name from a different declaration is added
 * alongside it (and becomes the one name-only lookups return).
 *
 * @param entry - The type rewrite entry to register
 */
export function registerTypeRewrite(entry: TypeRewriteEntry): void {
  const id = entryIdentity(entry);
  const named = (byName.get(entry.typeName) ?? []).filter((e) => entryIdentity(e) !== id);
  named.push(entry);
  byName.set(entry.typeName, named);

  if (entry.sourceModule) {
    const list = byModule.get(entry.sourceModule);
    if (list) {
      const idx = list.findIndex((e) => e.typeName === entry.typeName && entryIdentity(e) === id);
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

function latestByName(typeName: string): TypeRewriteEntry | undefined {
  const list = byName.get(typeName);
  return list && list.length > 0 ? list[list.length - 1] : undefined;
}

/**
 * Look up a type rewrite entry by opaque type name.
 *
 * @param typeName - The opaque type name (unparameterized, e.g., "Option")
 * @returns The registry entry, or `undefined` if not registered
 */
export function getTypeRewrite(typeName: string): TypeRewriteEntry | undefined {
  return latestByName(typeName);
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
  return Array.from(byName.values()).flat();
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
  const exact = latestByName(typeText);
  if (exact) return exact;

  // Greedy match is intentional: strips everything from the first '<' to the final '>'
  // at end of string, correctly handling nested generics (e.g., "Map<string, Option<number>>" → "Map")
  const stripped = typeText.replace(/<.*>$/, "");
  if (stripped !== typeText) {
    const generic = latestByName(stripped);
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
  return latestByName(symbolName);
}

// ---------------------------------------------------------------------------
// File/module membership
// ---------------------------------------------------------------------------

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Strip a TS/JS (including `.d.ts`) extension from a normalized path. */
function stripScriptExtension(p: string): string {
  return p.replace(/\.d\.[cm]?ts$/, "").replace(/\.[cm]?[jt]sx?$/, "");
}

/** Absolute path (Unix `/...` or Windows `C:/...` / `C:\...`). Browser-safe. */
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[/\\]/.test(p);
}

/** Directories a package's published/sources files usually live under. */
const PACKAGE_CODE_DIRS = ["src", "dist", "lib", "build", "esm", "cjs"];

/**
 * Is `fileName` (where a resolved symbol is declared) the file/module that
 * `entry` describes?
 *
 * Uses {@link TypeRewriteEntry.declarationFile} when present (exact). Otherwise
 * falls back to `sourceModule`, compared as a MODULE, never by bare name:
 *
 * - an absolute path compares exactly;
 * - a package subpath `@scope/pkg/sub` (what `@opaque`/`@adt` derive from
 *   `.../packages/<pkg>/src/<sub>.ts`) matches `<pkg>/<dir>/<sub>` or
 *   `@scope/pkg/<dir>/<sub>` for a usual code dir (src, dist, ...) -- i.e. the
 *   package's source or its published `.d.ts`;
 * - anything else (including a relative "./lib.js") matches as a path suffix
 *   (the legacy transformer-core `isWithinSourceModule` rule).
 */
export function typeRewriteEntryCoversFile(fileName: string, entry: TypeRewriteEntry): boolean {
  const file = stripScriptExtension(normalizeSlashes(fileName));
  if (entry.declarationFile) {
    return stripScriptExtension(normalizeSlashes(entry.declarationFile)) === file;
  }
  if (!entry.sourceModule) return false;
  const mod = normalizeSlashes(entry.sourceModule);
  if (isAbsolutePath(mod)) return stripScriptExtension(mod) === file;

  const sub = /^((?:@[^/]+\/)?([^/.][^/]*))\/(.+)$/.exec(mod);
  if (sub) {
    const [, fullPkg, pkgDir, rest] = sub;
    const subPath = stripScriptExtension(rest);
    for (const root of new Set([pkgDir, fullPkg])) {
      for (const dir of PACKAGE_CODE_DIRS) {
        const tail = `/${root}/${dir}/${subPath}`;
        if (file.endsWith(tail) || file.endsWith(`${tail}/index`)) return true;
      }
    }
  }

  // A relative specifier ("./lib.js") can only be compared as a path suffix.
  const modulePath = stripScriptExtension(mod.replace(/^@/, "").replace(/^(\.\.?\/)+/, ""));
  return (
    file === modulePath ||
    file.endsWith("/" + modulePath) ||
    file.endsWith("/" + modulePath + "/index")
  );
}
