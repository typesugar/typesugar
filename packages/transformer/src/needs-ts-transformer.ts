/**
 * Source-based heuristic for detecting files that need the TypeScript transformer.
 *
 * This module provides fast pattern detection to identify files using typeclass
 * features that require type-aware transformation. Files without these patterns
 * can potentially use a faster, simpler transformation (e.g., oxc).
 *
 * Detected patterns:
 * - `@op` - Operator syntax definitions in typeclass methods
 * - `@impl` - Typeclass instance declarations (auto-specialized)
 * - `@typeclass` - Typeclass definitions
 * - `@deriving` - Automatic typeclass derivation
 *
 * Note: @specialize is no longer used. Auto-specialization happens automatically
 * for all @impl instances where method bodies can be extracted from source.
 *
 * @see PEP-004 for design rationale
 */

/**
 * Result of the needs-transformer detection.
 */
export interface NeedsTransformerResult {
  /** Whether the file needs the TypeScript transformer */
  needsTs: boolean;
  /** Detected patterns that triggered the result */
  patterns: DetectedPattern[];
}

/**
 * A pattern detected in the source code.
 */
export interface DetectedPattern {
  /** The pattern type */
  type: "@op" | "@impl" | "@typeclass" | "@deriving";
  /** Approximate line number (1-indexed) */
  line: number;
  /** The matched text snippet (for debugging) */
  match: string;
}

/**
 * Regular expressions for detecting typeclass-related JSDoc patterns.
 *
 * These patterns look for JSDoc comments containing the annotations.
 * The patterns are designed to be fast and avoid false positives.
 *
 * Pattern structure: /\/\*\*(?:[^*]|\*(?!\/))*@TAG...(?:[^*]|\*(?!\/))*\*\//g
 * - `\/\*\*` - Start of JSDoc comment
 * - `(?:[^*]|\*(?!\/))` - Match any char except `*`, or `*` not followed by `/`
 *   This prevents matching across comment boundaries
 * - `\*\/` - End of JSDoc comment
 */
const PATTERNS = {
  // @op in JSDoc: /** @op + */ or /** @op === */ etc.
  // Matches: @op followed by operator(s) - operator can be +, -, *, /, ===, !==, <, >, <=, >= etc.
  op: /\/\*\*(?:[^*]|\*(?!\/))*@op\s+[^\s]+(?:[^*]|\*(?!\/))*\*\//g,

  // @impl in JSDoc: /** @impl Eq<Point> */ etc.
  // Matches: @impl followed by typeclass name
  // Note: All @impl instances are auto-specialized - no separate @specialize needed
  impl: /\/\*\*(?:[^*]|\*(?!\/))*@impl\s+\w+(?:[^*]|\*(?!\/))*\*\//g,

  // @typeclass in JSDoc: /** @typeclass */
  // Matches: @typeclass tag (typeclass definitions)
  typeclass: /\/\*\*(?:[^*]|\*(?!\/))*@typeclass(?:[^*]|\*(?!\/))*\*\//g,

  // @deriving in JSDoc: /** @deriving Eq, Ord */
  // Matches: @deriving followed by typeclass names
  deriving: /\/\*\*(?:[^*]|\*(?!\/))*@deriving\s+\w+(?:[^*]|\*(?!\/))*\*\//g,
};

/**
 * Detect if a source file needs the TypeScript transformer for typeclass features.
 *
 * This is a fast, text-based heuristic that scans for JSDoc patterns indicating
 * typeclass usage. Files with these patterns require type-aware transformation
 * and must use the TypeScript transformer.
 *
 * @param source - The source code content
 * @param options - Optional configuration
 * @returns Detection result with pattern details
 *
 * @example
 * ```typescript
 * const source = `
 *   /** @typeclass *\/
 *   interface Eq<A> {
 *     /** @op === *\/
 *     equals(a: A, b: A): boolean;
 *   }
 * `;
 *
 * const result = needsTypescriptTransformer(source);
 * // result.needsTs === true
 * // result.patterns includes @typeclass and @op
 * ```
 */
export function needsTypescriptTransformer(
  source: string,
  options?: { verbose?: boolean }
): NeedsTransformerResult {
  const patterns: DetectedPattern[] = [];

  // Helper to count line number from character offset
  const getLineNumber = (offset: number): number => {
    let line = 1;
    for (let i = 0; i < offset && i < source.length; i++) {
      if (source[i] === "\n") line++;
    }
    return line;
  };

  // Check each pattern type
  for (const [type, regex] of Object.entries(PATTERNS) as [keyof typeof PATTERNS, RegExp][]) {
    // Reset regex state for global matching
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(source)) !== null) {
      const line = getLineNumber(match.index);
      const matchText = match[0].slice(0, 50) + (match[0].length > 50 ? "..." : "");

      patterns.push({
        type: `@${type}` as DetectedPattern["type"],
        line,
        match: matchText,
      });

      if (options?.verbose) {
        console.log(`[needsTs] Found @${type} at line ${line}: ${matchText}`);
      }
    }
  }

  const needsTs = patterns.length > 0;

  if (options?.verbose && needsTs) {
    console.log(`[needsTs] File needs TypeScript transformer (${patterns.length} patterns found)`);
  }

  return { needsTs, patterns };
}

/**
 * Simple check for whether a file needs the TypeScript transformer.
 *
 * This is a fast path that just returns a boolean without pattern details.
 * Use `needsTypescriptTransformer()` if you need diagnostics about which
 * patterns were detected.
 *
 * @param source - The source code content
 * @returns true if the file needs the TypeScript transformer
 */
export function needsTs(source: string): boolean {
  // Fast path: check if any pattern exists without tracking details
  for (const regex of Object.values(PATTERNS)) {
    regex.lastIndex = 0;
    if (regex.test(source)) {
      return true;
    }
  }
  return false;
}
