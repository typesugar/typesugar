/**
 * Post-format transformation: valid TypeScript → custom syntax
 *
 * Reverses the preprocessor transformations after Prettier has formatted the code.
 * Uses TypeScript's AST parser to find patterns that need reversal.
 */

import * as ts from "typescript";
import MagicString from "magic-string";
import type { FormatMetadata, HKTParamInfo } from "./pre-format.js";

/**
 * Information about a __binop__ call that needs reversal
 */
interface BinopCallInfo {
  /** The CallExpression node */
  node: ts.CallExpression;
  /** The operator string ("|>" or "::") */
  operator: string;
  /** Start position of the entire call */
  start: number;
  /** End position of the entire call */
  end: number;
  /** Left operand (either text or nested BinopCallInfo) */
  left: string | BinopCallInfo;
  /** Right operand (either text or nested BinopCallInfo) */
  right: string | BinopCallInfo;
  /** Whether the call spans multiple lines */
  isMultiLine: boolean;
  /** Base indentation for multi-line formatting */
  baseIndent: string;
}

/**
 * Information about a $<F, A> type reference that needs reversal
 */
interface HKTUsageInfo {
  /** The TypeReferenceNode */
  node: ts.TypeReferenceNode;
  /** Start position */
  start: number;
  /** End position */
  end: number;
  /** The HKT parameter name (first type argument) */
  paramName: string;
  /** The type argument text (second type argument) */
  typeArg: string;
}

/**
 * Reverse the preprocessor transformations in Prettier-formatted code.
 *
 * @param formatted - Prettier-formatted code (contains __binop__, /*@ts:hkt*\/, $<F, A>)
 * @param metadata - Metadata from preFormat about HKT parameters
 * @returns Code with custom syntax restored
 */
export function postFormat(formatted: string, metadata: FormatMetadata): string {
  // If nothing was changed during pre-format, return as-is
  if (!metadata.changed) {
    return formatted;
  }

  let current = formatted;

  // 1. Reverse __binop__ calls (all at once, in reverse position order)
  // This preserves positions as we work from end to start
  const sourceFile = ts.createSourceFile(
    "formatted.ts",
    current,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const binopCalls = collectBinopCalls(sourceFile, current);
  if (binopCalls.length > 0) {
    // Sort by start position descending (process from end to start)
    // This ensures position changes don't affect other replacements
    binopCalls.sort((a, b) => b.start - a.start);

    const s = new MagicString(current);
    for (const info of binopCalls) {
      reverseBinop(s, info);
    }
    current = s.toString();
  }

  // 2. Extract HKT param names from marker comments (before removing them)
  // Pattern: "F /*@ts:hkt*/" means F is an HKT parameter
  const hktParamNames = extractHKTParamNamesFromMarkers(current);

  // 3. Reverse HKT usages ($<F, A> → F<A>) using AST
  // Must happen BEFORE we remove markers, since F<_> is not valid TS
  if (hktParamNames.size > 0) {
    const sourceFile2 = ts.createSourceFile(
      "formatted.ts",
      current,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const s2 = new MagicString(current);
    reverseHKTUsagesSimple(s2, current, sourceFile2, hktParamNames);
    current = s2.toString();
  }

  // 4. Reverse HKT declaration markers (F /*@ts:hkt*/ → F<_>)
  // This is done last via text replacement since F<_> is not valid TS
  const s3 = new MagicString(current);
  reverseHKTDeclarations(s3, current);
  current = s3.toString();

  return current;
}

/**
 * Try to parse a node as a __binop__ call, recursively handling nested calls.
 */
function tryParseBinopCall(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  source: string
): BinopCallInfo | null {
  if (!ts.isCallExpression(node)) return null;

  if (
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== "__binop__" ||
    node.arguments.length !== 3
  ) {
    return null;
  }

  const [leftArg, opArg, rightArg] = node.arguments;

  let operator: string | null = null;
  if (ts.isStringLiteral(opArg)) {
    operator = opArg.text;
  }

  if (!operator || (operator !== "|>" && operator !== "::")) {
    return null;
  }

  const start = node.getStart(sourceFile);
  const end = node.getEnd();

  // Recursively check if operands are __binop__ calls
  const leftNested = tryParseBinopCall(leftArg, sourceFile, source);
  const rightNested = tryParseBinopCall(rightArg, sourceFile, source);

  const left = leftNested ?? leftArg.getText(sourceFile);
  const right = rightNested ?? rightArg.getText(sourceFile);

  // Determine if this call spans multiple lines
  const callText = source.slice(start, end);
  const isMultiLine = callText.includes("\n");

  // Calculate base indentation
  const lineStart = source.lastIndexOf("\n", start) + 1;
  const baseIndent = source.slice(lineStart, start).match(/^(\s*)/)?.[1] ?? "";

  return {
    node,
    operator,
    start,
    end,
    left,
    right,
    isMultiLine,
    baseIndent,
  };
}

/**
 * Collect all top-level __binop__ call expressions from the AST.
 * Nested __binop__ calls are captured within their parent's left/right fields.
 */
function collectBinopCalls(sourceFile: ts.SourceFile, source: string): BinopCallInfo[] {
  const calls: BinopCallInfo[] = [];
  const visited = new Set<ts.Node>();

  function visit(node: ts.Node): void {
    if (visited.has(node)) return;

    const binop = tryParseBinopCall(node, sourceFile, source);
    if (binop) {
      calls.push(binop);
      // Mark all nested __binop__ nodes as visited so we don't double-process
      markNestedAsVisited(binop);
      return; // Don't recurse into this tree
    }

    ts.forEachChild(node, visit);
  }

  function markNestedAsVisited(info: BinopCallInfo): void {
    visited.add(info.node);
    if (typeof info.left !== "string") {
      markNestedAsVisited(info.left);
    }
    if (typeof info.right !== "string") {
      markNestedAsVisited(info.right);
    }
  }

  visit(sourceFile);
  return calls;
}

/**
 * Generate the reversed text for a __binop__ call, recursively handling nested calls.
 */
function generateReversedBinop(info: BinopCallInfo): string {
  const { operator, left, right, isMultiLine, baseIndent } = info;

  // Recursively generate text for nested calls
  const leftText = typeof left === "string" ? left : generateReversedBinop(left);
  const rightText = typeof right === "string" ? right : generateReversedBinop(right);

  if (isMultiLine) {
    // Multi-line: format with operator at start of continuation line
    const indent = baseIndent + "  ";
    return `${leftText}\n${indent}${operator} ${rightText.trim()}`;
  } else {
    // Single-line: simple inline format
    return `${leftText} ${operator} ${rightText}`;
  }
}

/**
 * Reverse a single __binop__ call to custom operator syntax.
 */
function reverseBinop(s: MagicString, info: BinopCallInfo): void {
  const replacement = generateReversedBinop(info);
  s.overwrite(info.start, info.end, replacement);
}

/**
 * Reverse HKT declaration markers (F /*@ts:hkt*\/ → F<_>).
 */
function reverseHKTDeclarations(s: MagicString, formatted: string): void {
  const marker = "/*@ts:hkt*/";
  let searchStart = 0;

  while (true) {
    const markerIdx = formatted.indexOf(marker, searchStart);
    if (markerIdx === -1) break;

    // Find the identifier before the marker
    // Pattern: "F /*@ts:hkt*/" or "F/*@ts:hkt*/"
    let beforeMarker = markerIdx;

    // Skip any whitespace between identifier and marker
    while (beforeMarker > 0 && /\s/.test(formatted[beforeMarker - 1])) {
      beforeMarker--;
    }

    // Find the start of the identifier
    let identStart = beforeMarker;
    while (identStart > 0 && /[a-zA-Z0-9_$]/.test(formatted[identStart - 1])) {
      identStart--;
    }

    if (identStart < beforeMarker) {
      const identName = formatted.slice(identStart, beforeMarker);
      // Replace "F /*@ts:hkt*/" with "F<_>"
      s.overwrite(identStart, markerIdx + marker.length, `${identName}<_>`);
    }

    searchStart = markerIdx + marker.length;
  }
}

/**
 * Reverse HKT usages ($<F, A> → F<A>) for parameters in scope.
 */
function reverseHKTUsages(
  s: MagicString,
  source: string,
  sourceFile: ts.SourceFile,
  hktParams: HKTParamInfo[]
): void {
  if (hktParams.length === 0) {
    return;
  }

  const usages = collectHKTUsages(sourceFile, source, hktParams);

  // Process in reverse order to avoid position shifts
  usages.sort((a, b) => b.start - a.start);

  for (const usage of usages) {
    const replacement = `${usage.paramName}<${usage.typeArg}>`;
    s.overwrite(usage.start, usage.end, replacement);
  }
}

/**
 * Collect all $<F, A> type references where F is an HKT parameter.
 */
function collectHKTUsages(
  sourceFile: ts.SourceFile,
  source: string,
  hktParams: HKTParamInfo[]
): HKTUsageInfo[] {
  const usages: HKTUsageInfo[] = [];

  // Build a set of HKT param names for quick lookup
  const paramNames = new Set(hktParams.map((p) => p.name));

  function visit(node: ts.Node): void {
    if (ts.isTypeReferenceNode(node)) {
      // Check if this is a $<F, A> reference
      if (
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === "$" &&
        node.typeArguments &&
        node.typeArguments.length === 2
      ) {
        const [firstArg, secondArg] = node.typeArguments;

        // The first argument should be an identifier that's an HKT param
        if (ts.isTypeReferenceNode(firstArg) && ts.isIdentifier(firstArg.typeName)) {
          const paramName = firstArg.typeName.text;

          if (paramNames.has(paramName)) {
            // Check if this position is within the param's scope
            const nodeStart = node.getStart(sourceFile);
            const inScope = hktParams.some(
              (p) => p.name === paramName && nodeStart >= p.scope.start && nodeStart <= p.scope.end
            );

            if (inScope) {
              const typeArg = secondArg.getText(sourceFile);
              usages.push({
                node,
                start: node.getStart(sourceFile),
                end: node.getEnd(),
                paramName,
                typeArg,
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return usages;
}

/**
 * Extract HKT parameter names from marker comments.
 * Pattern: "F /*@ts:hkt*\/" means F is an HKT parameter.
 */
function extractHKTParamNamesFromMarkers(code: string): Set<string> {
  const names = new Set<string>();
  const marker = "/*@ts:hkt*/";
  let searchStart = 0;

  while (true) {
    const markerIdx = code.indexOf(marker, searchStart);
    if (markerIdx === -1) break;

    // Find the identifier before the marker
    let beforeMarker = markerIdx;
    while (beforeMarker > 0 && /\s/.test(code[beforeMarker - 1])) {
      beforeMarker--;
    }

    let identStart = beforeMarker;
    while (identStart > 0 && /[a-zA-Z0-9_$]/.test(code[identStart - 1])) {
      identStart--;
    }

    if (identStart < beforeMarker) {
      const name = code.slice(identStart, beforeMarker);
      if (/^[A-Z]/.test(name)) {
        names.add(name);
      }
    }

    searchStart = markerIdx + marker.length;
  }

  return names;
}

/**
 * Extract HKT parameter names from code by looking for F<_> patterns.
 * After reverseHKTDeclarations runs, HKT declarations look like "F<_>".
 */
function extractHKTParamNamesFromCode(code: string): Set<string> {
  const names = new Set<string>();

  // Look for patterns like "F<_>" where F is an uppercase identifier
  const regex = /([A-Z][a-zA-Z0-9_$]*)\s*<\s*_\s*>/g;
  let match;

  while ((match = regex.exec(code)) !== null) {
    names.add(match[1]);
  }

  return names;
}

/**
 * Reverse HKT usages without relying on scope metadata.
 * Simply reverse all $<F, A> where F is a known HKT param name.
 */
function reverseHKTUsagesSimple(
  s: MagicString,
  source: string,
  sourceFile: ts.SourceFile,
  hktParamNames: Set<string>
): void {
  const usages: Array<{ start: number; end: number; paramName: string; typeArg: string }> = [];

  function visit(node: ts.Node): void {
    if (ts.isTypeReferenceNode(node)) {
      // Check if this is a $<F, A> reference
      if (
        ts.isIdentifier(node.typeName) &&
        node.typeName.text === "$" &&
        node.typeArguments &&
        node.typeArguments.length === 2
      ) {
        const [firstArg, secondArg] = node.typeArguments;

        // The first argument should be an identifier that's an HKT param
        if (ts.isTypeReferenceNode(firstArg) && ts.isIdentifier(firstArg.typeName)) {
          const paramName = firstArg.typeName.text;

          if (hktParamNames.has(paramName)) {
            const typeArg = secondArg.getText(sourceFile);
            usages.push({
              start: node.getStart(sourceFile),
              end: node.getEnd(),
              paramName,
              typeArg,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Process in reverse order to avoid position shifts
  usages.sort((a, b) => b.start - a.start);

  for (const usage of usages) {
    const replacement = `${usage.paramName}<${usage.typeArg}>`;
    s.overwrite(usage.start, usage.end, replacement);
  }
}
