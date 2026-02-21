/**
 * Extension interfaces for the preprocessor
 */

import type { Token } from "../scanner.js";
import type { TokenStream } from "../token-stream.js";

/**
 * Represents a text replacement in the source
 */
export interface Replacement {
  start: number;
  end: number;
  text: string;
}

/**
 * Standard source map v3 format (VLQ-encoded)
 */
export interface RawSourceMap {
  version: 3;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

/**
 * Result of preprocessing a source file
 */
export interface PreprocessResult {
  code: string;
  changed: boolean;
  /** Standard VLQ-encoded source map (v3 format), or null if no changes */
  map: RawSourceMap | null;
}

/**
 * Options passed to syntax extension rewrite methods
 */
export interface RewriteOptions {
  /**
   * "macro" (default) for compilation -- produces valid TS for macro processing
   * "format" for prettier round-tripping -- produces markers that can be reversed
   */
  mode?: "macro" | "format";
}

/**
 * Base interface for non-operator syntax extensions (e.g., HKT)
 */
export interface SyntaxExtension {
  name: string;

  /**
   * Optional: Merge adjacent base tokens into custom tokens.
   * Called before rewrite().
   */
  mergeTokens?(tokens: Token[]): Token[];

  /**
   * Rewrite patterns in the token stream.
   * Returns replacements to apply to the source text.
   */
  rewrite(stream: TokenStream, source: string, options?: RewriteOptions): Replacement[];
}

/**
 * Extension interface for custom operators like |>, ::
 *
 * Custom operators are processed separately from SyntaxExtensions --
 * they use iterative operator rewriting in preprocess.ts rather than
 * the generic rewrite() method.
 */
export interface CustomOperatorExtension {
  name: string;
  symbol: string;
  precedence: number;
  associativity: "left" | "right";

  /**
   * Transform the left and right operand source text.
   * Returns the replacement text for the entire expression.
   */
  transform(left: string, right: string): string;
}

/**
 * Type guard for CustomOperatorExtension
 */
export function isCustomOperatorExtension(
  ext: SyntaxExtension | CustomOperatorExtension
): ext is CustomOperatorExtension {
  return "symbol" in ext && "precedence" in ext && "associativity" in ext && "transform" in ext;
}
