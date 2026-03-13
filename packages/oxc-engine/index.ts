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
