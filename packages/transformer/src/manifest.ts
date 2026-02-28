/**
 * Manifest Generator — produces typesugar.manifest.json from the registry.
 *
 * This module has NO dependency on vscode. It reads the global macro registry
 * and serializes it into the manifest format consumed by the VSCode extension.
 *
 * Usage:
 *   typesugar build --manifest          # writes typesugar.manifest.json
 *   typesugar build --manifest out.json # writes to custom path
 */

import type { MacroRegistry } from "@typesugar/core";

// ---------------------------------------------------------------------------
// Manifest Types (duplicated from the extension to avoid cross-dependency)
// ---------------------------------------------------------------------------

export interface MacroManifest {
  version: number;
  macros: {
    expression: Record<string, ManifestEntry>;
    decorator: Record<string, ManifestDecoratorEntry>;
    taggedTemplate: Record<string, ManifestTaggedTemplateEntry>;
    labeledBlock: Record<string, ManifestLabeledBlockEntry>;
    type: Record<string, ManifestEntry>;
    extensionMethods: Record<string, ManifestExtensionMethodEntry>;
  };
}

interface ManifestEntry {
  module: string;
  description?: string;
}

interface ManifestDecoratorEntry extends ManifestEntry {
  args?: string[];
}

interface ManifestTaggedTemplateEntry extends ManifestEntry {
  contentType?: string;
}

interface ManifestLabeledBlockEntry extends ManifestEntry {
  continuations?: string[];
}

interface ManifestExtensionMethodEntry {
  typeclass: string;
  description?: string;
  returnType?: string;
}

// Map of tagged template names to their embedded content types
const CONTENT_TYPE_MAP: Record<string, string> = {
  sql: "sql",
  regex: "regex",
  html: "html",
  fmt: "format-string",
  json: "json",
  units: "units",
};

// Known extension methods from the typeclass system
const KNOWN_EXTENSION_METHODS: Record<string, ManifestExtensionMethodEntry> = {
  show: {
    typeclass: "Show",
    description: "Convert to string representation",
    returnType: "string",
  },
  eq: { typeclass: "Eq", description: "Check equality", returnType: "boolean" },
  neq: {
    typeclass: "Eq",
    description: "Check inequality",
    returnType: "boolean",
  },
  compare: {
    typeclass: "Ord",
    description: "Compare ordering",
    returnType: "-1 | 0 | 1",
  },
  hash: {
    typeclass: "Hash",
    description: "Compute hash code",
    returnType: "number",
  },
  combine: {
    typeclass: "Semigroup",
    description: "Combine values",
    returnType: "self",
  },
  empty: {
    typeclass: "Monoid",
    description: "Identity element",
    returnType: "self",
  },
  map: {
    typeclass: "Functor",
    description: "Map over contained values",
    returnType: "self",
  },
};

/**
 * Generate a manifest from the macro registry.
 *
 * This reads all registered macros and produces a JSON-serializable manifest
 * that the VSCode extension uses for syntax highlighting, completions, etc.
 */
export function generateManifest(registry: MacroRegistry): MacroManifest {
  const manifest: MacroManifest = {
    version: 1,
    macros: {
      expression: {},
      decorator: {},
      taggedTemplate: {},
      labeledBlock: {},
      type: {},
      extensionMethods: { ...KNOWN_EXTENSION_METHODS },
    },
  };

  for (const macro of registry.getAll()) {
    const baseEntry: ManifestEntry = {
      module: macro.module ?? "typesugar",
      description: macro.description,
    };

    switch (macro.kind) {
      case "expression":
        manifest.macros.expression[macro.name] = baseEntry;
        break;

      case "attribute":
        manifest.macros.decorator[macro.name] = baseEntry;
        break;

      case "derive": {
        // Derive macros are aggregated under the "derive" decorator entry
        if (!manifest.macros.decorator.derive) {
          manifest.macros.decorator.derive = {
            module: "typesugar",
            description: "Auto-derive implementations",
            args: [],
          };
        }
        manifest.macros.decorator.derive.args!.push(macro.name);
        break;
      }

      case "tagged-template": {
        const contentType = CONTENT_TYPE_MAP[macro.name];
        const entry: ManifestTaggedTemplateEntry = {
          ...baseEntry,
          ...(contentType ? { contentType } : {}),
        };
        manifest.macros.taggedTemplate[macro.name] = entry;
        break;
      }

      case "labeled-block": {
        const lbMacro = macro as {
          name: string;
          label?: string;
          continuationLabels?: string[];
          module?: string;
          description?: string;
          kind: string;
        };
        const entry: ManifestLabeledBlockEntry = {
          ...baseEntry,
          continuations: lbMacro.continuationLabels,
        };
        manifest.macros.labeledBlock[lbMacro.label ?? macro.name] = entry;
        break;
      }

      case "type":
        manifest.macros.type[macro.name] = baseEntry;
        break;
    }
  }

  return manifest;
}

/**
 * Create a default empty manifest for bootstrapping
 */
export function createDefaultManifest(): MacroManifest {
  return {
    version: 1,
    macros: {
      expression: {},
      decorator: {},
      taggedTemplate: {},
      labeledBlock: {},
      type: {},
      extensionMethods: { ...KNOWN_EXTENSION_METHODS },
    },
  };
}
