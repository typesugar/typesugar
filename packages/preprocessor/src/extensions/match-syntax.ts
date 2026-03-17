/**
 * Match syntax extension for preprocessor (.sts files)
 *
 * Transforms Scala-style pattern matching syntax:
 *
 *   match(expr)
 *   | [first, _, _] if first > 0 => first
 *   | [_, second, _] => second
 *   | _ => 0
 *
 * Into fluent macro syntax:
 *
 *   match(expr)
 *     .case([first, _, _]).if(first > 0).then(first)
 *     .case([_, second, _]).then(second)
 *     .else(0)
 *
 * Pattern transformations:
 * - Type patterns:  `s: string`      → `.case(String(s))`
 * - AS patterns:    `p @ [x, y]`     → `.case([x, y]).as(p)`
 * - OR patterns:    `200 | 201`      → `.case(200).or(201)`
 * - Regex + as:     `/re/ as [_, g]` → `.case(/re/).as([_, g])`
 * - Wildcard last:  `_ => val`       → `.else(val)`
 */

import * as ts from "typescript";
import type { SyntaxExtension, Replacement, RewriteOptions } from "./types.js";
import type { TokenStream } from "../token-stream.js";
import type { Token } from "../scanner.js";

interface MatchArm {
  /** Source position of the leading `|` */
  pipeStart: number;
  /** Raw pattern text (between `|` and `if`/`=>`) */
  patternText: string;
  /** Raw guard text (between `if` and `=>`), or null */
  guardText: string | null;
  /** Raw result expression text (after `=>`) */
  resultText: string;
  /** Source position at the end of the result expression */
  armEnd: number;
}

interface MatchBlock {
  /** Position right after the `)` of match(expr) */
  closeParenEnd: number;
  /** All parsed arms */
  arms: MatchArm[];
  /** Position at the end of the entire match block */
  blockEnd: number;
}

const PRIMITIVE_TYPE_CONSTRUCTORS: Record<string, string> = {
  string: "String",
  number: "Number",
  boolean: "Boolean",
  bigint: "BigInt",
  symbol: "Symbol",
};

interface PatternTransform {
  caseArg: string;
  asArg?: string;
  orArgs?: string[];
}

export const matchSyntaxExtension: SyntaxExtension = {
  name: "match-syntax",

  rewrite(stream: TokenStream, source: string, _options?: RewriteOptions): Replacement[] {
    const tokens = stream.getTokens();
    const replacements: Replacement[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < tokens.length; i++) {
      if (processed.has(i)) continue;

      const matchBlock = tryParseMatchBlock(tokens, i, source);
      if (!matchBlock) continue;

      const replacement = transformMatchBlock(matchBlock, source);
      replacements.push(replacement);

      // Mark tokens in this range as processed to avoid re-parsing
      for (let j = i; j < tokens.length; j++) {
        if (tokens[j].start >= matchBlock.blockEnd) break;
        processed.add(j);
      }
    }

    return replacements;
  },
};

/**
 * Try to parse a match block starting at token index `i`.
 * Returns null if the token at `i` is not `match` or doesn't have
 * the preprocessor syntax (| arms after the closing paren).
 */
function tryParseMatchBlock(
  tokens: readonly Token[],
  startIdx: number,
  source: string
): MatchBlock | null {
  const tok = tokens[startIdx];
  if (tok.kind !== ts.SyntaxKind.Identifier || tok.text !== "match") return null;

  // Exclude method calls like str.match() — preceding token must not be `.`
  if (startIdx > 0 && tokens[startIdx - 1].kind === ts.SyntaxKind.DotToken) return null;

  // Next token must be `(`
  const openParenIdx = startIdx + 1;
  if (openParenIdx >= tokens.length) return null;
  if (tokens[openParenIdx].kind !== ts.SyntaxKind.OpenParenToken) return null;

  // Find matching `)`
  const closeParenIdx = findMatchingParen(tokens, openParenIdx);
  if (closeParenIdx === -1) return null;

  const closeParenEnd = tokens[closeParenIdx].end;

  // Check if the next token after `)` is `|` preceded by a newline
  const nextIdx = closeParenIdx + 1;
  if (nextIdx >= tokens.length) return null;

  const nextTok = tokens[nextIdx];
  if (nextTok.kind !== ts.SyntaxKind.BarToken) return null;

  if (!hasNewlineBetween(source, closeParenEnd, nextTok.start)) return null;

  // We're in a match block — collect arms
  const arms = collectArms(tokens, nextIdx, source);
  if (arms.length === 0) return null;

  const blockEnd = arms[arms.length - 1].armEnd;

  return { closeParenEnd, arms, blockEnd };
}

/**
 * Collect all match arms starting from the first `|` token.
 *
 * Arms are delimited by `|` tokens that are preceded by a newline in the source.
 * Within an arm, `|` without a preceding newline is an OR pattern separator.
 */
function collectArms(tokens: readonly Token[], firstPipeIdx: number, source: string): MatchArm[] {
  // Determine the upper bound of the match block using the last-arm termination heuristic
  const blockEndIdx = findLastArmEnd(tokens, firstPipeIdx, source);

  // Find all line-starting `|` tokens within the match block
  const armStartIndices: number[] = [firstPipeIdx];

  for (let i = firstPipeIdx + 1; i <= blockEndIdx; i++) {
    const tok = tokens[i];
    if (tok.kind !== ts.SyntaxKind.BarToken) continue;

    // Check if preceded by a newline
    const prevEnd = tokens[i - 1].end;
    if (!hasNewlineBetween(source, prevEnd, tok.start)) continue;

    armStartIndices.push(i);
  }

  const arms: MatchArm[] = [];

  for (let a = 0; a < armStartIndices.length; a++) {
    const pipeIdx = armStartIndices[a];
    const isLast = a === armStartIndices.length - 1;

    // Determine the token range for this arm
    const armTokenStart = pipeIdx + 1; // skip the `|`
    let armTokenEnd: number;

    if (!isLast) {
      armTokenEnd = armStartIndices[a + 1] - 1;
    } else {
      armTokenEnd = findLastArmEnd(tokens, pipeIdx, source);
    }

    if (armTokenStart > armTokenEnd) continue;

    const arm = parseArm(tokens, pipeIdx, armTokenStart, armTokenEnd, source);
    if (arm) arms.push(arm);
  }

  return arms;
}

/**
 * Parse a single match arm from its tokens.
 *
 * Structure: | pattern (if guard)? => result
 */
function parseArm(
  tokens: readonly Token[],
  pipeIdx: number,
  startIdx: number,
  endIdx: number,
  source: string
): MatchArm | null {
  // Find `=>` at bracket depth 0 within the arm
  const arrowIdx = findFatArrowAtDepth0(tokens, startIdx, endIdx);
  if (arrowIdx === -1) return null;

  // Find optional `if` guard at depth 0 before the `=>`
  const ifIdx = findIfAtDepth0(tokens, startIdx, arrowIdx);

  let patternText: string;
  let guardText: string | null = null;

  if (ifIdx !== -1) {
    // Pattern is from startIdx to just before `if`
    patternText = extractSourceRange(tokens, startIdx, ifIdx - 1, source);
    // Guard is from after `if` to just before `=>`
    guardText = extractSourceRange(tokens, ifIdx + 1, arrowIdx - 1, source);
  } else {
    // Pattern is from startIdx to just before `=>`
    patternText = extractSourceRange(tokens, startIdx, arrowIdx - 1, source);
  }

  // Result is from after `=>` to endIdx
  const resultText = extractSourceRange(tokens, arrowIdx + 1, endIdx, source);

  return {
    pipeStart: tokens[pipeIdx].start,
    patternText,
    guardText,
    resultText,
    armEnd: tokens[endIdx].end,
  };
}

/**
 * Find the end token index for the last arm's result expression.
 */
function findLastArmEnd(tokens: readonly Token[], pipeIdx: number, source: string): number {
  let depth = 0;
  let lastValidIdx = pipeIdx;

  for (let i = pipeIdx + 1; i < tokens.length; i++) {
    const tok = tokens[i];

    if (
      tok.kind === ts.SyntaxKind.OpenParenToken ||
      tok.kind === ts.SyntaxKind.OpenBraceToken ||
      tok.kind === ts.SyntaxKind.OpenBracketToken
    ) {
      depth++;
      lastValidIdx = i;
      continue;
    }

    if (
      tok.kind === ts.SyntaxKind.CloseParenToken ||
      tok.kind === ts.SyntaxKind.CloseBraceToken ||
      tok.kind === ts.SyntaxKind.CloseBracketToken
    ) {
      if (depth > 0) {
        depth--;
        lastValidIdx = i;
        continue;
      }
      // Closing bracket at depth 0 belongs to outer context
      return lastValidIdx;
    }

    if (tok.kind === ts.SyntaxKind.SemicolonToken && depth === 0) {
      // Semicolon ends the match expression — don't include the semicolon
      return lastValidIdx;
    }

    if (depth === 0 && i > pipeIdx + 1) {
      const prevEnd = tokens[i - 1].end;
      if (hasNewlineBetween(source, prevEnd, tok.start) && isStatementKeyword(tok)) {
        return lastValidIdx;
      }
    }

    lastValidIdx = i;
  }

  return lastValidIdx;
}

/**
 * Transform a parsed match block into a Replacement that rewrites
 * the `| pattern => expr` arms into `.case().then()` fluent chains.
 */
function transformMatchBlock(block: MatchBlock, source: string): Replacement {
  const parts: string[] = [];

  for (let i = 0; i < block.arms.length; i++) {
    const arm = block.arms[i];
    const isLast = i === block.arms.length - 1;
    const trimmedPattern = arm.patternText.trim();
    const trimmedResult = arm.resultText.trim();

    // Wildcard as last arm → .else()
    if (isLast && trimmedPattern === "_") {
      parts.push(`\n  .else(${trimmedResult})`);
      continue;
    }

    const pt = transformPattern(trimmedPattern);
    let chain = `.case(${pt.caseArg})`;

    if (pt.orArgs) {
      for (const orAlt of pt.orArgs) {
        chain += `.or(${orAlt})`;
      }
    }

    if (pt.asArg) {
      chain += `.as(${pt.asArg})`;
    }

    if (arm.guardText) {
      chain += `.if(${arm.guardText.trim()})`;
    }

    chain += `.then(${trimmedResult})`;
    parts.push(`\n  ${chain}`);
  }

  // Preserve original line count: count lines in original arms text
  const originalText = source.slice(block.closeParenEnd, block.blockEnd);
  const originalLineCount = (originalText.match(/\n/g) || []).length;
  const generatedText = parts.join("");
  const generatedLineCount = (generatedText.match(/\n/g) || []).length;

  // Pad with empty lines if needed to preserve line count
  let finalText = generatedText;
  if (generatedLineCount < originalLineCount) {
    const padding = "\n".repeat(originalLineCount - generatedLineCount);
    finalText += padding;
  }

  return {
    start: block.closeParenEnd,
    end: block.blockEnd,
    text: finalText,
  };
}

/**
 * Transform a pattern string into the fluent API form.
 */
function transformPattern(pattern: string): PatternTransform {
  const trimmed = pattern.trim();

  // AS pattern: `identifier @ innerPattern`
  const asMatch = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*@\s*([\s\S]+)$/);
  if (asMatch) {
    const alias = asMatch[1];
    const inner = asMatch[2].trim();
    const innerTransform = transformPattern(inner);
    return { ...innerTransform, asArg: alias };
  }

  // Regex pattern with `as`: `/regex/flags as arrayPattern`
  const regexAsMatch = trimmed.match(/^(\/(?:[^/\\]|\\.)*\/[dgimsuvy]*)\s+as\s+([\s\S]+)$/);
  if (regexAsMatch) {
    return { caseArg: regexAsMatch[1], asArg: regexAsMatch[2].trim() };
  }

  // Bare regex pattern (no `as`): `/regex/flags`
  if (/^\/(?:[^/\\]|\\.)*\/[dgimsuvy]*$/.test(trimmed)) {
    return { caseArg: trimmed };
  }

  // Type pattern: `identifier: TypeName` (top-level only, not inside brackets)
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    const typeMatch = trimmed.match(
      /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)(?:<[^>]*>)?\s*$/
    );
    if (typeMatch) {
      const binding = typeMatch[1];
      const typeName = typeMatch[2];
      const constructorName = PRIMITIVE_TYPE_CONSTRUCTORS[typeName] ?? typeName;
      return { caseArg: `${constructorName}(${binding})` };
    }
  }

  // OR pattern: literals separated by `|` at depth 0
  const orAlternatives = splitByBarAtDepth0(trimmed);
  if (orAlternatives.length > 1) {
    const first = orAlternatives[0].trim();
    const rest = orAlternatives.slice(1).map((a) => a.trim());
    return { caseArg: first, orArgs: rest };
  }

  // Default: pass through as-is
  return { caseArg: trimmed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasNewlineBetween(source: string, startPos: number, endPos: number): boolean {
  return source.slice(startPos, endPos).includes("\n");
}

function findMatchingParen(tokens: readonly Token[], openIdx: number): number {
  let depth = 1;
  let i = openIdx + 1;
  while (i < tokens.length && depth > 0) {
    if (tokens[i].kind === ts.SyntaxKind.OpenParenToken) depth++;
    else if (tokens[i].kind === ts.SyntaxKind.CloseParenToken) depth--;
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

/**
 * Find `=>` (EqualsGreaterThanToken) at bracket depth 0
 * within the token range [startIdx, endIdx].
 */
function findFatArrowAtDepth0(tokens: readonly Token[], startIdx: number, endIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const kind = tokens[i].kind;
    if (
      kind === ts.SyntaxKind.OpenParenToken ||
      kind === ts.SyntaxKind.OpenBraceToken ||
      kind === ts.SyntaxKind.OpenBracketToken
    ) {
      depth++;
    } else if (
      kind === ts.SyntaxKind.CloseParenToken ||
      kind === ts.SyntaxKind.CloseBraceToken ||
      kind === ts.SyntaxKind.CloseBracketToken
    ) {
      depth = Math.max(0, depth - 1);
    } else if (kind === ts.SyntaxKind.EqualsGreaterThanToken && depth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * Find `if` keyword at bracket depth 0 within [startIdx, endIdx).
 * Returns the first `if` found, or -1.
 */
function findIfAtDepth0(tokens: readonly Token[], startIdx: number, endIdx: number): number {
  let depth = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const kind = tokens[i].kind;
    if (
      kind === ts.SyntaxKind.OpenParenToken ||
      kind === ts.SyntaxKind.OpenBraceToken ||
      kind === ts.SyntaxKind.OpenBracketToken
    ) {
      depth++;
    } else if (
      kind === ts.SyntaxKind.CloseParenToken ||
      kind === ts.SyntaxKind.CloseBraceToken ||
      kind === ts.SyntaxKind.CloseBracketToken
    ) {
      depth = Math.max(0, depth - 1);
    } else if (kind === ts.SyntaxKind.IfKeyword && depth === 0) {
      return i;
    }
  }
  return -1;
}

function extractSourceRange(
  tokens: readonly Token[],
  startIdx: number,
  endIdx: number,
  source: string
): string {
  if (startIdx > endIdx || startIdx < 0 || endIdx >= tokens.length) return "";
  return source.slice(tokens[startIdx].start, tokens[endIdx].end);
}

/**
 * Split a pattern text by `|` at bracket depth 0.
 * Used for OR patterns like `200 | 201 | 204`.
 */
function splitByBarAtDepth0(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inRegex = false;
  let inString: string | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // String tracking
    if (!inRegex && (ch === '"' || ch === "'" || ch === "`") && !inString) {
      inString = ch;
      current += ch;
      continue;
    }
    if (inString && ch === inString && text[i - 1] !== "\\") {
      inString = null;
      current += ch;
      continue;
    }
    if (inString) {
      current += ch;
      continue;
    }

    // Regex tracking (simplified)
    if (ch === "/" && !inRegex && depth === 0) {
      // Heuristic: `/` after whitespace or start is likely regex
      const before = current.trimEnd();
      if (before.length === 0 || /[=(<[{,;|&!~^?:]$/.test(before)) {
        inRegex = true;
        current += ch;
        continue;
      }
    }
    if (inRegex && ch === "/" && text[i - 1] !== "\\") {
      inRegex = false;
      current += ch;
      continue;
    }
    if (inRegex) {
      current += ch;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") {
      depth++;
      current += ch;
    } else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}

const STATEMENT_KEYWORDS = new Set([
  ts.SyntaxKind.ConstKeyword,
  ts.SyntaxKind.LetKeyword,
  ts.SyntaxKind.VarKeyword,
  ts.SyntaxKind.FunctionKeyword,
  ts.SyntaxKind.ClassKeyword,
  ts.SyntaxKind.InterfaceKeyword,
  ts.SyntaxKind.TypeKeyword,
  ts.SyntaxKind.ImportKeyword,
  ts.SyntaxKind.ExportKeyword,
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.IfKeyword,
  ts.SyntaxKind.ForKeyword,
  ts.SyntaxKind.WhileKeyword,
  ts.SyntaxKind.DoKeyword,
  ts.SyntaxKind.SwitchKeyword,
  ts.SyntaxKind.TryKeyword,
  ts.SyntaxKind.ThrowKeyword,
]);

function isStatementKeyword(token: Token): boolean {
  return STATEMENT_KEYWORDS.has(token.kind);
}

export default matchSyntaxExtension;
