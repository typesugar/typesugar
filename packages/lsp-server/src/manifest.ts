/**
 * Manifest loading for the LSP server.
 *
 * Reads typesugar.manifest.json and provides name sets for macro detection.
 * Simplified version of packages/vscode/src/manifest.ts without VS Code dependencies.
 */

import * as fs from "fs";
import * as path from "path";

export interface MacroManifest {
  version: number;
  macros: {
    expression: Record<string, { module: string; description?: string }>;
    decorator: Record<string, { module: string; description?: string; args?: string[] }>;
    taggedTemplate: Record<string, { module: string; description?: string; contentType?: string }>;
    labeledBlock: Record<
      string,
      { module: string; description?: string; continuations?: string[] }
    >;
    type?: Record<string, { module: string; description?: string }>;
    extensionMethods?: Record<string, { typeclass: string; description?: string }>;
  };
}

const DEFAULT_MANIFEST: MacroManifest = {
  version: 1,
  macros: {
    expression: {
      comptime: { module: "@typesugar/macros" },
      specialize: { module: "@typesugar/specialize" },
      summon: { module: "@typesugar/typeclass" },
      match: { module: "@typesugar/std" },
      includeStr: { module: "@typesugar/macros" },
      includeJson: { module: "@typesugar/macros" },
      staticAssert: { module: "@typesugar/macros" },
    },
    decorator: {
      derive: {
        module: "@typesugar/derive",
        args: ["Eq", "Ord", "Clone", "Debug", "Hash", "Default", "Json", "Builder", "Show"],
      },
      typeclass: { module: "@typesugar/typeclass" },
      instance: { module: "@typesugar/typeclass" },
      impl: { module: "@typesugar/typeclass" },
      operator: { module: "@typesugar/macros" },
      extension: { module: "@typesugar/macros" },
    },
    taggedTemplate: {
      sql: { module: "@typesugar/sql", contentType: "sql" },
    },
    labeledBlock: {
      let: { module: "@typesugar/std", continuations: ["yield", "pure"] },
    },
    type: {},
    extensionMethods: {},
  },
};

export class ManifestState {
  current: MacroManifest = DEFAULT_MANIFEST;

  // Computed name sets
  expressionMacroNames = new Set<string>();
  decoratorMacroNames = new Set<string>();
  taggedTemplateMacroNames = new Set<string>();
  labeledBlockLabels = new Set<string>();
  extensionMethodNames = new Set<string>();
  deriveArgNames = new Set<string>();

  constructor() {
    this.recompute();
  }

  load(workspaceRoot: string): boolean {
    const candidates = [path.join(workspaceRoot, "typesugar.manifest.json")];

    for (const candidate of candidates) {
      try {
        const content = fs.readFileSync(candidate, "utf-8");
        const parsed = JSON.parse(content) as MacroManifest;
        if (parsed.version === 1 && parsed.macros) {
          this.current = this.merge(DEFAULT_MANIFEST, parsed);
          this.recompute();
          return true;
        }
      } catch {
        // Try next candidate
      }
    }

    return false;
  }

  private merge(base: MacroManifest, overlay: MacroManifest): MacroManifest {
    const om = overlay.macros ?? {};
    return {
      version: 1,
      macros: {
        expression: { ...base.macros.expression, ...(om.expression ?? {}) },
        decorator: { ...base.macros.decorator, ...(om.decorator ?? {}) },
        taggedTemplate: { ...base.macros.taggedTemplate, ...(om.taggedTemplate ?? {}) },
        labeledBlock: { ...base.macros.labeledBlock, ...(om.labeledBlock ?? {}) },
        type: { ...base.macros.type, ...(om.type ?? {}) },
        extensionMethods: { ...base.macros.extensionMethods, ...(om.extensionMethods ?? {}) },
      },
    };
  }

  private recompute(): void {
    this.expressionMacroNames = new Set(Object.keys(this.current.macros.expression));
    this.decoratorMacroNames = new Set(Object.keys(this.current.macros.decorator));
    this.taggedTemplateMacroNames = new Set(Object.keys(this.current.macros.taggedTemplate));

    this.labeledBlockLabels = new Set<string>();
    for (const [name, entry] of Object.entries(this.current.macros.labeledBlock)) {
      this.labeledBlockLabels.add(name);
      if (entry.continuations) {
        for (const c of entry.continuations) {
          this.labeledBlockLabels.add(c);
        }
      }
    }

    this.extensionMethodNames = new Set(Object.keys(this.current.macros.extensionMethods ?? {}));

    this.deriveArgNames = new Set<string>();
    for (const entry of Object.values(this.current.macros.decorator)) {
      if (entry.args) {
        for (const arg of entry.args) {
          this.deriveArgNames.add(arg);
        }
      }
    }
  }
}
