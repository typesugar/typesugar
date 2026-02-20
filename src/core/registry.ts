/**
 * Macro Registry - Stores and retrieves macro definitions
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

  register(macro: MacroDefinition): void {
    switch (macro.kind) {
      case "expression":
        if (this.expressionMacros.has(macro.name)) {
          throw new Error(
            `Expression macro '${macro.name}' is already registered`,
          );
        }
        this.expressionMacros.set(macro.name, macro);
        break;

      case "attribute":
        if (this.attributeMacros.has(macro.name)) {
          throw new Error(
            `Attribute macro '${macro.name}' is already registered`,
          );
        }
        this.attributeMacros.set(macro.name, macro);
        break;

      case "derive":
        if (this.deriveMacros.has(macro.name)) {
          throw new Error(`Derive macro '${macro.name}' is already registered`);
        }
        this.deriveMacros.set(macro.name, macro);
        break;

      case "tagged-template":
        if (this.taggedTemplateMacros.has(macro.name)) {
          throw new Error(
            `Tagged template macro '${macro.name}' is already registered`,
          );
        }
        this.taggedTemplateMacros.set(macro.name, macro);
        break;

      case "type":
        if (this.typeMacros.has(macro.name)) {
          throw new Error(`Type macro '${macro.name}' is already registered`);
        }
        this.typeMacros.set(macro.name, macro);
        break;

      case "labeled-block":
        if (this.labeledBlockMacros.has(macro.label)) {
          throw new Error(
            `Labeled block macro for label '${macro.label}' is already registered`,
          );
        }
        this.labeledBlockMacros.set(macro.label, macro);
        break;

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
