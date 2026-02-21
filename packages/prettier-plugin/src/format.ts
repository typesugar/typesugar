/**
 * Full round-trip formatting for typesugar files
 *
 * Pipeline: preFormat → prettier.format → postFormat
 *
 * This produces correctly formatted code with custom syntax preserved.
 */

import prettier from "prettier";
import { preFormat, type FormatMetadata } from "./pre-format.js";
import { postFormat } from "./post-format.js";

/**
 * Options for the format function
 */
export interface FormatOptions {
  /** File path (used for JSX detection and Prettier config resolution) */
  filepath?: string;
  /** Additional Prettier options to pass through */
  prettierOptions?: prettier.Options;
}

/**
 * Format typesugar source code with custom syntax preservation.
 *
 * This is the main entry point for formatting typesugar files.
 * Unlike using Prettier directly with the plugin (which only does preFormat),
 * this function does the full round-trip:
 *
 * 1. preFormat: Convert custom syntax to valid TS
 * 2. prettier.format: Format the valid TS
 * 3. postFormat: Restore custom syntax
 *
 * @param source - Source code with custom syntax
 * @param options - Format options
 * @returns Formatted code with custom syntax preserved
 */
export async function format(source: string, options?: FormatOptions): Promise<string> {
  const filepath = options?.filepath;

  // Step 1: Pre-format (custom syntax → valid TS)
  const preResult = preFormat(source, { fileName: filepath });

  // If no transformations were needed, just run Prettier directly
  if (!preResult.changed) {
    return prettier.format(source, {
      parser: "typescript",
      filepath,
      ...options?.prettierOptions,
    });
  }

  // Step 2: Format with Prettier (using the standard TS parser, not our plugin)
  // We explicitly use "typescript" parser here because preFormat already did the preprocessing
  const prettierConfig = await prettier.resolveConfig(filepath ?? process.cwd());

  const formatted = await prettier.format(preResult.code, {
    ...prettierConfig,
    parser: "typescript",
    filepath,
    ...options?.prettierOptions,
  });

  // Step 3: Post-format (valid TS → custom syntax)
  const result = postFormat(formatted, preResult.metadata);

  return result;
}

/**
 * Check if a file would change when formatted.
 *
 * @param source - Source code
 * @param options - Format options
 * @returns true if the file needs formatting
 */
export async function check(source: string, options?: FormatOptions): Promise<boolean> {
  const formatted = await format(source, options);
  return formatted !== source;
}

/**
 * Get format metadata without formatting.
 * Useful for debugging or when you need to inspect what transformations would be applied.
 *
 * @param source - Source code with custom syntax
 * @param options - Format options
 * @returns Metadata about what transformations would be applied
 */
export function getFormatMetadata(source: string, options?: FormatOptions): FormatMetadata {
  const preResult = preFormat(source, { fileName: options?.filepath });
  return preResult.metadata;
}
