/**
 * Macro Registry - Stores and retrieves macro definitions
 *
 * Uses a table-driven approach to minimize boilerplate across macro kinds.
 */

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

/**
 * Get the registry key for a macro (name for most, label for labeled-block).
 */
function getMacroKey(macro: MacroDefinition): string {
  return macro.kind === "labeled-block" ? macro.label : macro.name;
}

/**
 * Human-readable name for error messages.
 */
const kindDisplayNames: Record<MacroDefinition["kind"], string> = {
  expression: "Expression macro",
  attribute: "Attribute macro",
  derive: "Derive macro",
  "tagged-template": "Tagged template macro",
  type: "Type macro",
  "labeled-block": "Labeled block macro",
};

class MacroRegistryImpl implements MacroRegistry {
  /**
   * All macros stored by kind, then by key (name or label).
   * Using a nested map provides O(1) lookup per kind while keeping
   * the data structure unified.
   */
  private macrosByKind = new Map<
    MacroDefinition["kind"],
    Map<string, MacroDefinition>
  >();

  /**
   * Secondary index: module-scoped lookup for macros that declare a `module`.
   * Key is "module::exportName", value is the macro definition.
   */
  private moduleScopedMacros = new Map<string, MacroDefinition>();

  constructor() {
    // Initialize maps for each kind
    for (const kind of [
      "expression",
      "attribute",
      "derive",
      "tagged-template",
      "type",
      "labeled-block",
    ] as const) {
      this.macrosByKind.set(kind, new Map());
    }
  }

  register(macro: MacroDefinition): void {
    const kindMap = this.macrosByKind.get(macro.kind);
    if (!kindMap) {
      throw new Error(`Unknown macro kind: ${macro.kind}`);
    }

    const key = getMacroKey(macro);
    if (kindMap.has(key)) {
      const keyType = macro.kind === "labeled-block" ? "label" : "name";
      throw new Error(
        `${kindDisplayNames[macro.kind]} with ${keyType} '${key}' is already registered`,
      );
    }

    kindMap.set(key, macro);

    // Index by module if the macro declares one
    if (macro.module) {
      const exportName = macro.exportName ?? macro.name;
      const modKey = moduleKey(macro.module, exportName);
      this.moduleScopedMacros.set(modKey, macro);
    }
  }

  private getByKind<T extends MacroDefinition>(
    kind: MacroDefinition["kind"],
    key: string,
  ): T | undefined {
    return this.macrosByKind.get(kind)?.get(key) as T | undefined;
  }

  getExpression(name: string): ExpressionMacro | undefined {
    return this.getByKind<ExpressionMacro>("expression", name);
  }

  getAttribute(name: string): AttributeMacro | undefined {
    return this.getByKind<AttributeMacro>("attribute", name);
  }

  getDerive(name: string): DeriveMacro | undefined {
    return this.getByKind<DeriveMacro>("derive", name);
  }

  getTaggedTemplate(name: string): TaggedTemplateMacroDef | undefined {
    return this.getByKind<TaggedTemplateMacroDef>("tagged-template", name);
  }

  getType(name: string): TypeMacro | undefined {
    return this.getByKind<TypeMacro>("type", name);
  }

  getLabeledBlock(label: string): LabeledBlockMacro | undefined {
    return this.getByKind<LabeledBlockMacro>("labeled-block", label);
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
    const macro = this.macrosByKind.get(kind)?.get(name);
    return macro?.module !== undefined;
  }

  getAll(): MacroDefinition[] {
    const all: MacroDefinition[] = [];
    for (const kindMap of this.macrosByKind.values()) {
      all.push(...kindMap.values());
    }
    return all;
  }

  /** Clear all registered macros (useful for testing) */
  clear(): void {
    for (const kindMap of this.macrosByKind.values()) {
      kindMap.clear();
    }
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
 * Generic macro definition factory. Adds the `kind` discriminant field.
 */
function defineMacro<K extends MacroDefinition["kind"]>(
  kind: K,
): <T extends Extract<MacroDefinition, { kind: K }>>(
  definition: Omit<T, "kind">,
) => T {
  return (definition) => ({ ...definition, kind }) as any;
}

/** Define an expression macro with type inference */
export const defineExpressionMacro =
  defineMacro<"expression">("expression")<ExpressionMacro>;

/** Define an attribute macro with type inference */
export const defineAttributeMacro =
  defineMacro<"attribute">("attribute")<AttributeMacro>;

/** Define a derive macro with type inference */
export const defineDeriveMacro = defineMacro<"derive">("derive")<DeriveMacro>;

/** Define a tagged template macro with type inference */
export const defineTaggedTemplateMacro =
  defineMacro<"tagged-template">("tagged-template")<TaggedTemplateMacroDef>;

/** Define a type macro with type inference */
export const defineTypeMacro = defineMacro<"type">("type")<TypeMacro>;

/** Define a labeled block macro with type inference */
export const defineLabeledBlockMacro =
  defineMacro<"labeled-block">("labeled-block")<LabeledBlockMacro>;

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
