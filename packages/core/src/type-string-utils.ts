/**
 * Pure string utilities for parsing type-like strings with angle brackets.
 *
 * These operate on stringified type representations (from typeToString(),
 * JSDoc comments, etc.) — NOT on AST nodes. No TypeScript dependency.
 */

// =============================================================================
// extractTypeArgumentsContent
// =============================================================================

/**
 * Extract the full content between the outermost angle brackets in a string.
 * Returns everything inside, including commas and nested brackets.
 * Handles nested generics correctly by counting bracket depth.
 *
 * @example
 * extractTypeArgumentsContent("Impl<number>")                    // "number"
 * extractTypeArgumentsContent("Impl<Map<string, number>>")       // "Map<string, number>"
 * extractTypeArgumentsContent("Impl<Either<Option<A>, B>>")      // "Either<Option<A>, B>"
 * extractTypeArgumentsContent("Map<string, string>")             // "string, string"
 * extractTypeArgumentsContent("no brackets")                     // undefined
 */
export function extractTypeArgumentsContent(text: string): string | undefined {
  const openBracket = text.indexOf("<");
  if (openBracket === -1) return undefined;
  const closeBracket = findMatchingCloseBracket(text, openBracket);
  if (closeBracket === -1) return undefined;
  return text.slice(openBracket + 1, closeBracket).trim();
}

// =============================================================================
// stripTypeArguments
// =============================================================================

/**
 * Return the base type name with any angle-bracket suffix removed.
 * Handles nested generics correctly.
 *
 * @example
 * stripTypeArguments("Map<string, number>")        // "Map"
 * stripTypeArguments("Option<A>")                  // "Option"
 * stripTypeArguments("Either<Option<A>, B>")       // "Either"
 * stripTypeArguments("number")                     // "number"
 */
export function stripTypeArguments(text: string): string {
  const openBracket = text.indexOf("<");
  if (openBracket === -1) return text;
  return text.slice(0, openBracket).trim();
}

// =============================================================================
// splitTopLevelTypeArgs
// =============================================================================

/**
 * Split comma-separated type arguments, respecting nested angle brackets.
 * Input should be the content between `<` and `>` (i.e., without the outer brackets).
 *
 * @example
 * splitTopLevelTypeArgs("string, number")              // ["string", "number"]
 * splitTopLevelTypeArgs("Map<string, number>, B")      // ["Map<string, number>", "B"]
 * splitTopLevelTypeArgs("A")                           // ["A"]
 */
export function splitTopLevelTypeArgs(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "<") depth++;
    else if (text[i] === ">") depth--;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

// =============================================================================
// parseTypeInstantiation
// =============================================================================

/**
 * Parse a type instantiation string like "Numeric<Expression<number>>"
 * into its base name and inner content.
 *
 * @example
 * parseTypeInstantiation("Show<number>")                    // { base: "Show", args: "number" }
 * parseTypeInstantiation("Numeric<Expression<number>>")     // { base: "Numeric", args: "Expression<number>" }
 * parseTypeInstantiation("number")                          // undefined
 */
export function parseTypeInstantiation(text: string): { base: string; args: string } | undefined {
  const openBracket = text.indexOf("<");
  if (openBracket === -1) return undefined;
  const base = text.slice(0, openBracket).trim();
  if (!base) return undefined;
  const closeBracket = findMatchingCloseBracket(text, openBracket);
  if (closeBracket === -1) return undefined;
  return { base, args: text.slice(openBracket + 1, closeBracket).trim() };
}

// =============================================================================
// findMatchingCloseBracket (internal)
// =============================================================================

/**
 * Find the matching `>` for the `<` at position `openIndex`, counting depth.
 * Returns -1 if no matching bracket is found.
 */
function findMatchingCloseBracket(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "<") depth++;
    else if (text[i] === ">") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
