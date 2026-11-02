/**
 * Macro Registry - Stores and retrieves macro definitions
 *
 * This module also provides a generic Registry<K, V> abstraction that can be
 * used across packages to replace ad-hoc Map-based registries with a consistent,
 * type-safe API.
 */

// ============================================================================
// Generic Registry<K, V> Abstraction
// ============================================================================

/**
 * Duplicate handling strategy for registry entries.
 */
export type DuplicateStrategy =
  | "error" // Throw error on duplicate (default)
  | "skip" // Silently skip if same entry exists
  | "replace" // Replace existing entry
  | "merge"; // Merge with existing entry (requires custom merge function)

/**
 * Options for creating a Registry instance.
 */
export interface RegistryOptions<K, V> {
  /** How to handle duplicate entries (default: "error") */
  duplicateStrategy?: DuplicateStrategy;

  /** Custom equality check for values (used with "skip" strategy) */
  valueEquals?: (a: V, b: V) => boolean;

  /** Merge function (required when duplicateStrategy is "merge") */
  merge?: (existing: V, incoming: V, key: K) => V;

  /** Name for error messages */
  name?: string;
}

/**
 * A generic, type-safe registry for key-value pairs.
 *
 * Provides a consistent API for storing and retrieving entries with
 * configurable duplicate handling strategies.
 *
 * @example
 * ```typescript
 * // Simple registry with error on duplicates (default)
 * const typeRegistry = createGenericRegistry<string, TypeInfo>();
 *
 * // Registry that skips duplicates
 * const instanceRegistry = createGenericRegistry<string, Instance>({
 *   duplicateStrategy: "skip",
 *   valueEquals: (a, b) => a.id === b.id,
 * });
 *
 * // Registry that merges duplicates
 * const annotationRegistry = createGenericRegistry<string, string[]>({
 *   duplicateStrategy: "merge",
 *   merge: (existing, incoming) => [...existing, ...incoming],
 * });
 * ```
 */
export interface GenericRegistry<K, V> extends Iterable<[K, V]> {
  /** Register a new entry */
  set(key: K, value: V): void;

  /** Get an entry by key */
  get(key: K): V | undefined;

  /** Check if a key exists */
  has(key: K): boolean;

  /** Delete an entry */
  delete(key: K): boolean;

  /** Get all entries */
  entries(): IterableIterator<[K, V]>;

  /** Get all keys */
  keys(): IterableIterator<K>;

  /** Get all values */
  values(): IterableIterator<V>;

  /** Number of entries */
  readonly size: number;

  /** Clear all entries */
  clear(): void;

  /** Iterate with forEach */
  forEach(fn: (value: V, key: K, registry: GenericRegistry<K, V>) => void): void;

  /** Make registry iterable (for...of support) */
  [Symbol.iterator](): IterableIterator<[K, V]>;
}

class GenericRegistryImpl<K, V> implements GenericRegistry<K, V> {
  private store = new Map<K, V>();
  private options: Required<Pick<RegistryOptions<K, V>, "duplicateStrategy" | "name">> &
    Pick<RegistryOptions<K, V>, "valueEquals" | "merge">;

  constructor(options: RegistryOptions<K, V> = {}) {
    this.options = {
      duplicateStrategy: options.duplicateStrategy ?? "error",
      name: options.name ?? "Registry",
      valueEquals: options.valueEquals,
      merge: options.merge,
    };

    if (this.options.duplicateStrategy === "merge" && !this.options.merge) {
      throw new Error(
        `${this.options.name}: merge function is required when duplicateStrategy is "merge"`
      );
    }
  }

  set(key: K, value: V): void {
    const existing = this.store.get(key);

    if (existing !== undefined) {
      switch (this.options.duplicateStrategy) {
        case "error":
          throw new Error(`${this.options.name}: entry for key '${String(key)}' already exists`);

        case "skip":
          if (this.options.valueEquals) {
            if (this.options.valueEquals(existing, value)) return;
            throw new Error(
              `${this.options.name}: different value for key '${String(key)}' already exists`
            );
          }
          return;

        case "replace":
          this.store.set(key, value);
          return;

        case "merge":
          this.store.set(key, this.options.merge!(existing, value, key));
          return;
      }
    }

    this.store.set(key, value);
  }

  get(key: K): V | undefined {
    return this.store.get(key);
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  entries(): IterableIterator<[K, V]> {
    return this.store.entries();
  }

  keys(): IterableIterator<K> {
    return this.store.keys();
  }

  values(): IterableIterator<V> {
    return this.store.values();
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  forEach(fn: (value: V, key: K, registry: GenericRegistry<K, V>) => void): void {
    for (const [k, v] of this.store) {
      fn(v, k, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.store[Symbol.iterator]();
  }
}

/**
 * Create a new generic registry instance.
 *
 * @param options - Configuration options
 * @returns A new GenericRegistry instance
 *
 * @example
 * ```typescript
 * // Type-safe typeclass registry
 * interface TypeclassInfo {
 *   name: string;
 *   methods: string[];
 * }
 *
 * const typeclassRegistry = createGenericRegistry<string, TypeclassInfo>({
 *   name: "TypeclassRegistry",
 *   duplicateStrategy: "skip",
 *   valueEquals: (a, b) => a.name === b.name,
 * });
 *
 * typeclassRegistry.set("Show", { name: "Show", methods: ["show"] });
 * typeclassRegistry.set("Eq", { name: "Eq", methods: ["equals"] });
 *
 * const showInfo = typeclassRegistry.get("Show");
 * ```
 */
export function createGenericRegistry<K, V>(
  options?: RegistryOptions<K, V>
): GenericRegistry<K, V> {
  return new GenericRegistryImpl(options);
}

// ============================================================================
// Macro Registry Implementation
// ============================================================================

import {
  MacroDefinition,
  MacroRegistry,
  ExpressionMacro,
  AttributeMacro,
  DeriveMacro,
  TaggedTemplateMacroDef,
  TypeMacro,
  LabeledBlockMacro,
} from "./types.js";
import { registerSyntaxMarkerFallback } from "./syntax-marker-fallback.js";

type MacroKind = MacroDefinition["kind"];

const MACRO_KINDS: ReadonlySet<MacroKind> = new Set<MacroKind>([
  "expression",
  "attribute",
  "derive",
  "tagged-template",
  "type",
  "labeled-block",
]);

/** Identity key of a module-qualified macro: kind + module + export name. */
function moduleKey(kind: MacroKind, mod: string, exportName: string): string {
  return `${kind}\u0000${mod}::${exportName}`;
}

/** Identity key of a legacy (module-less) macro: kind + bare name. */
function legacyKey(kind: MacroKind, name: string): string {
  return `${kind}\u0000${name}`;
}

/** The names a non-labeled-block macro is found under: `name`, plus `exportName` if different. */
function namesOf(macro: MacroDefinition): string[] {
  return macro.exportName && macro.exportName !== macro.name
    ? [macro.name, macro.exportName]
    : [macro.name];
}

function labelsOf(macro: LabeledBlockMacro): string[] {
  return Array.isArray(macro.label) ? [...macro.label] : [macro.label];
}

function describeMacro(macro: MacroDefinition): string {
  return macro.module ? `module '${macro.module}'` : "no module (legacy, matched by name)";
}

/**
 * Macro registry.
 *
 * ## Identity (PEP-060 item 8)
 *
 * A macro that declares a `module` is identified by
 * **(kind, module, exportName ?? name)**. Two packages may register the same
 * name (@typesugar/validate's `assert<T>()` and @typesugar/testing's
 * `assert(cond)`): both stay registered, and the import the user wrote decides
 * which one expands — transformer-core resolves a call through the import's
 * declaring module ({@link getByModuleExport}), never by load order.
 *
 * A macro WITHOUT a `module` (legacy) is identified by (kind, name): it is
 * matched by name in any file, so a second, different module-less macro of
 * that name is a conflict. A legacy macro and module-qualified ones may share
 * a name; the bare-name getters return the legacy one, and module-qualified
 * resolution never sees it shadow theirs.
 *
 * Labeled blocks are keyed by label alone: a label is file-wide syntax (gated
 * by `@syntax-labels` activation), with no import binding to tell two macros
 * apart, so one label maps to one macro.
 *
 * ## Re-registration and conflicts
 *
 * Registering a macro whose identity is already taken is idempotent when it is
 * the same definition — the same object, or a copy with the same kind, name,
 * module, exportName, labels and description (an ESM and a CJS build, or src
 * and dist, of one package). The first registration is kept. Any other
 * definition under a taken identity throws, naming both.
 *
 * ## Bare-name lookups
 *
 * `getExpression(name)` and friends serve call sites that have only a name
 * (JSDoc tags, `@derive` arguments, decorator fallbacks). They return the
 * legacy macro of that name if there is one, else the single module-qualified
 * macro of that name, else `undefined` when two or more modules provide it —
 * never whichever loaded first. {@link getCandidates} lists them all, for
 * callers that disambiguate by the file's imports.
 */
class MacroRegistryImpl implements MacroRegistry {
  /** Every registered macro, once, in registration order. */
  private macros: MacroDefinition[] = [];

  /** Per kind: name (and exportName alias) → every macro registered under it, in order. */
  private byName = new Map<MacroKind, Map<string, MacroDefinition[]>>();

  /** Module-qualified identities: {@link moduleKey} → macro. */
  private byModule = new Map<string, MacroDefinition>();

  /** Legacy (module-less) identities: {@link legacyKey} → macro. */
  private legacy = new Map<string, MacroDefinition>();

  /** Labeled blocks: label → macro (labels are globally unique). */
  private labels = new Map<string, LabeledBlockMacro>();

  /**
   * Whether `incoming` is the same definition as `existing`, which already
   * holds its identity: the same object, or a copy of it (an ESM/CJS or
   * src/dist duplicate of one package re-registering on load).
   */
  private isSameMacro(existing: MacroDefinition, incoming: MacroDefinition): boolean {
    if (existing === incoming) return true;
    const fingerprint = (m: MacroDefinition) =>
      JSON.stringify([
        m.kind,
        m.name,
        m.module ?? null,
        m.exportName ?? null,
        m.kind === "labeled-block" ? labelsOf(m) : null,
        m.description ?? null,
      ]);
    return fingerprint(existing) === fingerprint(incoming);
  }

  private conflict(what: string, existing: MacroDefinition, incoming: MacroDefinition): Error {
    return new Error(
      `${what} is already registered by a different definition ` +
        `(existing: ${describeMacro(existing)}, incoming: ${describeMacro(incoming)}). ` +
        `Two definitions cannot share one identity; give each macro its own \`module\` ` +
        `(macros from different modules coexist), or rename one. If both are copies of the ` +
        `same package (two installed versions, or a stale dist), deduplicate or rebuild it.`
    );
  }

  private index(kind: MacroKind, name: string, macro: MacroDefinition): void {
    let names = this.byName.get(kind);
    if (!names) this.byName.set(kind, (names = new Map()));
    const list = names.get(name);
    if (!list) names.set(name, [macro]);
    else if (!list.includes(macro)) list.push(macro);
  }

  register(macro: MacroDefinition): void {
    if (!MACRO_KINDS.has(macro.kind)) {
      throw new Error(`Unknown macro kind: ${(macro as MacroDefinition).kind}`);
    }

    if (macro.kind === "labeled-block") {
      const labels = labelsOf(macro);
      const fresh: string[] = [];
      for (const label of labels) {
        const existing = this.labels.get(label);
        if (!existing) {
          fresh.push(label);
        } else if (!this.isSameMacro(existing, macro)) {
          throw this.conflict(`Labeled block macro for label '${label}'`, existing, macro);
        }
      }
      if (fresh.length === 0) return;
      for (const label of fresh) {
        this.labels.set(label, macro);
        this.index("labeled-block", label, macro);
      }
    } else {
      const kindLabel = `${macro.kind[0].toUpperCase()}${macro.kind.slice(1)} macro`;
      if (macro.module !== undefined) {
        const key = moduleKey(macro.kind, macro.module, macro.exportName ?? macro.name);
        const existing = this.byModule.get(key);
        if (existing) {
          if (this.isSameMacro(existing, macro)) return;
          throw this.conflict(
            `${kindLabel} '${macro.exportName ?? macro.name}' of module '${macro.module}'`,
            existing,
            macro
          );
        }
        this.byModule.set(key, macro);
      } else {
        const names = namesOf(macro);
        for (const name of names) {
          const existing = this.legacy.get(legacyKey(macro.kind, name));
          if (!existing) continue;
          if (this.isSameMacro(existing, macro)) return;
          throw this.conflict(`${kindLabel} '${name}'`, existing, macro);
        }
        for (const name of names) this.legacy.set(legacyKey(macro.kind, name), macro);
      }
      for (const name of namesOf(macro)) this.index(macro.kind, name, macro);
    }

    this.macros.push(macro);

    // PEP-052 Wave 2/6 unification: a macro's `syntaxModule` (attribute or
    // labeled-block macros only) names the module whose import activates its
    // label syntax without needing checker-based module resolution. Fold
    // this into the shared marker-fallback registry (see
    // syntax-marker-fallback.ts) at registration time instead of rebuilding
    // a separate index from `globalRegistry.getAll()` on every scan.
    if ("syntaxModule" in macro && macro.syntaxModule) {
      registerSyntaxMarkerFallback(macro.syntaxModule, { labels: [macro.name] });
    }
  }

  getCandidates(name: string, kind: MacroKind): readonly MacroDefinition[] {
    return [...(this.byName.get(kind)?.get(name) ?? [])];
  }

  /** The bare-name rule: the legacy macro, else the sole provider, else none (ambiguous). */
  private byBareName(name: string, kind: MacroKind): MacroDefinition | undefined {
    const candidates = this.byName.get(kind)?.get(name);
    if (!candidates || candidates.length === 0) return undefined;
    const legacy = candidates.find((m) => m.module === undefined);
    if (legacy) return legacy;
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  getExpression(name: string): ExpressionMacro | undefined {
    return this.byBareName(name, "expression") as ExpressionMacro | undefined;
  }

  getAttribute(name: string): AttributeMacro | undefined {
    return this.byBareName(name, "attribute") as AttributeMacro | undefined;
  }

  /**
   * Find a registered attribute macro that declares `label` in its
   * `triggerLabels`. Used to implicitly apply attribute macros (e.g.
   * `@contract`) to functions containing matching labeled blocks
   * (`requires:` / `ensures:`) without an explicit decorator.
   *
   * Trigger labels are syntax, like labeled blocks: the first registered
   * attribute macro declaring the label is returned, and dispatch is gated by
   * that macro's `@syntax-labels` activation.
   */
  getAttributeByTriggerLabel(label: string): AttributeMacro | undefined {
    for (const macro of this.macros) {
      if (macro.kind === "attribute" && macro.triggerLabels?.includes(label)) {
        return macro;
      }
    }
    return undefined;
  }

  getDerive(name: string): DeriveMacro | undefined {
    return this.byBareName(name, "derive") as DeriveMacro | undefined;
  }

  getTaggedTemplate(name: string): TaggedTemplateMacroDef | undefined {
    return this.byBareName(name, "tagged-template") as TaggedTemplateMacroDef | undefined;
  }

  getType(name: string): TypeMacro | undefined {
    return this.byBareName(name, "type") as TypeMacro | undefined;
  }

  /**
   * Raw registry lookup — NOT activation-aware. Label dispatch must go
   * through the PEP-052 gate (`getActivatedLabeledBlock` in
   * `@typesugar/transformer-core`), which wraps this lookup with the
   * per-file `@syntax-labels` activation check. Calling this directly from a
   * dispatch site silently bypasses import-scoped activation.
   */
  getLabeledBlock(label: string): LabeledBlockMacro | undefined {
    return this.labels.get(label);
  }

  /**
   * Look up a macro by its identity: source module and export name (and,
   * optionally, kind). Without `kind`, returns the first kind registered
   * under that module and export name.
   */
  getByModuleExport(
    mod: string,
    exportName: string,
    kind?: MacroKind
  ): MacroDefinition | undefined {
    if (kind) return this.byModule.get(moduleKey(kind, mod, exportName));
    for (const k of MACRO_KINDS) {
      const macro = this.byModule.get(moduleKey(k, mod, exportName));
      if (macro) return macro;
    }
    return undefined;
  }

  /**
   * Whether the macro(s) of this name and kind require import-scoping: true
   * when every macro registered under the name declares a `module` (a legacy
   * module-less one of that name is matched by name alone).
   */
  isImportScoped(name: string, kind: MacroKind): boolean {
    const candidates = this.byName.get(kind)?.get(name);
    return !!candidates && candidates.length > 0 && candidates.every((m) => m.module !== undefined);
  }

  getAll(): MacroDefinition[] {
    return [...this.macros];
  }

  /** Clear all registered macros (useful for testing) */
  clear(): void {
    this.macros = [];
    this.byName.clear();
    this.byModule.clear();
    this.legacy.clear();
    this.labels.clear();
  }
}

/**
 * Global macro registry singleton.
 *
 * Stored on globalThis so that ESM and CJS copies of @typesugar/core share the
 * same instance. Without this, the macro-loader (which uses createRequire /
 * CJS) writes to a different MacroRegistryImpl than the transformer (ESM),
 * causing macros from @typesugar/std, @typesugar/contracts etc. to silently
 * fail to register.
 */
const GLOBAL_REGISTRY_KEY = "__typesugar_globalRegistry__";
export const globalRegistry: MacroRegistry =
  (globalThis as any)[GLOBAL_REGISTRY_KEY] ??
  ((globalThis as any)[GLOBAL_REGISTRY_KEY] = new MacroRegistryImpl());

/** Create a new isolated registry (for testing or scoped usage) */
export function createRegistry(): MacroRegistry {
  return new MacroRegistryImpl();
}

// ============================================================================
// Macro Definition Helpers
// ============================================================================

/**
 * Define an expression macro with type inference
 */
export function defineExpressionMacro(definition: Omit<ExpressionMacro, "kind">): ExpressionMacro {
  return {
    ...definition,
    kind: "expression",
  };
}

/**
 * Define an attribute macro with type inference
 */
export function defineAttributeMacro(definition: Omit<AttributeMacro, "kind">): AttributeMacro {
  return {
    ...definition,
    kind: "attribute",
  };
}

/**
 * Define a derive macro with type inference
 */
export function defineDeriveMacro(definition: Omit<DeriveMacro, "kind">): DeriveMacro {
  return {
    ...definition,
    kind: "derive",
  };
}

/**
 * Define a tagged template macro with type inference
 */
export function defineTaggedTemplateMacro(
  definition: Omit<TaggedTemplateMacroDef, "kind">
): TaggedTemplateMacroDef {
  return {
    ...definition,
    kind: "tagged-template",
  };
}

/**
 * Define a type macro with type inference
 */
export function defineTypeMacro(definition: Omit<TypeMacro, "kind">): TypeMacro {
  return {
    ...definition,
    kind: "type",
  };
}

/**
 * Define a labeled block macro with type inference
 */
export function defineLabeledBlockMacro(
  definition: Omit<LabeledBlockMacro, "kind">
): LabeledBlockMacro {
  return {
    ...definition,
    kind: "labeled-block",
  };
}

/**
 * Register multiple macros at once
 */
export function registerMacros(registry: MacroRegistry, ...macros: MacroDefinition[]): void {
  for (const macro of macros) {
    registry.register(macro);
  }
}

// ============================================================================
// Standalone Extension Registry (Scala 3-style concrete type enrichment)
// ============================================================================

import type { StandaloneExtensionInfo } from "./types.js";
import * as ts from "typescript";

/**
 * A registry entry: a {@link StandaloneExtensionInfo} plus the file whose
 * `@extension` / `registerExtension` registered it.
 *
 * `declaringFile` is `undefined` for entries registered outside any file's
 * transform (a compiled dist self-registering via
 * `globalThis.__typesugar_registerExtension` at load time, or direct calls in
 * tests) — those are genuinely process-wide.
 */
export interface StandaloneExtensionEntry extends StandaloneExtensionInfo {
  declaringFile?: string;
}

/**
 * Registry for standalone extension methods (direct enrichments on concrete
 * types, not typeclass-derived).
 *
 * Shape (CLAUDE.md "Resolving things a macro just generated"): a LIVE keyed
 * registry read within the same pass, keyed by
 * `(methodName, forType, qualifier, declaringFile)`. Entries are partitioned by
 * declaring file: a lookup from file F ({@link findStandaloneExtensions})
 * returns F's own entries first, then process-wide (file-less) ones, then other
 * files' entries; and {@link clearStandaloneExtensionsForFile} drops a file's
 * entries when it is transformed again (watch mode, LSP edits), so a deleted or
 * renamed `@extension` stops matching. Consumers must still check that the
 * callee is actually bound at the call site (transformer-core's
 * `isExtensionCalleeBound`) — an entry from another file is a candidate, never
 * a guarantee that the name is in scope here.
 */
// Use a shared globalThis registry so ESM and CJS module instances share
// the same extension list. Without this, `import` (ESM) and `require` (CJS)
// create separate arrays and extensions registered via CJS are invisible to
// the ESM transformer.
const _g = globalThis as any;
if (!_g.__typesugar_standaloneExtensions) {
  _g.__typesugar_standaloneExtensions = [];
}
export const standaloneExtensionRegistry: StandaloneExtensionEntry[] =
  _g.__typesugar_standaloneExtensions;

/** File whose transform is currently running (set by {@link withStandaloneExtensionFile}). */
let currentRegistrationFile: string | undefined;

/**
 * Run `fn` (one file's transform pass) with `fileName` as the default
 * `declaringFile` for every extension registered during it, after first
 * dropping that file's entries from earlier passes.
 */
export function withStandaloneExtensionFile<T>(fileName: string, fn: () => T): T {
  const prev = currentRegistrationFile;
  clearStandaloneExtensionsForFile(fileName);
  currentRegistrationFile = fileName;
  try {
    return fn();
  } finally {
    currentRegistrationFile = prev;
  }
}

/** Remove every entry registered by `fileName`. */
export function clearStandaloneExtensionsForFile(fileName: string): void {
  for (let i = standaloneExtensionRegistry.length - 1; i >= 0; i--) {
    if (standaloneExtensionRegistry[i].declaringFile === fileName) {
      standaloneExtensionRegistry.splice(i, 1);
    }
  }
}

/**
 * Register a standalone extension entry.
 * Idempotent: skips if an identical entry (same declaring file) already exists.
 */
export function registerStandaloneExtensionEntry(info: StandaloneExtensionEntry): void {
  const declaringFile = info.declaringFile ?? currentRegistrationFile;
  const exists = standaloneExtensionRegistry.some(
    (e) =>
      e.methodName === info.methodName &&
      e.forType === info.forType &&
      e.qualifier === info.qualifier &&
      e.declaringFile === declaringFile
  );
  if (!exists) {
    standaloneExtensionRegistry.push(
      declaringFile === undefined ? { ...info } : { ...info, declaringFile }
    );
  }
}

// Expose registration hook on globalThis so macro-emitted code in dist
// can register extensions without importing @typesugar/core directly.
_g.__typesugar_registerExtension = registerStandaloneExtensionEntry;

/**
 * Every standalone extension for `methodName` on `typeName`, ordered for a
 * lookup from `fromFile`: that file's own entries, then process-wide ones,
 * then other files' entries (registration order within each group).
 */
export function findStandaloneExtensions(
  methodName: string,
  typeName: string,
  fromFile?: string
): StandaloneExtensionEntry[] {
  const matches = standaloneExtensionRegistry.filter(
    (e) => e.methodName === methodName && e.forType === typeName
  );
  const rank = (e: StandaloneExtensionEntry): number =>
    fromFile !== undefined && e.declaringFile === fromFile
      ? 0
      : e.declaringFile === undefined
        ? 1
        : 2;
  return matches
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map(({ e }) => e);
}

/**
 * Find a standalone extension method for a given method name and type
 * (the first of {@link findStandaloneExtensions}). Returns undefined if no
 * standalone extension is registered.
 */
export function findStandaloneExtension(
  methodName: string,
  typeName: string,
  fromFile?: string
): StandaloneExtensionEntry | undefined {
  return findStandaloneExtensions(methodName, typeName, fromFile)[0];
}

/**
 * Get all standalone extensions registered for a type.
 */
export function getStandaloneExtensionsForType(typeName: string): StandaloneExtensionEntry[] {
  return standaloneExtensionRegistry.filter((e) => e.forType === typeName);
}

/**
 * Get all registered standalone extensions.
 */
export function getAllStandaloneExtensions(): StandaloneExtensionEntry[] {
  return [...standaloneExtensionRegistry];
}

/**
 * Build the AST for a standalone extension method call.
 *
 * Given `extend(receiver).method(args)` and a resolved StandaloneExtensionInfo,
 * generates either:
 *   - `Qualifier.method(receiver, args)` (if qualifier is set)
 *   - `method(receiver, args)` (if no qualifier — bare function)
 */
export function buildStandaloneExtensionCall(
  factory: ts.NodeFactory,
  ext: StandaloneExtensionInfo,
  receiver: ts.Expression,
  extraArgs: readonly ts.Expression[]
): ts.CallExpression {
  let callee: ts.Expression;
  if (ext.qualifier) {
    callee = factory.createPropertyAccessExpression(
      factory.createIdentifier(ext.qualifier),
      ext.methodName
    );
  } else {
    callee = factory.createIdentifier(ext.methodName);
  }

  return factory.createCallExpression(callee, undefined, [receiver, ...extraArgs]);
}
