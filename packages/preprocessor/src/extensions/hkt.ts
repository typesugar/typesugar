/**
 * HKT syntax extension: F<_> to $<F, A> rewriting
 *
 * This extension handles Higher-Kinded Type syntax:
 * - Detects F<_> in type parameter lists and records the identifier as an HKT param
 * - Rewrites F<A> usages within scope to $<F, A>
 * - Tracks scope to handle shadowing correctly
 *
 * Example input:
 *   interface MapLike<F<_>, K> extends IterableOnce<F> {
 *     readonly get: <V>(fa: F<V>, key: K) => V | undefined;
 *   }
 *
 * Example output:
 *   interface MapLike<F, K> extends IterableOnce<F> {
 *     readonly get: <V>(fa: $<F, V>, key: K) => V | undefined;
 *   }
 */

import * as ts from "typescript";
import type { SyntaxExtension, Replacement, RewriteOptions } from "./types.js";
import type { TokenStream } from "../token-stream.js";
import type { Token } from "../scanner.js";

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
 * HKT syntax extension
 *
 * Phase 1: Scan for HKT declarations (F<_>) and record their scope
 * Phase 2: Scan for HKT usages (F<A>) within scope and record them
 * Phase 3: Generate replacements
 */
export const hktExtension: SyntaxExtension = {
  name: "hkt",

  rewrite(stream: TokenStream, source: string, options?: RewriteOptions): Replacement[] {
    const mode = options?.mode ?? "macro";
    const tokens = stream.getTokens();
    const declarations: HKTDeclaration[] = [];
    const usages: HKTUsage[] = [];

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

    if (declarations.length === 0) {
      return [];
    }

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
    const replacements: Replacement[] = [];

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

      const rewrittenText = `$<${usage.param}, ${args}>`;
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

export default hktExtension;
