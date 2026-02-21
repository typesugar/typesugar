/**
 * Resolution Tracing System
 *
 * Tracks typeclass and operator resolutions for debugging, IDE features,
 * and documentation purposes.
 *
 * Features:
 * - Records all resolutions with source locations
 * - Provides data for VS Code inlay hints
 * - Supports CLI --trace flag output
 * - Generates hover information
 */

import * as ts from "typescript";
import { config } from "./config.js";

/**
 * Types of resolutions that can be traced.
 */
export type ResolutionKind =
  | "typeclass-method" // e.g., point.show() → Show<Point>.show
  | "typeclass-operator" // e.g., a === b → Eq<T>.equals
  | "extension-method" // e.g., num.clamp() → NumberExt.clamp
  | "derive" // e.g., @derive(Eq) → generated Eq instance
  | "summon" // e.g., summon<Eq<Point>>() → instance lookup
  | "implicit-param" // e.g., @implicits parameter fill-in
  | "custom-operator" // e.g., a |> b → __binop__
  | "macro"; // e.g., comptime() expansion

/**
 * A single resolution event record.
 */
export interface ResolutionRecord {
  /** What kind of resolution occurred */
  kind: ResolutionKind;
  /** The source expression that triggered resolution */
  sourceNode: {
    fileName: string;
    start: number;
    end: number;
    text: string;
  };
  /** What it resolved to */
  resolvedTo: {
    /** The typeclass or extension name */
    name: string;
    /** The module it came from */
    module?: string;
    /** The specific method */
    method?: string;
    /** For generic resolutions, the type arguments */
    typeArgs?: string[];
  };
  /** How the resolution was made */
  source:
    | "auto-derive"
    | "explicit-instance"
    | "import"
    | "prelude"
    | "builtin";
  /** Timestamp for ordering */
  timestamp: number;
}

/**
 * Summary of resolutions in a file.
 */
export interface FileSummary {
  fileName: string;
  totalResolutions: number;
  byKind: Record<ResolutionKind, number>;
  byTypeclass: Record<string, number>;
}

/**
 * Tracks all resolutions during a compilation.
 */
export class ResolutionTracer {
  private records: ResolutionRecord[] = [];
  private enabled: boolean;

  constructor() {
    this.enabled = config.get<boolean>("tracing") ?? false;
  }

  /**
   * Check if tracing is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable tracing programmatically.
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disable tracing.
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Record a resolution event.
   */
  record(
    kind: ResolutionKind,
    sourceNode: ts.Node,
    sourceFile: ts.SourceFile,
    resolvedTo: ResolutionRecord["resolvedTo"],
    source: ResolutionRecord["source"],
  ): void {
    if (!this.enabled) return;

    this.records.push({
      kind,
      sourceNode: {
        fileName: sourceFile.fileName,
        start: sourceNode.getStart(sourceFile),
        end: sourceNode.getEnd(),
        text: sourceNode.getText(sourceFile),
      },
      resolvedTo,
      source,
      timestamp: Date.now(),
    });
  }

  /**
   * Get all records for a file.
   */
  getRecordsForFile(fileName: string): ResolutionRecord[] {
    return this.records.filter((r) => r.sourceNode.fileName === fileName);
  }

  /**
   * Get all records.
   */
  getAllRecords(): ResolutionRecord[] {
    return [...this.records];
  }

  /**
   * Get a summary for a file.
   */
  getSummary(fileName: string): FileSummary {
    const fileRecords = this.getRecordsForFile(fileName);

    const byKind: Record<string, number> = {};
    const byTypeclass: Record<string, number> = {};

    for (const record of fileRecords) {
      byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
      byTypeclass[record.resolvedTo.name] =
        (byTypeclass[record.resolvedTo.name] ?? 0) + 1;
    }

    return {
      fileName,
      totalResolutions: fileRecords.length,
      byKind: byKind as Record<ResolutionKind, number>,
      byTypeclass,
    };
  }

  /**
   * Get resolution at a specific position (for hover info).
   */
  getResolutionAt(
    fileName: string,
    position: number,
  ): ResolutionRecord | undefined {
    return this.records.find(
      (r) =>
        r.sourceNode.fileName === fileName &&
        r.sourceNode.start <= position &&
        r.sourceNode.end >= position,
    );
  }

  /**
   * Get inlay hint data for a file.
   * Returns positions and labels for VS Code inlay hints.
   */
  getInlayHints(fileName: string): Array<{
    position: number;
    label: string;
    kind: "typeclass" | "method";
  }> {
    return this.getRecordsForFile(fileName).map((record) => ({
      position: record.sourceNode.end,
      label: record.resolvedTo.method
        ? `${record.resolvedTo.name}.${record.resolvedTo.method}`
        : record.resolvedTo.name,
      kind: record.kind === "extension-method" ? "method" : "typeclass",
    }));
  }

  /**
   * Format trace output for CLI.
   */
  formatForCLI(fileName?: string): string {
    const records = fileName ? this.getRecordsForFile(fileName) : this.records;

    if (records.length === 0) {
      return "No resolutions recorded.";
    }

    const lines: string[] = [];

    // Group by file
    const byFile = new Map<string, ResolutionRecord[]>();
    for (const record of records) {
      const file = record.sourceNode.fileName;
      if (!byFile.has(file)) {
        byFile.set(file, []);
      }
      byFile.get(file)!.push(record);
    }

    for (const [file, fileRecords] of byFile) {
      lines.push(`\n== ${file} ==\n`);

      for (const record of fileRecords) {
        const loc = `${record.sourceNode.start}-${record.sourceNode.end}`;
        const resolved = record.resolvedTo.method
          ? `${record.resolvedTo.name}.${record.resolvedTo.method}`
          : record.resolvedTo.name;
        const typeArgs = record.resolvedTo.typeArgs?.join(", ") ?? "";
        const typeArgsStr = typeArgs ? `<${typeArgs}>` : "";

        lines.push(
          `  [${record.kind}] ${record.sourceNode.text} → ${resolved}${typeArgsStr} (${record.source})`,
        );
      }
    }

    return lines.join("\n");
  }

  /**
   * Generate hover markdown for a resolution.
   */
  generateHoverContent(record: ResolutionRecord): string {
    const resolved = record.resolvedTo.method
      ? `${record.resolvedTo.name}.${record.resolvedTo.method}`
      : record.resolvedTo.name;

    const typeArgs = record.resolvedTo.typeArgs?.join(", ") ?? "";
    const typeArgsStr = typeArgs ? `<${typeArgs}>` : "";

    const lines = [
      `**Typesugar Resolution**`,
      ``,
      `\`${record.sourceNode.text}\` resolves to \`${resolved}${typeArgsStr}\``,
      ``,
      `- **Kind:** ${formatKind(record.kind)}`,
      `- **Source:** ${formatSource(record.source)}`,
    ];

    if (record.resolvedTo.module) {
      lines.push(`- **Module:** \`${record.resolvedTo.module}\``);
    }

    return lines.join("\n");
  }

  /**
   * Clear all records.
   */
  clear(): void {
    this.records = [];
  }

  /**
   * Clear records for a specific file.
   */
  clearFile(fileName: string): void {
    this.records = this.records.filter(
      (r) => r.sourceNode.fileName !== fileName,
    );
  }
}

/**
 * Format resolution kind for display.
 */
function formatKind(kind: ResolutionKind): string {
  switch (kind) {
    case "typeclass-method":
      return "Typeclass Method";
    case "typeclass-operator":
      return "Typeclass Operator";
    case "extension-method":
      return "Extension Method";
    case "derive":
      return "Auto-Derive";
    case "summon":
      return "Summon";
    case "implicit-param":
      return "Implicit Parameter";
    case "custom-operator":
      return "Custom Operator";
    default:
      return kind;
  }
}

/**
 * Format resolution source for display.
 */
function formatSource(source: ResolutionRecord["source"]): string {
  switch (source) {
    case "auto-derive":
      return "Auto-derived from type structure";
    case "explicit-instance":
      return "Explicit @instance declaration";
    case "import":
      return "Imported module";
    case "prelude":
      return "Typesugar prelude";
    case "builtin":
      return "Built-in primitive instance";
    default:
      return source;
  }
}

/**
 * Global resolution tracer instance.
 */
export const globalResolutionTracer = new ResolutionTracer();
