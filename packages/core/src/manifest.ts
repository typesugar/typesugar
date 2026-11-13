/**
 * Library Manifest System
 *
 * The schema for a `typesugar.manifest.json` file, in which a library would
 * declare its typeclasses, instances, extension methods and operators, plus
 * `loadManifest`/`validateManifest` to read and check one.
 *
 * Planned, not in 1.0: the compiler does not discover or read manifests, so a
 * manifest has no effect on a build (see docs/guides/library-manifest.md).
 */

import * as fs from "fs";

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
// Manifest Loading
// =============================================================================

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
