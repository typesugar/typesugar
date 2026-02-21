/**
 * Coherence Checking System
 *
 * Detects and reports conflicting or ambiguous typeclass instances.
 * Similar to Rust's orphan rules and Scala's implicit resolution.
 *
 * Conflicts can occur when:
 * 1. Multiple explicit instances for the same (typeclass, type) pair
 * 2. Both explicit and auto-derived instances exist
 * 3. Multiple imported instances from different libraries
 * 4. Local instance shadows an imported one (warning, not error)
 */

import * as ts from "typescript";

/**
 * Source of an instance definition.
 */
export type InstanceSource =
  | "explicit" // @instance decorator
  | "derived" // @derive(TC) or @deriving(TC)
  | "auto-derived" // Automatic derivation via summon()
  | "prelude" // From the prelude (built-in primitives)
  | "imported" // Imported from another module
  | "library"; // From a third-party library

/**
 * Priority of an instance source.
 * Lower number = higher priority.
 */
export const SOURCE_PRIORITY: Record<InstanceSource, number> = {
  explicit: 1, // User-defined explicit instance wins
  derived: 2, // Explicit derive annotation
  imported: 3, // Imported instance
  library: 4, // Library-provided instance
  "auto-derived": 5, // Automatic derivation
  prelude: 6, // Prelude (fallback)
};

/**
 * Detailed information about a registered instance.
 */
export interface InstanceLocation {
  /** The typeclass name (e.g., "Show") */
  typeclass: string;
  /** The type this instance is for (e.g., "Point") */
  forType: string;
  /** How this instance was created */
  source: InstanceSource;
  /** File where the instance was defined */
  fileName: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (0-indexed) */
  column: number;
  /** The AST node (if available) */
  node?: ts.Node;
  /** Module path for imported instances */
  modulePath?: string;
  /** Additional context (e.g., derive macro name) */
  context?: string;
}

/**
 * A detected instance conflict.
 */
export interface InstanceConflict {
  /** Unique key for this conflict */
  key: string;
  /** The typeclass involved */
  typeclass: string;
  /** The type involved */
  forType: string;
  /** The existing instance */
  existing: InstanceLocation;
  /** The new (conflicting) instance */
  incoming: InstanceLocation;
  /** Whether this is a hard error or warning */
  severity: "error" | "warning";
  /** Human-readable message */
  message: string;
}

/**
 * Tracks instances and detects conflicts.
 */
export class CoherenceChecker {
  private instances: Map<string, InstanceLocation[]> = new Map();
  private conflicts: InstanceConflict[] = [];

  /**
   * Generate a key for an instance.
   */
  private key(typeclass: string, forType: string): string {
    return `${typeclass}<${forType}>`;
  }

  /**
   * Register an instance and check for conflicts.
   */
  registerInstance(info: InstanceLocation): InstanceConflict | undefined {
    const key = this.key(info.typeclass, info.forType);
    const existing = this.instances.get(key);

    if (!existing) {
      this.instances.set(key, [info]);
      return undefined;
    }

    // Check if we already have this exact instance (deduplication)
    const duplicate = existing.find(
      (e) => e.source === info.source && e.fileName === info.fileName && e.line === info.line
    );
    if (duplicate) {
      return undefined;
    }

    // Detect conflict
    const conflict = this.detectConflict(key, existing, info);
    if (conflict) {
      this.conflicts.push(conflict);
    }

    // Still store the instance (for completeness)
    existing.push(info);
    return conflict;
  }

  /**
   * Detect if an incoming instance conflicts with existing ones.
   */
  private detectConflict(
    key: string,
    existing: InstanceLocation[],
    incoming: InstanceLocation
  ): InstanceConflict | undefined {
    // Find the highest-priority existing instance
    const primary = existing.reduce((best, current) =>
      SOURCE_PRIORITY[current.source] < SOURCE_PRIORITY[best.source] ? current : best
    );

    const primaryPriority = SOURCE_PRIORITY[primary.source];
    const incomingPriority = SOURCE_PRIORITY[incoming.source];

    // Same priority = conflict (error)
    if (primaryPriority === incomingPriority) {
      return {
        key,
        typeclass: incoming.typeclass,
        forType: incoming.forType,
        existing: primary,
        incoming,
        severity: "error",
        message: this.formatConflictMessage(primary, incoming),
      };
    }

    // Lower priority incoming = shadows (warning only for explicit shadowing)
    if (incomingPriority < primaryPriority && primary.source === "explicit") {
      // New explicit instance shadows another explicit instance
      return {
        key,
        typeclass: incoming.typeclass,
        forType: incoming.forType,
        existing: primary,
        incoming,
        severity: "error",
        message: this.formatConflictMessage(primary, incoming),
      };
    }

    // Higher priority incoming overrides lower priority existing (no conflict)
    // But warn if we're shadowing an explicit instance with a derived one
    if (
      incomingPriority > primaryPriority &&
      incoming.source !== "auto-derived" &&
      primary.source === "explicit"
    ) {
      // Auto-derived or library instance doesn't shadow explicit
      return undefined;
    }

    // Shadowing warning for library imports
    if (
      (primary.source === "library" || primary.source === "imported") &&
      incoming.source === "explicit"
    ) {
      return {
        key,
        typeclass: incoming.typeclass,
        forType: incoming.forType,
        existing: primary,
        incoming,
        severity: "warning",
        message: `Local instance shadows imported instance for ${incoming.typeclass}<${incoming.forType}>`,
      };
    }

    return undefined;
  }

  /**
   * Format a conflict message with source locations.
   */
  private formatConflictMessage(existing: InstanceLocation, incoming: InstanceLocation): string {
    const formatLoc = (loc: InstanceLocation): string => {
      const sourceLabel = {
        explicit: "explicit instance",
        derived: "derived instance",
        "auto-derived": "auto-derived",
        prelude: "prelude",
        imported: `import from ${loc.modulePath || "unknown"}`,
        library: `library ${loc.modulePath || "unknown"}`,
      }[loc.source];
      return `${sourceLabel} at ${loc.fileName}:${loc.line}:${loc.column}`;
    };

    return (
      `Conflicting instances for ${incoming.typeclass}<${incoming.forType}>:\n` +
      `  First: ${formatLoc(existing)}\n` +
      `  Second: ${formatLoc(incoming)}`
    );
  }

  /**
   * Get all detected conflicts.
   */
  getConflicts(): readonly InstanceConflict[] {
    return this.conflicts;
  }

  /**
   * Check if there are any conflicts.
   */
  hasConflicts(): boolean {
    return this.conflicts.length > 0;
  }

  /**
   * Get conflicts as diagnostic data.
   * Returns information needed to construct proper diagnostics.
   */
  getConflictDiagnosticData(): Array<{
    code: number;
    typeclass: string;
    forType: string;
    severity: "error" | "warning";
    message: string;
    incoming: InstanceLocation;
    existing: InstanceLocation;
  }> {
    return this.conflicts.map((conflict) => ({
      code: conflict.severity === "error" ? 9050 : 9051,
      typeclass: conflict.typeclass,
      forType: conflict.forType,
      severity: conflict.severity,
      message: conflict.message,
      incoming: conflict.incoming,
      existing: conflict.existing,
    }));
  }

  /**
   * Find the best instance for a (typeclass, type) pair.
   * Returns the highest-priority instance, or undefined if none.
   */
  findInstance(typeclass: string, forType: string): InstanceLocation | undefined {
    const key = this.key(typeclass, forType);
    const instances = this.instances.get(key);
    if (!instances || instances.length === 0) {
      return undefined;
    }

    // Return highest priority (lowest number)
    return instances.reduce((best, current) =>
      SOURCE_PRIORITY[current.source] < SOURCE_PRIORITY[best.source] ? current : best
    );
  }

  /**
   * Get all instances for a (typeclass, type) pair.
   */
  getAllInstances(typeclass: string, forType: string): InstanceLocation[] {
    const key = this.key(typeclass, forType);
    return this.instances.get(key) ?? [];
  }

  /**
   * Clear all tracked instances and conflicts.
   */
  clear(): void {
    this.instances.clear();
    this.conflicts = [];
  }

  /**
   * Clear conflicts only (keep instances).
   */
  clearConflicts(): void {
    this.conflicts = [];
  }
}

/**
 * Global coherence checker instance.
 */
export const globalCoherenceChecker = new CoherenceChecker();

/**
 * Helper to create an InstanceLocation from a ts.Node.
 */
export function createInstanceLocation(
  typeclass: string,
  forType: string,
  source: InstanceSource,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  modulePath?: string
): InstanceLocation {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    typeclass,
    forType,
    source,
    fileName: sourceFile.fileName,
    line: line + 1,
    column: character,
    node,
    modulePath,
  };
}
