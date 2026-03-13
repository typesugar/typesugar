/**
 * @typesugar/oxc-engine
 *
 * Rust-native macro engine for typesugar using oxc.
 * Provides high-performance parsing, AST transformation, and code generation.
 */

// Re-export native bindings
// When built, napi-rs generates index.js with the native bindings
export {
  transform,
  transformWithMacros,
  benchmarkParse,
  type TransformResult,
  type TransformOptions,
  type Diagnostic,
  type BenchmarkResult,
} from "./index.js";

// Type definitions for the transform API
export interface TransformResult {
  /** The transformed code */
  code: string;
  /** Source map (JSON string) */
  map: string | null;
  /** Whether the code was changed */
  changed: boolean;
  /** Any diagnostics/errors */
  diagnostics: Diagnostic[];
}

export interface Diagnostic {
  severity: string;
  message: string;
  line?: number;
  column?: number;
}

export interface TransformOptions {
  /** Enable source map generation */
  sourceMap?: boolean;
  /** Configuration for conditional compilation (cfg macro) */
  cfgConfig?: Record<string, unknown>;
}

export interface BenchmarkResult {
  parseMs: number;
  errorCount: number;
}

/** Transform TypeScript source code using oxc */
export declare function transform(
  source: string,
  filename: string,
  options?: TransformOptions
): TransformResult;

/** Benchmark parse timing (for performance comparison) */
export declare function benchmarkParse(
  source: string,
  filename: string
): BenchmarkResult;

// Protocol types for JS callback API

/** Information about a macro call site, sent to JS callback */
export interface MacroCallInfo {
  /** Name of the macro being invoked (e.g., "typeclass", "impl") */
  macroName: string;
  /** Arguments to the macro as source text strings */
  callSiteArgs: string[];
  /** JSDoc tag value if this is a JSDoc-triggered macro */
  jsDocTag?: string;
  /** Source filename */
  filename: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (0-indexed) */
  column: number;
}

/** Kind of AST node the expansion represents */
export type ExpansionKind = "expression" | "statements" | "declaration";

/** A diagnostic from macro expansion */
export interface ExpansionDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  column?: number;
}

/** Result of macro expansion, returned from JS callback */
export interface MacroExpansion {
  /** The expanded code */
  code: string;
  /** What kind of AST node the expansion represents */
  kind: ExpansionKind;
  /** Any diagnostics from the expansion */
  diagnostics: ExpansionDiagnostic[];
}

/** Type for the macro callback function */
export type MacroCallback = (callInfo: MacroCallInfo) => MacroExpansion;

/**
 * Create a JSON-based macro callback from a typed callback.
 * Wraps the callback to handle JSON serialization/deserialization.
 */
export function createMacroCallback(callback: MacroCallback): (json: string) => string {
  return (json: string): string => {
    const callInfo: MacroCallInfo = JSON.parse(json);
    const expansion = callback(callInfo);
    return JSON.stringify(expansion);
  };
}

/** Transform TypeScript source code with JS macro callbacks */
export declare function transformWithMacros(
  source: string,
  filename: string,
  options: TransformOptions | undefined | null,
  macroCallback: (json: string) => string
): TransformResult;
