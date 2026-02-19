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
