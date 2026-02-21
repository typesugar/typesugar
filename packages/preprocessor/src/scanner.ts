/**
 * Scanner wrapper for typesugar preprocessor
 *
 * Wraps TypeScript's scanner and adds multi-character token merging for custom
 * operators like |>, ::, <|. Uses source-position adjacency (t2.start === t1.end)
 * to detect merged tokens.
 */

import * as ts from "typescript";

export interface Token {
  kind: ts.SyntaxKind;
  text: string;
  start: number;
  end: number;
  isCustomOperator?: boolean;
}

export interface CustomOperatorDef {
  symbol: string;
  chars: string[];
}

const DEFAULT_CUSTOM_OPERATORS: CustomOperatorDef[] = [
  { symbol: "|>", chars: ["|", ">"] },
  { symbol: "::", chars: [":", ":"] },
];

export interface ScannerOptions {
  customOperators?: CustomOperatorDef[];
  /**
   * File name used to determine JSX vs Standard language variant.
   * Files ending in .tsx or .jsx use JSX mode.
   */
  fileName?: string;
}

/**
 * Determine the language variant based on file extension.
 */
function getLanguageVariant(fileName?: string): ts.LanguageVariant {
  if (fileName) {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith(".tsx") || lowerName.endsWith(".jsx")) {
      return ts.LanguageVariant.JSX;
    }
  }
  return ts.LanguageVariant.Standard;
}

/**
 * Tokenize source code using TypeScript's scanner, then merge adjacent tokens
 * that form custom operators.
 */
export function tokenize(source: string, options: ScannerOptions = {}): Token[] {
  const customOperators = options.customOperators ?? DEFAULT_CUSTOM_OPERATORS;
  const languageVariant = getLanguageVariant(options.fileName);

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, source);

  const rawTokens: Token[] = [];

  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    const kind = scanner.getToken();
    const start = scanner.getTokenStart();
    const text = scanner.getTokenText();
    const end = start + text.length;

    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.NewLineTrivia) {
      rawTokens.push({ kind, text, start, end });
    }
  }

  return mergeCustomOperators(rawTokens, customOperators);
}

/**
 * Check if a token is inside a template literal string part (not an expression).
 * Template literals are tokenized as:
 * - TemplateHead: `text${  (starts template, ends at expression start)
 * - TemplateMiddle: }text${  (between expressions)
 * - TemplateTail: }text`  (ends template, starts after expression end)
 * - NoSubstitutionTemplateLiteral: `text`  (no expressions)
 *
 * The text between } and ${ in TemplateMiddle is part of the template string,
 * not code. We need to track when we're between a TemplateHead/TemplateMiddle
 * and the next CloseBraceToken to know we're in an expression context.
 */
function isTemplateStringToken(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.TemplateHead ||
    kind === ts.SyntaxKind.TemplateMiddle ||
    kind === ts.SyntaxKind.TemplateTail ||
    kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
  );
}

/**
 * Merge adjacent tokens that form custom operators.
 * Uses source-position adjacency: t2.start === t1.end
 *
 * IMPORTANT: Does not merge operators that appear immediately after a template
 * string part (TemplateHead, TemplateMiddle) because those are inside the
 * template literal's text, not in code.
 */
function mergeCustomOperators(tokens: Token[], customOperators: CustomOperatorDef[]): Token[] {
  const result: Token[] = [];
  let i = 0;

  // Track template literal depth to avoid merging operators inside template strings
  let templateDepth = 0;

  while (i < tokens.length) {
    const currentToken = tokens[i];

    // Track template literal context
    if (
      currentToken.kind === ts.SyntaxKind.TemplateHead ||
      currentToken.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      // Starting a new template literal
      if (currentToken.kind === ts.SyntaxKind.TemplateHead) {
        templateDepth++;
      }
      result.push(currentToken);
      i++;
      continue;
    }

    if (currentToken.kind === ts.SyntaxKind.TemplateTail) {
      // Ending a template literal
      templateDepth = Math.max(0, templateDepth - 1);
      result.push(currentToken);
      i++;
      continue;
    }

    // TemplateMiddle continues the template (doesn't change depth)
    if (currentToken.kind === ts.SyntaxKind.TemplateMiddle) {
      result.push(currentToken);
      i++;
      continue;
    }

    // Check if previous token was a template part that ends with }
    // If so, we're inside a template expression and should allow operator merging
    // But if the previous token was TemplateHead or TemplateMiddle, the next tokens
    // are inside the template expression (code), so we CAN merge operators there.
    //
    // The issue is when the scanner produces tokens like:
    // TemplateHead(`${), Identifier(mod), CloseBrace(}), Colon(:), Colon(:), ...
    // The :: after the } is actually part of the template string text, not code.
    //
    // However, TypeScript's scanner handles this correctly - after a CloseBrace
    // that ends a template expression, it rescans as template content and produces
    // TemplateMiddle or TemplateTail. So if we see adjacent : : tokens, they're
    // in code context, not template string context.
    //
    // Wait, let me reconsider. Looking at the test output:
    // TemplateHead(`${), Identifier(mod), CloseBrace(}), ::, ...
    // The :: is being created from adjacent : : tokens. But those : : tokens
    // should be part of the TemplateMiddle token, not separate tokens.
    //
    // The issue is that TypeScript's scanner in "scan" mode doesn't automatically
    // rescan template content after a }. We need to check if we're right after
    // a CloseBrace that follows a TemplateHead/TemplateMiddle context.

    // Skip merging if we're inside a template literal and just saw a CloseBrace
    // that could end a template expression (the next content should be template string)
    const prevToken = result.length > 0 ? result[result.length - 1] : null;
    const skipMerge = templateDepth > 0 && prevToken?.kind === ts.SyntaxKind.CloseBraceToken;

    let merged = false;

    if (!skipMerge) {
      for (const op of customOperators) {
        if (i + op.chars.length > tokens.length) continue;

        let matches = true;
        for (let j = 0; j < op.chars.length; j++) {
          const token = tokens[i + j];
          if (token.text !== op.chars[j]) {
            matches = false;
            break;
          }
          if (j > 0) {
            const prevToken = tokens[i + j - 1];
            if (token.start !== prevToken.end) {
              matches = false;
              break;
            }
          }
        }

        if (matches) {
          const firstToken = tokens[i];
          const lastToken = tokens[i + op.chars.length - 1];
          result.push({
            kind: ts.SyntaxKind.Unknown,
            text: op.symbol,
            start: firstToken.start,
            end: lastToken.end,
            isCustomOperator: true,
          });
          i += op.chars.length;
          merged = true;
          break;
        }
      }
    }

    if (!merged) {
      result.push(tokens[i]);
      i++;
    }
  }

  return result;
}

/**
 * Tokens that delimit expression boundaries for custom operator parsing.
 * This includes statement terminators, assignment operators, and declaration keywords.
 * Note: Open brackets are handled separately by bracket-depth tracking logic.
 */
const BOUNDARY_KINDS = new Set([
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.EqualsGreaterThanToken,
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.ThrowKeyword,
  ts.SyntaxKind.YieldKeyword,
  ts.SyntaxKind.CaseKeyword,
  ts.SyntaxKind.DefaultKeyword,
  ts.SyntaxKind.ConstKeyword,
  ts.SyntaxKind.LetKeyword,
  ts.SyntaxKind.VarKeyword,
]);

/**
 * Check if a token is a boundary token (expression delimiter).
 * Boundaries stop operand extraction for custom operators.
 */
export function isBoundaryToken(token: Token): boolean {
  if (BOUNDARY_KINDS.has(token.kind)) {
    return true;
  }

  if (token.kind === ts.SyntaxKind.ColonToken && !token.isCustomOperator) {
    return true;
  }

  return false;
}

/**
 * Check if a token is an opening bracket/brace/paren
 */
export function isOpenBracket(token: Token): boolean {
  return (
    token.kind === ts.SyntaxKind.OpenBraceToken ||
    token.kind === ts.SyntaxKind.OpenParenToken ||
    token.kind === ts.SyntaxKind.OpenBracketToken ||
    token.kind === ts.SyntaxKind.LessThanToken
  );
}

/**
 * Check if a token is a closing bracket/brace/paren
 */
export function isCloseBracket(token: Token): boolean {
  return (
    token.kind === ts.SyntaxKind.CloseBraceToken ||
    token.kind === ts.SyntaxKind.CloseParenToken ||
    token.kind === ts.SyntaxKind.CloseBracketToken ||
    token.kind === ts.SyntaxKind.GreaterThanToken
  );
}

/**
 * Get the matching close bracket for an open bracket
 */
export function getMatchingClose(openKind: ts.SyntaxKind): ts.SyntaxKind | null {
  switch (openKind) {
    case ts.SyntaxKind.OpenBraceToken:
      return ts.SyntaxKind.CloseBraceToken;
    case ts.SyntaxKind.OpenParenToken:
      return ts.SyntaxKind.CloseParenToken;
    case ts.SyntaxKind.OpenBracketToken:
      return ts.SyntaxKind.CloseBracketToken;
    case ts.SyntaxKind.LessThanToken:
      return ts.SyntaxKind.GreaterThanToken;
    default:
      return null;
  }
}
