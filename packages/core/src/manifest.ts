/**
 * Library Manifest System
 *
 * Enables third-party libraries to declare typeclass instances, typeclasses,
 * and extension methods that typesugar can discover and use.
 *
 * Libraries create a `typesugar.manifest.json` file or add a `typesugar`
 * field to their `package.json`.
 */

import * as fs from "fs";
import * as path from "path";

// =============================================================================
// Manifest Schema Types
// =============================================================================

/**
 * A typeclass declaration in a library manifest.
 */
export interface ManifestTypeclass {
  /** Typeclass name (e.g., "Codec") */
  name: string;
  /** Module that exports the typeclass interface */
  module: string;
  /** Method names on the typeclass */
  methods: string[];
  /** Type parameters (default: ["A"]) */
  typeParams?: string[];
  /** Description for documentation */
  description?: string;
}

/**
 * An instance registration in a library manifest.
 */
export interface ManifestInstance {
  /** Typeclass name */
  typeclass: string;
  /** Type this instance is for */
  forType: string;
  /** Module that exports the instance */
  module: string;
  /** Export name of the instance */
  export: string;
  /** Type arguments if the instance is for a generic type */
  typeArgs?: string[];
  /** Override default priority (lower = higher priority) */
  priority?: number;
}

/**
 * An extension method registration in a library manifest.
 */
export interface ManifestExtension {
  /** Type to extend */
  forType: string;
  /** Method name */
  method: string;
  /** Module that exports the function */
  module: string;
  /** Export name (defaults to method name) */
  export?: string;
  /** Type signature for documentation */
  signature?: string;
}

/**
 * A custom operator registration in a library manifest.
 */
export interface ManifestOperator {
  /** Operator symbol (e.g., "<+>") */
  symbol: string;
  /** Type the operator applies to */
  forType: string;
  /** Method name to call */
  method: string;
  /** Module containing the method */
  module: string;
  /** Operator precedence */
  precedence?: number;
  /** Associativity */
  associativity?: "left" | "right";
}

/**
 * A derive macro registration in a library manifest.
 */
export interface ManifestDerive {
  /** Derive macro name */
  name: string;
  /** Module that exports the derive macro */
  module: string;
  /** Required typeclasses for error messages */
  requires?: string[];
  /** Supported type kinds */
  supports?: Array<"product" | "sum" | "enum">;
}

/**
 * The full library manifest schema.
 */
export interface LibraryManifest {
  /** Schema URL for validation */
  $schema?: string;
  /** Manifest schema version */
  version: number;
  /** Package name (for diagnostics) */
  name: string;
  /** Typeclass declarations */
  typeclasses?: ManifestTypeclass[];
  /** Instance registrations */
  instances?: ManifestInstance[];
  /** Extension method registrations */
  extensions?: ManifestExtension[];
  /** Custom operator registrations */
  operators?: ManifestOperator[];
  /** Derive macro registrations */
  derives?: ManifestDerive[];
}

// =============================================================================
// Manifest Discovery and Loading
// =============================================================================

/**
 * A discovered manifest with its source location.
 */
export interface DiscoveredManifest {
  /** The parsed manifest */
  manifest: LibraryManifest;
  /** Path to the manifest file or package.json */
  sourcePath: string;
  /** Package root directory */
  packageRoot: string;
}

/**
 * Options for manifest discovery.
 */
export interface ManifestDiscoveryOptions {
  /** Base directory to start searching from */
  baseDir: string;
  /** Whether to scan node_modules (default: true) */
  scanNodeModules?: boolean;
  /** Package names to exclude */
  exclude?: string[];
  /** Maximum depth for node_modules scanning */
  maxDepth?: number;
}

/**
 * Discover all typesugar manifests in a project.
 */
export function discoverManifests(options: ManifestDiscoveryOptions): DiscoveredManifest[] {
  const results: DiscoveredManifest[] = [];
  const visited = new Set<string>();
  const { exclude = [], scanNodeModules = true, maxDepth = 3 } = options;

  function scanDirectory(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    if (visited.has(dir)) return;
    visited.add(dir);

    // Check for typesugar.manifest.json
    const manifestPath = path.join(dir, "typesugar.manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const content = fs.readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(content) as LibraryManifest;
        if (!exclude.includes(manifest.name)) {
          results.push({
            manifest,
            sourcePath: manifestPath,
            packageRoot: dir,
          });
        }
      } catch {
        // Invalid manifest, skip
      }
    }

    // Check for package.json with typesugar field
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const content = fs.readFileSync(pkgPath, "utf-8");
        const pkg = JSON.parse(content) as {
          name?: string;
          typesugar?: Partial<LibraryManifest>;
        };
        if (pkg.typesugar && pkg.name) {
          const manifest: LibraryManifest = {
            version: 1,
            name: pkg.name,
            ...pkg.typesugar,
          };
          if (!exclude.includes(manifest.name)) {
            results.push({
              manifest,
              sourcePath: pkgPath,
              packageRoot: dir,
            });
          }
        }
      } catch {
        // Invalid package.json, skip
      }
    }

    // Scan node_modules if enabled
    if (scanNodeModules) {
      const nodeModulesPath = path.join(dir, "node_modules");
      if (fs.existsSync(nodeModulesPath) && fs.statSync(nodeModulesPath).isDirectory()) {
        try {
          const entries = fs.readdirSync(nodeModulesPath);
          for (const entry of entries) {
            if (entry.startsWith(".")) continue;
            const entryPath = path.join(nodeModulesPath, entry);
            const stat = fs.statSync(entryPath);
            if (stat.isDirectory()) {
              // Handle scoped packages
              if (entry.startsWith("@")) {
                const scopedEntries = fs.readdirSync(entryPath);
                for (const scopedEntry of scopedEntries) {
                  const scopedPath = path.join(entryPath, scopedEntry);
                  if (fs.statSync(scopedPath).isDirectory()) {
                    scanDirectory(scopedPath, depth + 1);
                  }
                }
              } else {
                scanDirectory(entryPath, depth + 1);
              }
            }
          }
        } catch {
          // Cannot read node_modules, skip
        }
      }
    }
  }

  scanDirectory(options.baseDir, 0);
  return results;
}

/**
 * Load a single manifest file.
 */
export function loadManifest(manifestPath: string): LibraryManifest | null {
  try {
    const content = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(content) as LibraryManifest;
  } catch {
    return null;
  }
}

/**
 * Validate a manifest against the schema.
 */
export function validateManifest(manifest: LibraryManifest): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof manifest.version !== "number") {
    errors.push("Missing or invalid 'version' field");
  }

  if (typeof manifest.name !== "string" || !manifest.name) {
    errors.push("Missing or invalid 'name' field");
  }

  if (manifest.typeclasses) {
    for (let i = 0; i < manifest.typeclasses.length; i++) {
      const tc = manifest.typeclasses[i];
      if (!tc.name) errors.push(`typeclasses[${i}]: missing 'name'`);
      if (!tc.module) errors.push(`typeclasses[${i}]: missing 'module'`);
      if (!Array.isArray(tc.methods)) errors.push(`typeclasses[${i}]: missing 'methods' array`);
    }
  }

  if (manifest.instances) {
    for (let i = 0; i < manifest.instances.length; i++) {
      const inst = manifest.instances[i];
      if (!inst.typeclass) errors.push(`instances[${i}]: missing 'typeclass'`);
      if (!inst.forType) errors.push(`instances[${i}]: missing 'forType'`);
      if (!inst.module) errors.push(`instances[${i}]: missing 'module'`);
      if (!inst.export) errors.push(`instances[${i}]: missing 'export'`);
    }
  }

  if (manifest.extensions) {
    for (let i = 0; i < manifest.extensions.length; i++) {
      const ext = manifest.extensions[i];
      if (!ext.forType) errors.push(`extensions[${i}]: missing 'forType'`);
      if (!ext.method) errors.push(`extensions[${i}]: missing 'method'`);
      if (!ext.module) errors.push(`extensions[${i}]: missing 'module'`);
    }
  }

  if (manifest.operators) {
    for (let i = 0; i < manifest.operators.length; i++) {
      const op = manifest.operators[i];
      if (!op.symbol) errors.push(`operators[${i}]: missing 'symbol'`);
      if (!op.forType) errors.push(`operators[${i}]: missing 'forType'`);
      if (!op.method) errors.push(`operators[${i}]: missing 'method'`);
      if (!op.module) errors.push(`operators[${i}]: missing 'module'`);
    }
  }

  if (manifest.derives) {
    for (let i = 0; i < manifest.derives.length; i++) {
      const derive = manifest.derives[i];
      if (!derive.name) errors.push(`derives[${i}]: missing 'name'`);
      if (!derive.module) errors.push(`derives[${i}]: missing 'module'`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// Manifest Registry (Runtime)
// =============================================================================

/**
 * Aggregated registrations from all discovered manifests.
 */
export interface ManifestRegistry {
  typeclasses: Map<string, ManifestTypeclass & { source: string }>;
  instances: Map<string, ManifestInstance & { source: string }>;
  extensions: Map<string, ManifestExtension & { source: string }>;
  operators: Map<string, ManifestOperator & { source: string }>;
  derives: Map<string, ManifestDerive & { source: string }>;
}

/**
 * Create an empty manifest registry.
 */
export function createManifestRegistry(): ManifestRegistry {
  return {
    typeclasses: new Map(),
    instances: new Map(),
    extensions: new Map(),
    operators: new Map(),
    derives: new Map(),
  };
}

/**
 * Merge a discovered manifest into the registry.
 */
export function mergeManifestIntoRegistry(
  registry: ManifestRegistry,
  discovered: DiscoveredManifest
): void {
  const { manifest, sourcePath } = discovered;

  if (manifest.typeclasses) {
    for (const tc of manifest.typeclasses) {
      registry.typeclasses.set(tc.name, { ...tc, source: sourcePath });
    }
  }

  if (manifest.instances) {
    for (const inst of manifest.instances) {
      const key = `${inst.typeclass}<${inst.forType}>`;
      registry.instances.set(key, { ...inst, source: sourcePath });
    }
  }

  if (manifest.extensions) {
    for (const ext of manifest.extensions) {
      const key = `${ext.forType}.${ext.method}`;
      registry.extensions.set(key, { ...ext, source: sourcePath });
    }
  }

  if (manifest.operators) {
    for (const op of manifest.operators) {
      const key = `${op.symbol}@${op.forType}`;
      registry.operators.set(key, { ...op, source: sourcePath });
    }
  }

  if (manifest.derives) {
    for (const derive of manifest.derives) {
      registry.derives.set(derive.name, { ...derive, source: sourcePath });
    }
  }
}

/**
 * Global manifest registry (populated during initialization).
 */
let globalManifestRegistry: ManifestRegistry | null = null;

/**
 * Get the global manifest registry, initializing if needed.
 */
export function getManifestRegistry(baseDir?: string): ManifestRegistry {
  if (!globalManifestRegistry) {
    globalManifestRegistry = createManifestRegistry();
    if (baseDir) {
      const discovered = discoverManifests({ baseDir });
      for (const d of discovered) {
        mergeManifestIntoRegistry(globalManifestRegistry, d);
      }
    }
  }
  return globalManifestRegistry;
}

/**
 * Reset the global manifest registry (for testing).
 */
export function resetManifestRegistry(): void {
  globalManifestRegistry = null;
}
