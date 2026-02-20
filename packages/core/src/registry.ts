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
        `${this.options.name}: merge function is required when duplicateStrategy is "merge"`,
      );
    }
  }

  set(key: K, value: V): void {
    const existing = this.store.get(key);

    if (existing !== undefined) {
      switch (this.options.duplicateStrategy) {
        case "error":
          throw new Error(
            `${this.options.name}: entry for key '${String(key)}' already exists`,
          );

        case "skip":
          if (this.options.valueEquals) {
            if (this.options.valueEquals(existing, value)) return;
            throw new Error(
              `${this.options.name}: different value for key '${String(key)}' already exists`,
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
  options?: RegistryOptions<K, V>,
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

/**
 * Key for module-scoped macro lookup: "module::exportName"
 */
function moduleKey(mod: string, exportName: string): string {
  return `${mod}::${exportName}`;
}

class MacroRegistryImpl implements MacroRegistry {
  private expressionMacros = new Map<string, ExpressionMacro>();
  private attributeMacros = new Map<string, AttributeMacro>();
  private deriveMacros = new Map<string, DeriveMacro>();
  private taggedTemplateMacros = new Map<string, TaggedTemplateMacroDef>();
  private typeMacros = new Map<string, TypeMacro>();
  private labeledBlockMacros = new Map<string, LabeledBlockMacro>();

  /**
   * Secondary index: module-scoped lookup for macros that declare a `module`.
   * Key is "module::exportName", value is the macro definition.
   */
  private moduleScopedMacros = new Map<string, MacroDefinition>();

  /**
   * Check if two macros are semantically the same (same name and module).
   * Used to allow idempotent registration in ESM environments where
   * module re-imports can create new object instances.
   */
  private isSameMacro(
    existing: MacroDefinition,
    incoming: MacroDefinition,
  ): boolean {
    // Same object reference
    if (existing === incoming) return true;
    // Same name and same module (or both have no module)
    const key = "label" in existing ? existing.label : existing.name;
    const incomingKey = "label" in incoming ? incoming.label : incoming.name;
    return key === incomingKey && existing.module === incoming.module;
  }

  register(macro: MacroDefinition): void {
    switch (macro.kind) {
      case "expression": {
        const existing = this.expressionMacros.get(macro.name);
        if (existing) {
          // Idempotent: skip if semantically same macro
          if (this.isSameMacro(existing, macro)) return;
          throw new Error(
            `Expression macro '${macro.name}' is already registered`,
          );
        }
        this.expressionMacros.set(macro.name, macro);
        break;
      }

      case "attribute": {
        const existing = this.attributeMacros.get(macro.name);
        if (existing) {
          if (this.isSameMacro(existing, macro)) return;
          throw new Error(
            `Attribute macro '${macro.name}' is already registered`,
          );
        }
        this.attributeMacros.set(macro.name, macro);
        break;
      }

      case "derive": {
        const existing = this.deriveMacros.get(macro.name);
        if (existing) {
          if (this.isSameMacro(existing, macro)) return;
          throw new Error(`Derive macro '${macro.name}' is already registered`);
        }
        this.deriveMacros.set(macro.name, macro);
        break;
      }

      case "tagged-template": {
        const existing = this.taggedTemplateMacros.get(macro.name);
        if (existing) {
          if (this.isSameMacro(existing, macro)) return;
          throw new Error(
            `Tagged template macro '${macro.name}' is already registered`,
          );
        }
        this.taggedTemplateMacros.set(macro.name, macro);
        break;
      }

      case "type": {
        const existing = this.typeMacros.get(macro.name);
        if (existing) {
          if (this.isSameMacro(existing, macro)) return;
          throw new Error(`Type macro '${macro.name}' is already registered`);
        }
        this.typeMacros.set(macro.name, macro);
        break;
      }

      case "labeled-block": {
        const existing = this.labeledBlockMacros.get(macro.label);
        if (existing) {
          if (this.isSameMacro(existing, macro)) return;
          throw new Error(
            `Labeled block macro for label '${macro.label}' is already registered`,
          );
        }
        this.labeledBlockMacros.set(macro.label, macro);
        break;
      }

      default:
        throw new Error(
          `Unknown macro kind: ${(macro as MacroDefinition).kind}`,
        );
    }

    // Index by module if the macro declares one
    if (macro.module) {
      const exportName = macro.exportName ?? macro.name;
      const key = moduleKey(macro.module, exportName);
      this.moduleScopedMacros.set(key, macro);
    }
  }

  getExpression(name: string): ExpressionMacro | undefined {
    return this.expressionMacros.get(name);
  }

  getAttribute(name: string): AttributeMacro | undefined {
    return this.attributeMacros.get(name);
  }

  getDerive(name: string): DeriveMacro | undefined {
    return this.deriveMacros.get(name);
  }

  getTaggedTemplate(name: string): TaggedTemplateMacroDef | undefined {
    return this.taggedTemplateMacros.get(name);
  }

  getType(name: string): TypeMacro | undefined {
    return this.typeMacros.get(name);
  }

  getLabeledBlock(label: string): LabeledBlockMacro | undefined {
    return this.labeledBlockMacros.get(label);
  }

  /**
   * Look up a macro by its source module and export name.
   * Returns the macro if it was registered with a matching module+exportName.
   */
  getByModuleExport(
    mod: string,
    exportName: string,
  ): MacroDefinition | undefined {
    return this.moduleScopedMacros.get(moduleKey(mod, exportName));
  }

  /**
   * Check whether a macro (looked up by name) requires import-scoping.
   * Returns true if the macro has a `module` field set.
   */
  isImportScoped(name: string, kind: MacroDefinition["kind"]): boolean {
    let macro: MacroDefinition | undefined;
    switch (kind) {
      case "expression":
        macro = this.expressionMacros.get(name);
        break;
      case "attribute":
        macro = this.attributeMacros.get(name);
        break;
      case "derive":
        macro = this.deriveMacros.get(name);
        break;
      case "tagged-template":
        macro = this.taggedTemplateMacros.get(name);
        break;
      case "type":
        macro = this.typeMacros.get(name);
        break;
      case "labeled-block":
        macro = this.labeledBlockMacros.get(name);
        break;
    }
    return macro?.module !== undefined;
  }

  getAll(): MacroDefinition[] {
    return [
      ...this.expressionMacros.values(),
      ...this.attributeMacros.values(),
      ...this.deriveMacros.values(),
      ...this.taggedTemplateMacros.values(),
      ...this.typeMacros.values(),
      ...this.labeledBlockMacros.values(),
    ];
  }

  /** Clear all registered macros (useful for testing) */
  clear(): void {
    this.expressionMacros.clear();
    this.attributeMacros.clear();
    this.deriveMacros.clear();
    this.taggedTemplateMacros.clear();
    this.typeMacros.clear();
    this.labeledBlockMacros.clear();
    this.moduleScopedMacros.clear();
  }
}

/** Global macro registry singleton */
export const globalRegistry = new MacroRegistryImpl();

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
export function defineExpressionMacro(
  definition: Omit<ExpressionMacro, "kind">,
): ExpressionMacro {
  return {
    ...definition,
    kind: "expression",
  };
}

/**
 * Define an attribute macro with type inference
 */
export function defineAttributeMacro(
  definition: Omit<AttributeMacro, "kind">,
): AttributeMacro {
  return {
    ...definition,
    kind: "attribute",
  };
}

/**
 * Define a derive macro with type inference
 */
export function defineDeriveMacro(
  definition: Omit<DeriveMacro, "kind">,
): DeriveMacro {
  return {
    ...definition,
    kind: "derive",
  };
}

/**
 * Define a tagged template macro with type inference
 */
export function defineTaggedTemplateMacro(
  definition: Omit<TaggedTemplateMacroDef, "kind">,
): TaggedTemplateMacroDef {
  return {
    ...definition,
    kind: "tagged-template",
  };
}

/**
 * Define a type macro with type inference
 */
export function defineTypeMacro(
  definition: Omit<TypeMacro, "kind">,
): TypeMacro {
  return {
    ...definition,
    kind: "type",
  };
}

/**
 * Define a labeled block macro with type inference
 */
export function defineLabeledBlockMacro(
  definition: Omit<LabeledBlockMacro, "kind">,
): LabeledBlockMacro {
  return {
    ...definition,
    kind: "labeled-block",
  };
}

/**
 * Register multiple macros at once
 */
export function registerMacros(
  registry: MacroRegistry,
  ...macros: MacroDefinition[]
): void {
  for (const macro of macros) {
    registry.register(macro);
  }
}

// ============================================================================
// Extension Method Registry Implementation
// ============================================================================

import { ExtensionMethodInfo, ExtensionMethodRegistry } from "./types.js";

class ExtensionMethodRegistryImpl implements ExtensionMethodRegistry {
  private extensions = new Map<string, ExtensionMethodInfo[]>();

  private makeKey(methodName: string, forType: string): string {
    return `${forType}::${methodName}`;
  }

  register(info: ExtensionMethodInfo): void {
    const key = this.makeKey(info.methodName, info.forType);
    const existing = this.extensions.get(key) ?? [];
    existing.push(info);
    this.extensions.set(key, existing);
  }

  find(methodName: string, forType: string): ExtensionMethodInfo | undefined {
    const key = this.makeKey(methodName, forType);
    const matches = this.extensions.get(key);
    return matches?.[0];
  }

  getForType(forType: string): ExtensionMethodInfo[] {
    const results: ExtensionMethodInfo[] = [];
    for (const [key, infos] of this.extensions) {
      if (key.startsWith(forType + "::")) {
        results.push(...infos);
      }
    }
    return results;
  }

  clear(): void {
    this.extensions.clear();
  }
}

/** Global extension method registry singleton */
export const globalExtensionRegistry: ExtensionMethodRegistry =
  new ExtensionMethodRegistryImpl();

/** Create a new isolated extension registry (for testing) */
export function createExtensionRegistry(): ExtensionMethodRegistry {
  return new ExtensionMethodRegistryImpl();
}

// ============================================================================
// Standalone Extension Registry (Scala 3-style concrete type enrichment)
// ============================================================================

import type { StandaloneExtensionInfo } from "./types.js";
import * as ts from "typescript";

/**
 * Global registry for standalone extension methods.
 * These are direct enrichments on concrete types, not typeclass-derived.
 */
export const standaloneExtensionRegistry: StandaloneExtensionInfo[] = [];

/**
 * Register a standalone extension entry.
 * Idempotent: skips if an identical entry already exists.
 */
export function registerStandaloneExtensionEntry(
  info: StandaloneExtensionInfo,
): void {
  const exists = standaloneExtensionRegistry.some(
    (e) =>
      e.methodName === info.methodName &&
      e.forType === info.forType &&
      e.qualifier === info.qualifier,
  );
  if (!exists) {
    standaloneExtensionRegistry.push(info);
  }
}

/**
 * Find a standalone extension method for a given method name and type.
 * Returns undefined if no standalone extension is registered.
 */
export function findStandaloneExtension(
  methodName: string,
  typeName: string,
): StandaloneExtensionInfo | undefined {
  return standaloneExtensionRegistry.find(
    (e) => e.methodName === methodName && e.forType === typeName,
  );
}

/**
 * Get all standalone extensions registered for a type.
 */
export function getStandaloneExtensionsForType(
  typeName: string,
): StandaloneExtensionInfo[] {
  return standaloneExtensionRegistry.filter((e) => e.forType === typeName);
}

/**
 * Get all registered standalone extensions.
 */
export function getAllStandaloneExtensions(): StandaloneExtensionInfo[] {
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
  extraArgs: readonly ts.Expression[],
): ts.CallExpression {
  let callee: ts.Expression;
  if (ext.qualifier) {
    callee = factory.createPropertyAccessExpression(
      factory.createIdentifier(ext.qualifier),
      ext.methodName,
    );
  } else {
    callee = factory.createIdentifier(ext.methodName);
  }

  return factory.createCallExpression(callee, undefined, [
    receiver,
    ...extraArgs,
  ]);
}
