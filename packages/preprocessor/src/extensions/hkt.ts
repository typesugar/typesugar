/**
 * HKT syntax extension: F<_> → Kind<F, A> → Type<A> resolution pipeline
 *
 * This extension handles Higher-Kinded Type syntax in three layers:
 *
 * ## Layer 1: LEXICAL → INTERMEDIATE (F<_> declarations)
 *
 * Detects `F<_>` in type parameter lists and:
 * - Records the identifier as an HKT type parameter
 * - Removes the `<_>` marker from declarations
 * - Rewrites `F<A>` usages within scope to `Kind<F, A>`
 *
 * Example:
 * ```typescript
 * // Input (lexical syntax)
 * interface Functor<F<_>> {
 *   map<A, B>(fa: F<A>, f: (a: A) => B): F<B>;
 * }
 *
 * // Output (intermediate, valid TypeScript)
 * interface Functor<F> {
 *   map<A, B>(fa: Kind<F, A>, f: (a: A) => B): Kind<F, B>;
 * }
 * ```
 *
 * ## Layer 2: INTERMEDIATE → CONCRETE (Kind resolution)
 *
 * For known typesugar type functions (OptionF, EitherF, etc.):
 * - `Kind<OptionF, number>` → `Option<number>`
 * - `Kind<EitherF<string>, number>` → `Either<string, number>`
 * - `Kind<F, A>` (F is type param) → unchanged
 *
 * This resolution eliminates slow recursive type instantiation by replacing
 * phantom `Kind<F, A>` markers with concrete types at the preprocessor level.
 *
 * ## Safety Guarantees
 *
 * Resolution only happens when:
 * 1. `Kind` (or `$`) is imported from a typesugar package
 * 2. The type function (e.g., `OptionF`) is imported from a typesugar package
 * 3. The type function is NOT a type parameter from an enclosing `F<_>` declaration
 */

import * as ts from "typescript";
import type { SyntaxExtension, Replacement, RewriteOptions } from "./types.js";
import type { TokenStream } from "../token-stream.js";
import type { Token } from "../scanner.js";
import { scanImports, type TrackedImports } from "../import-tracker.js";

interface HKTDeclaration {
  param: string;
  removeStart: number;
  removeEnd: number;
  scopeStart: number;
  scopeEnd: number;
}

interface HKTUsage {
  param: string;
  /** Start position of the identifier */
  identStart: number;
  /** End position of the identifier (before <) */
  identEnd: number;
  /** Start position of the < token */
  lessThanStart: number;
  /** End position of the < token */
  lessThanEnd: number;
  /** Start position of the > token */
  greaterThanStart: number;
  /** End position of the > token */
  greaterThanEnd: number;
}

/**
 * Represents a parsed Kind<TypeF, A> or Kind<TypeF<E>, A> application.
 */
interface HKTApplication {
  /** Start position of the entire Kind<...> expression */
  start: number;
  /** End position of the entire Kind<...> expression */
  end: number;
  /** The type function name (e.g., "OptionF", "EitherF") */
  typeFunc: string;
  /** Fixed type arguments for parameterized type functions (e.g., ["E"] for EitherF<E>) */
  fixedArgs: string[];
  /** The varying type argument (the last argument to Kind<>) */
  varyingArg: string;
}

/**
 * HKT syntax extension
 *
 * Phase 0: Scan imports for typesugar HKT symbols
 * Phase 1: Scan for HKT declarations (F<_>) and record their scope
 * Phase 2: Scan for HKT usages (F<A>) within scope and record them
 * Phase 3: Generate replacements for F<_> declarations and F<A> usages
 * Phase 4: Resolve $<TypeF, A> → Type<A> for known typesugar type functions
 */
export const hktExtension: SyntaxExtension = {
  name: "hkt",

  rewrite(stream: TokenStream, source: string, options?: RewriteOptions): Replacement[] {
    const mode = options?.mode ?? "macro";
    const tokens = stream.getTokens();
    const declarations: HKTDeclaration[] = [];
    const usages: HKTUsage[] = [];

    // Phase 0: Scan imports to identify typesugar HKT symbols
    const imports = scanImports(source);

    // Phase 1: Find HKT declarations (F<_>)
    // Look for pattern: Identifier < (_ ,)* _ >
    for (let i = 0; i < tokens.length - 3; i++) {
      const t0 = tokens[i];
      const t1 = tokens[i + 1];

      if (t0.kind !== ts.SyntaxKind.Identifier) continue;
      if (!/^[A-Z]/.test(t0.text)) continue;

      const lessThanValue = ts.SyntaxKind.LessThanToken as number;
      if ((t1.kind as number) !== lessThanValue) continue;

      let j = i + 2;
      let expectUnderscore = true;
      let isHKT = false;
      let endToken: Token | null = null;

      while (j < tokens.length) {
        const t = tokens[j];

        if (expectUnderscore) {
          if (t.kind === ts.SyntaxKind.Identifier && t.text === "_") {
            expectUnderscore = false;
            j++;
          } else {
            break;
          }
        } else {
          if (t.kind === ts.SyntaxKind.CommaToken) {
            expectUnderscore = true;
            j++;
          } else if (t.kind === ts.SyntaxKind.GreaterThanToken) {
            isHKT = true;
            endToken = t;
            break;
          } else {
            break;
          }
        }
      }

      if (isHKT && endToken) {
        const scope = findEnclosingScope(tokens, i);
        declarations.push({
          param: t0.text,
          removeStart: t1.start,
          removeEnd: endToken.end,
          scopeStart: scope.start,
          scopeEnd: scope.end,
        });
      }
    }

    // Phase 2 and 3 only run if there are F<_> declarations
    // But we still need to run Phase 4 for $<TypeF, A> resolution
    const replacements: Replacement[] = [];

    if (declarations.length > 0) {
      // Phase 2: Find HKT usages (F<A>) within scope of each declaration
      for (let i = 0; i < tokens.length - 2; i++) {
        const t0 = tokens[i];
        const t1 = tokens[i + 1];

        if (t0.kind !== ts.SyntaxKind.Identifier) continue;

        const lessThanValue = ts.SyntaxKind.LessThanToken as number;
        if ((t1.kind as number) !== lessThanValue) continue;

        const decl = findActiveDeclaration(declarations, t0.text, t0.start);
        if (!decl) continue;

        const genericEnd = findMatchingGreaterThan(tokens, i + 1);
        if (genericEnd === -1) continue;

        const innerTokens = tokens.slice(i + 2, genericEnd);
        const hasOnlyUnderscores = innerTokens.every(
          (t) =>
            (t.kind === ts.SyntaxKind.Identifier && t.text === "_") ||
            t.kind === ts.SyntaxKind.CommaToken
        );
        if (hasOnlyUnderscores) continue;

        const greaterThanToken = tokens[genericEnd];
        usages.push({
          param: t0.text,
          identStart: t0.start,
          identEnd: t0.end,
          lessThanStart: t1.start,
          lessThanEnd: t1.end,
          greaterThanStart: greaterThanToken.start,
          greaterThanEnd: greaterThanToken.end,
        });
      }

      // Phase 3: Generate replacements
      // Handle nested HKT usages by composing them into single replacements

      for (const decl of declarations) {
        replacements.push({
          start: decl.removeStart,
          end: decl.removeEnd,
          // In format mode, emit a marker comment so postFormat can reverse the transformation
          // In macro mode, just remove the <_> entirely
          text: mode === "format" ? " /*@ts:hkt*/" : "",
        });
      }

      // Sort usages by span size (smallest first) so we process inner usages first
      const sortedUsages = [...usages].sort((a, b) => {
        const spanA = a.greaterThanEnd - a.identStart;
        const spanB = b.greaterThanEnd - b.identStart;
        return spanA - spanB;
      });

      // Build a map of position -> rewritten text for nested composition
      // Key: "start:end" of the original span
      const rewrittenSpans = new Map<string, string>();

      for (const usage of sortedUsages) {
        // Extract args from token positions
        let args = source.slice(usage.lessThanEnd, usage.greaterThanStart);

        // Check if any inner usages fall within this args range and substitute
        for (const [spanKey, rewrittenText] of rewrittenSpans) {
          const [startStr, endStr] = spanKey.split(":");
          const innerStart = parseInt(startStr, 10);
          const innerEnd = parseInt(endStr, 10);

          // If inner span is within our args range, substitute it
          if (innerStart >= usage.lessThanEnd && innerEnd <= usage.greaterThanStart) {
            const originalInner = source.slice(innerStart, innerEnd);
            args = args.replace(originalInner, rewrittenText);
          }
        }

        const rewrittenText = `Kind<${usage.param}, ${args}>`;
        const spanKey = `${usage.identStart}:${usage.greaterThanEnd}`;
        rewrittenSpans.set(spanKey, rewrittenText);
      }

      // Only emit replacements for outermost usages (those not contained in another)
      for (const usage of sortedUsages) {
        const isNested = sortedUsages.some(
          (other) =>
            other !== usage &&
            other.identStart <= usage.identStart &&
            other.greaterThanEnd >= usage.greaterThanEnd
        );

        if (!isNested) {
          const spanKey = `${usage.identStart}:${usage.greaterThanEnd}`;
          replacements.push({
            start: usage.identStart,
            end: usage.greaterThanEnd,
            text: rewrittenSpans.get(spanKey)!,
          });
        }
      }
    }

    // Phase 4: Resolve Kind<TypeF, A> → Type<A> for known typesugar type functions
    // Only proceed if Kind (or $) is imported from a typesugar package
    if (imports.hktOperator && mode === "macro") {
      const hktApplications = findHKTApplications(tokens, source, imports, declarations);

      // Map from position span to { original, resolved } for nested substitution
      // We need both to handle multi-level nesting where intermediate forms differ
      const resolvedSpans = new Map<string, { original: string; resolved: string }>();

      // Process innermost first (already sorted by span size)
      for (const app of hktApplications) {
        const tfInfo = imports.typeFunctions.get(app.typeFunc);
        if (!tfInfo) continue;

        // Build the resolved type using the local concrete name if available
        const concreteName = tfInfo.localConcrete ?? tfInfo.concrete;

        // Substitute any already-resolved inner spans in the args
        let resolvedFixedArgs = [...app.fixedArgs];
        let resolvedVaryingArg = app.varyingArg;

        // Apply substitutions in reverse order (larger spans first)
        // This ensures we substitute containing spans before contained spans
        // to avoid text mismatches from partial substitutions
        const sortedSpans = [...resolvedSpans.entries()].sort((a, b) => {
          const [aKey] = a;
          const [bKey] = b;
          const [aStart, aEnd] = aKey.split(":").map(Number);
          const [bStart, bEnd] = bKey.split(":").map(Number);
          const aSize = aEnd - aStart;
          const bSize = bEnd - bStart;
          return bSize - aSize; // Larger spans first
        });

        for (const [, spanInfo] of sortedSpans) {
          // Check if original form appears in fixed args
          for (let i = 0; i < resolvedFixedArgs.length; i++) {
            if (resolvedFixedArgs[i].includes(spanInfo.original)) {
              resolvedFixedArgs[i] = resolvedFixedArgs[i].replace(
                spanInfo.original,
                spanInfo.resolved
              );
            }
          }

          // Check if original form appears in varying arg
          if (resolvedVaryingArg.includes(spanInfo.original)) {
            resolvedVaryingArg = resolvedVaryingArg.replace(spanInfo.original, spanInfo.resolved);
          }
        }

        const allArgs = [...resolvedFixedArgs, resolvedVaryingArg];
        const resolvedType = `${concreteName}<${allArgs.join(", ")}>`;

        // Record this resolution for nested substitution
        const spanKey = `${app.start}:${app.end}`;
        const originalText = source.slice(app.start, app.end);
        resolvedSpans.set(spanKey, { original: originalText, resolved: resolvedType });
      }

      // Emit replacements for all resolved applications (outermost only to avoid overlap)
      const sortedByPosition = [...hktApplications].sort((a, b) => a.start - b.start);

      for (const app of sortedByPosition) {
        const spanKey = `${app.start}:${app.end}`;
        const spanInfo = resolvedSpans.get(spanKey);
        if (!spanInfo) continue;

        // Check if this is contained within another application
        const isNested = sortedByPosition.some(
          (other) => other !== app && other.start < app.start && other.end > app.end
        );

        if (!isNested) {
          replacements.push({
            start: app.start,
            end: app.end,
            text: spanInfo.resolved,
          });
        }
      }
    }

    return replacements;
  },
};

/**
 * Find the enclosing scope for a type parameter declaration.
 * Returns the start and end positions of the scope.
 *
 * This handles:
 * - Block scopes: interface/class/function bodies with { }
 * - Braceless arrow functions: const f = <F<_>>(fa: F<A>): F<B> => fa;
 * - Type aliases: type Apply<F<_>, A> = F<A>;
 */
function findEnclosingScope(
  tokens: readonly Token[],
  paramIndex: number
): { start: number; end: number } {
  let braceDepth = 0;
  let scopeStart = 0;

  // Scan backwards to find scope start
  for (let i = paramIndex - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.kind === ts.SyntaxKind.CloseBraceToken) {
      braceDepth++;
    } else if (t.kind === ts.SyntaxKind.OpenBraceToken) {
      if (braceDepth > 0) {
        braceDepth--;
      } else {
        scopeStart = t.start;
        break;
      }
    }
  }

  // Scan forwards to find scope end
  braceDepth = 0;
  let parenDepth = 0;
  let scopeEnd = tokens[tokens.length - 1]?.end ?? 0;
  let foundOpenBrace = false;

  for (let i = paramIndex; i < tokens.length; i++) {
    const t = tokens[i];

    // Track brace depth
    if (t.kind === ts.SyntaxKind.OpenBraceToken) {
      braceDepth++;
      foundOpenBrace = true;
    } else if (t.kind === ts.SyntaxKind.CloseBraceToken) {
      if (braceDepth > 0) {
        braceDepth--;
        if (braceDepth === 0) {
          scopeEnd = t.end;
          break;
        }
      } else {
        // Closing brace at depth 0 without matching open - end of outer scope
        scopeEnd = t.end;
        break;
      }
    }

    // Track paren depth (for function signatures)
    if (t.kind === ts.SyntaxKind.OpenParenToken) {
      parenDepth++;
    } else if (t.kind === ts.SyntaxKind.CloseParenToken) {
      if (parenDepth > 0) {
        parenDepth--;
      }
    }

    // For braceless constructs, also stop at:
    if (!foundOpenBrace && braceDepth === 0) {
      // Semicolon at depth 0 ends the statement
      if (t.kind === ts.SyntaxKind.SemicolonToken && parenDepth === 0) {
        scopeEnd = t.end;
        break;
      }
    }
  }

  return { start: scopeStart, end: scopeEnd };
}

/**
 * Find the active HKT declaration for a given parameter name and position.
 * Handles shadowing by returning the innermost declaration.
 */
function findActiveDeclaration(
  declarations: HKTDeclaration[],
  paramName: string,
  position: number
): HKTDeclaration | null {
  let best: HKTDeclaration | null = null;
  let bestSize = Infinity;

  for (const decl of declarations) {
    if (decl.param !== paramName) continue;
    if (position < decl.scopeStart || position > decl.scopeEnd) continue;

    const size = decl.scopeEnd - decl.scopeStart;
    if (size < bestSize) {
      best = decl;
      bestSize = size;
    }
  }

  return best;
}

/**
 * Find the matching > for a < at the given index.
 * Handles nested generics.
 */
function findMatchingGreaterThan(tokens: readonly Token[], lessThanIndex: number): number {
  const lessThanValue = ts.SyntaxKind.LessThanToken as number;
  const greaterThanValue = ts.SyntaxKind.GreaterThanToken as number;

  let depth = 1;
  for (let i = lessThanIndex + 1; i < tokens.length; i++) {
    const kind = tokens[i].kind as number;
    if (kind === lessThanValue) {
      depth++;
    } else if (kind === greaterThanValue) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Find all Kind<TypeF, A> or $<TypeF, A> applications in the token stream.
 *
 * This function identifies HKT applications that can be resolved to concrete types.
 * It handles:
 * - Simple applications: Kind<OptionF, number>
 * - Parameterized type functions: Kind<EitherF<string>, number>
 * - Nested applications: Kind<OptionF, Kind<ListF, number>>
 *
 * @param tokens - The token stream
 * @param source - The source code
 * @param imports - Tracked imports from typesugar packages
 * @param declarations - HKT declarations (F<_>) that should NOT be resolved
 * @returns Array of HKT applications that can be resolved
 */
function findHKTApplications(
  tokens: readonly Token[],
  source: string,
  imports: TrackedImports,
  declarations: HKTDeclaration[]
): HKTApplication[] {
  const applications: HKTApplication[] = [];
  const hktOp = imports.hktOperator;

  if (!hktOp) return applications;

  const lessThanValue = ts.SyntaxKind.LessThanToken as number;

  for (let i = 0; i < tokens.length - 4; i++) {
    const t0 = tokens[i];

    // Check for the HKT operator ($ or Kind or aliased name)
    if (t0.kind !== ts.SyntaxKind.Identifier) continue;
    if (t0.text !== hktOp) continue;

    const t1 = tokens[i + 1];
    if ((t1.kind as number) !== lessThanValue) continue;

    // Find the matching > for the outer $<...>
    const outerCloseIdx = findMatchingGreaterThan(tokens, i + 1);
    if (outerCloseIdx === -1) continue;

    // Extract the type function identifier
    const t2 = tokens[i + 2];
    if (t2.kind !== ts.SyntaxKind.Identifier) continue;

    const typeFuncName = t2.text;

    // Check if this type function is tracked from typesugar imports
    const tfInfo = imports.typeFunctions.get(typeFuncName);
    if (!tfInfo) continue;

    // Check if this is an unbound type parameter from an F<_> declaration
    // If so, don't resolve it (it's a generic parameter, not a concrete type function)
    const activeDecl = findActiveDeclaration(declarations, typeFuncName, t2.start);
    if (activeDecl) continue;

    // Parse the HKT application structure
    const parsed = parseHKTApplication(tokens, source, i, outerCloseIdx, tfInfo.isParameterized);
    if (parsed) {
      applications.push(parsed);
    }
  }

  // Sort by span size (smallest = innermost first)
  // When we have $<OptionF, $<ListF, number>>, we want to resolve inner first
  applications.sort((a, b) => {
    const sizeA = a.end - a.start;
    const sizeB = b.end - b.start;
    return sizeA - sizeB;
  });

  // Return ALL applications - nested substitution is handled in Phase 4
  return applications;
}

/**
 * Parse a single HKT application at the given position.
 *
 * Handles:
 * - Kind<OptionF, number> → { typeFunc: "OptionF", fixedArgs: [], varyingArg: "number" }
 * - Kind<EitherF<string>, number> → { typeFunc: "EitherF", fixedArgs: ["string"], varyingArg: "number" }
 *
 * @param tokens - The token stream
 * @param source - The source code
 * @param startIdx - Token index of the Kind (or $) identifier
 * @param closeIdx - Token index of the closing >
 * @param isParameterized - Whether the type function takes fixed parameters
 * @returns Parsed HKT application or null if parsing fails
 */
function parseHKTApplication(
  tokens: readonly Token[],
  source: string,
  startIdx: number,
  closeIdx: number,
  isParameterized: boolean
): HKTApplication | null {
  const t0 = tokens[startIdx]; // $
  const t2 = tokens[startIdx + 2]; // TypeF

  const lessThanValue = ts.SyntaxKind.LessThanToken as number;
  const greaterThanValue = ts.SyntaxKind.GreaterThanToken as number;
  const commaValue = ts.SyntaxKind.CommaToken as number;

  const start = t0.start;
  const end = tokens[closeIdx].end;
  const typeFunc = t2.text;

  // Find the position right after the type function name
  let parseIdx = startIdx + 3;
  const fixedArgs: string[] = [];

  // If parameterized, check for TypeF<...> syntax
  if (isParameterized && parseIdx < closeIdx) {
    const nextToken = tokens[parseIdx];
    if ((nextToken.kind as number) === lessThanValue) {
      // Find the matching > for the type function's parameters
      const innerCloseIdx = findMatchingGreaterThan(tokens, parseIdx);
      if (innerCloseIdx !== -1 && innerCloseIdx < closeIdx) {
        // Extract the fixed args (everything between < and >)
        const innerArgsStart = nextToken.end;
        const innerArgsEnd = tokens[innerCloseIdx].start;
        const innerArgsText = source.slice(innerArgsStart, innerArgsEnd).trim();

        // Split by comma at depth 0 to handle nested generics
        const splitArgs = splitByCommaAtDepth0(innerArgsText);
        fixedArgs.push(...splitArgs);

        parseIdx = innerCloseIdx + 1;
      }
    }
  }

  // Now we should be at a comma separating type function from varying arg
  if (parseIdx >= closeIdx) return null;

  const commaToken = tokens[parseIdx];
  if ((commaToken.kind as number) !== commaValue) {
    // No comma found - might be malformed
    return null;
  }

  // The varying arg is everything between the comma and the closing >
  const varyingArgStart = commaToken.end;
  const varyingArgEnd = tokens[closeIdx].start;
  const varyingArg = source.slice(varyingArgStart, varyingArgEnd).trim();

  if (!varyingArg) return null;

  return {
    start,
    end,
    typeFunc,
    fixedArgs,
    varyingArg,
  };
}

/**
 * Split a string by commas at depth 0 (not inside <> or other brackets).
 */
function splitByCommaAtDepth0(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of text) {
    if (char === "<" || char === "(" || char === "[" || char === "{") {
      depth++;
      current += char;
    } else if (char === ">" || char === ")" || char === "]" || char === "}") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

export default hktExtension;
