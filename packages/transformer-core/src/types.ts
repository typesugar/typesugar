/**
 * Core types for typesugar transformation
 *
 * These types are browser-compatible and have no Node.js dependencies.
 */

import type { RawSourceMap, ExpansionRecord } from "@typesugar/core";
import type { PositionMapper } from "./position-mapper.js";

/**
 * Diagnostic from macro expansion
 */
export interface TransformDiagnostic {
  file: string;
  start: number;
  length: number;
  message: string;
  severity: "error" | "warning";
  /** typesugar error code (9001-9999), extracted from message [TS9XXX] prefix */
  code?: number;
  /** Optional code fix suggestion (replacement text) */
  suggestion?: {
    description: string;
    start: number;
    length: number;
    replacement: string;
  };
}

/**
 * Result of transforming a single file
 */
export interface TransformResult {
  /** Original source content */
  original: string;
  /** Transformed code (valid TypeScript) */
  code: string;
  /** Composed source map (original → transformed) */
  sourceMap: RawSourceMap | null;
  /** Position mapper for IDE features */
  mapper: PositionMapper;
  /** Whether the file was modified */
  changed: boolean;
  /** Macro expansion diagnostics */
  diagnostics: TransformDiagnostic[];
  /** Dependencies (files this file imports) */
  dependencies?: Set<string>;
  /** Individual expansion records (populated when trackExpansions is enabled) */
  expansions?: ExpansionRecord[];
}

/**
 * Options for the core transformation (browser-compatible subset)
 */
export interface TransformOptions {
  /** Enable verbose logging */
  verbose?: boolean;
  /** File name for diagnostics */
  fileName?: string;
  /** Enable expansion tracking for source maps and diagnostics */
  trackExpansions?: boolean;
}
