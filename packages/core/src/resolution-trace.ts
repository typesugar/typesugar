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
  source: "auto-derive" | "explicit-instance" | "import" | "prelude" | "builtin";
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
    source: ResolutionRecord["source"]
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
      byTypeclass[record.resolvedTo.name] = (byTypeclass[record.resolvedTo.name] ?? 0) + 1;
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
  getResolutionAt(fileName: string, position: number): ResolutionRecord | undefined {
    return this.records.find(
      (r) =>
        r.sourceNode.fileName === fileName &&
        r.sourceNode.start <= position &&
        r.sourceNode.end >= position
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
          `  [${record.kind}] ${record.sourceNode.text} → ${resolved}${typeArgsStr} (${record.source})`
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
    this.records = this.records.filter((r) => r.sourceNode.fileName !== fileName);
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

// ============================================================================
// Resolution Trace Types (for error diagnostics)
// ============================================================================

/**
 * A single resolution attempt, used to build detailed error messages
 * when instance resolution fails.
 *
 * Unlike ResolutionRecord (which tracks successful resolutions for IDE features),
 * ResolutionAttempt tracks both successful and failed resolution steps,
 * forming a tree of what was tried and why each path succeeded or failed.
 */
export interface ResolutionAttempt {
  /** The resolution step being attempted (e.g., "explicit-instance", "auto-derive", "field-check") */
  step: string;
  /** What we were looking for (e.g., "Eq<Point>", "GenericMeta for Point", "field `color`") */
  target: string;
  /** The outcome of this attempt */
  result: "found" | "not-found" | "rejected";
  /** Human-readable reason for the outcome (especially for failures) */
  reason?: string;
  /** Nested attempts (e.g., per-field checks under an auto-derive attempt) */
  children?: ResolutionAttempt[];
}

/**
 * A complete resolution trace, capturing all attempts made when resolving
 * a typeclass instance. Used to generate detailed error messages.
 */
export interface ResolutionTrace {
  /** What we were trying to resolve (e.g., "Eq<Point>") */
  sought: string;
  /** All resolution attempts in order */
  attempts: ResolutionAttempt[];
  /** Final outcome */
  finalResult: "resolved" | "failed";
}

/**
 * Format a resolution trace into lines suitable for diagnostic notes.
 *
 * Produces output like:
 * ```
 * resolution trace for Eq<Point>:
 *   1. explicit instance lookup — not found
 *   2. auto-derive via Generic:
 *        GenericMeta for Point: { x: number, y: number, color: Color }
 *        field `x`: number has Eq — ok
 *        field `y`: number has Eq — ok
 *        field `color`: Color lacks Eq — FAILED
 * ```
 *
 * @param trace - The resolution trace to format
 * @returns Array of lines (without leading "= note:" prefix, caller adds that)
 */
export function formatResolutionTrace(trace: ResolutionTrace): string[] {
  const lines: string[] = [];
  lines.push(`resolution trace for ${trace.sought}:`);

  for (let i = 0; i < trace.attempts.length; i++) {
    const attempt = trace.attempts[i];
    const stepNum = i + 1;
    lines.push(...formatAttempt(attempt, stepNum, 1));
  }

  return lines;
}

/**
 * Format a single resolution attempt with optional children.
 */
function formatAttempt(
  attempt: ResolutionAttempt,
  stepNum: number | null,
  depth: number
): string[] {
  const lines: string[] = [];
  const indent = "  ".repeat(depth);
  const prefix = stepNum !== null ? `${stepNum}. ` : "";

  const resultIndicator = formatResultIndicator(attempt.result);
  const reasonSuffix = attempt.reason ? ` — ${attempt.reason}` : "";

  lines.push(
    `${indent}${prefix}${attempt.step}: ${attempt.target}${resultIndicator}${reasonSuffix}`
  );

  if (attempt.children && attempt.children.length > 0) {
    for (const child of attempt.children) {
      lines.push(...formatAttempt(child, null, depth + 1));
    }
  }

  return lines;
}

/**
 * Format result indicator for trace output.
 */
function formatResultIndicator(result: ResolutionAttempt["result"]): string {
  switch (result) {
    case "found":
      return " — ok";
    case "not-found":
      return " — not found";
    case "rejected":
      return " — FAILED";
  }
}

/**
 * Generate a help message based on the resolution trace.
 * Identifies the most specific actionable fix.
 */
export function generateHelpFromTrace(
  trace: ResolutionTrace,
  typeclassName: string,
  typeName: string
): string {
  // Find the most specific failure
  for (const attempt of trace.attempts) {
    if (attempt.step === "auto-derive" && attempt.children) {
      // Look for a failing field check
      for (const child of attempt.children) {
        if (child.result === "rejected" && child.step === "field-check") {
          // Extract the field type from the target (e.g., "field `color`: Color")
          const match = child.target.match(/field `(\w+)`: (\w+)/);
          if (match) {
            const [, fieldName, fieldType] = match;
            return `Add @derive(${typeclassName}) to ${fieldType}, or provide @instance ${typeclassName}<${fieldType}>`;
          }
        }
      }

      // Generic meta not found
      if (attempt.result === "not-found") {
        return `Ensure ${typeName} is defined in the current file or imported`;
      }
    }

    if (attempt.step === "derivation-strategy" && attempt.result === "not-found") {
      return `No derivation strategy registered for ${typeclassName}. Provide @instance ${typeclassName}<${typeName}>`;
    }
  }

  // Fallback
  return `Add @derive(${typeclassName}) to ${typeName}, or provide @instance ${typeclassName}<${typeName}>`;
}

/**
 * Global resolution tracer instance.
 */
export const globalResolutionTracer = new ResolutionTracer();
