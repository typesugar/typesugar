/**
 * Source Map Utilities for Macro Expansions
 *
 * Helpers for preserving source map information when transforming AST nodes.
 */

import * as ts from "typescript";
import MagicString from "magic-string";

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
 * Records a single macro expansion event.
 */
export interface ExpansionRecord {
  macroName: string;
  originalFile: string;
  originalLine: number;
  originalColumn: number;
  originalStart: number;
  originalEnd: number;
  originalText: string;
  expandedText: string;
  timestamp: number;
  fromCache: boolean;
  sourcePackage?: string;
  unhygienicEscapes?: number;
}

/**
 * Preserve source map information when replacing an original node with a new synthetic node.
 *
 * TypeScript's emitter uses source map ranges on AST nodes to generate source maps.
 * Synthetic nodes (created by macro expansion) have pos: -1, end: -1 by default,
 * which produces no source map entries. This helper copies the source map range
 * from the original macro call site to the expanded output, so debuggers and
 * stack traces point to the original source location.
 *
 * @param newNode - The synthetic node produced by macro expansion
 * @param originalNode - The original node (macro call site) being replaced
 * @returns The newNode with source map range set to originalNode's range
 */
export function preserveSourceMap<T extends ts.Node>(newNode: T, originalNode: ts.Node): T {
  ts.setSourceMapRange(newNode, ts.getSourceMapRange(originalNode));
  return newNode;
}

/**
 * Tracks all macro expansions during a compilation for source map generation.
 */
export class ExpansionTracker {
  private expansions: ExpansionRecord[] = [];

  recordExpansion(
    macroName: string,
    originalNode: ts.Node,
    sourceFile: ts.SourceFile,
    expandedText: string,
    fromCache: boolean = false
  ): void {
    // Skip synthetic nodes (created by preprocessor) that have no real position
    if (originalNode.pos < 0 || originalNode.end < 0) return;

    let start: number;
    let end: number;
    try {
      start = originalNode.getStart(sourceFile);
      end = originalNode.getEnd();
    } catch {
      return; // Node doesn't have a real position — can't record
    }
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);

    let originalText: string;
    try {
      originalText = originalNode.getText(sourceFile);
    } catch {
      originalText = "<synthetic node>";
    }

    this.expansions.push({
      macroName,
      originalFile: sourceFile.fileName,
      originalLine: line + 1,
      originalColumn: character,
      originalStart: start,
      originalEnd: end,
      originalText,
      expandedText,
      timestamp: Date.now(),
      fromCache,
    });
  }

  getExpansionsForFile(fileName: string): ExpansionRecord[] {
    return this.expansions.filter((e) => e.originalFile === fileName);
  }

  getAllExpansions(): ReadonlyArray<ExpansionRecord> {
    return this.expansions;
  }

  get count(): number {
    return this.expansions.length;
  }

  clear(): void {
    this.expansions = [];
  }

  /**
   * Apply expansion records to the original source via MagicString text surgery.
   *
   * Returns the modified MagicString instance so callers can extract
   * both the code (`s.toString()`) and source map (`s.generateMap()`).
   * Returns null if there are no expansions for this file.
   */
  private applyExpansions(originalSource: string, fileName: string): MagicString | null {
    const fileExpansions = this.getExpansionsForFile(fileName);
    if (fileExpansions.length === 0) {
      return null;
    }

    const s = new MagicString(originalSource);
    const sorted = [...fileExpansions].sort((a, b) => b.originalStart - a.originalStart);
    const appliedRanges: Array<{ start: number; end: number }> = [];

    for (const exp of sorted) {
      const isNested = appliedRanges.some(
        (range) => exp.originalStart >= range.start && exp.originalEnd <= range.end
      );
      if (isNested) continue;

      try {
        s.overwrite(exp.originalStart, exp.originalEnd, exp.expandedText);
        appliedRanges.push({ start: exp.originalStart, end: exp.originalEnd });
      } catch {
        continue;
      }
    }

    return s;
  }

  generateSourceMap(originalSource: string, fileName: string = "source.ts"): RawSourceMap | null {
    const s = this.applyExpansions(originalSource, fileName);
    if (!s) return null;

    const map = s.generateMap({
      hires: true,
      source: fileName,
      includeContent: true,
    });

    return {
      version: 3,
      file: fileName.replace(/\.ts$/, ".js"),
      sourceRoot: "",
      sources: map.sources,
      sourcesContent: map.sourcesContent as (string | null)[] | undefined,
      names: map.names,
      mappings: map.mappings,
    };
  }

  /**
   * Generate expanded code by surgically replacing only macro call sites
   * in the original source text.
   *
   * Unlike printer.printFile() which reprints the entire AST (losing blank
   * lines, comments, and formatting), this preserves the original source
   * byte-for-byte except at expansion sites. Returns null if no expansions.
   */
  generateExpandedCode(originalSource: string, fileName: string = "source.ts"): string | null {
    const s = this.applyExpansions(originalSource, fileName);
    if (!s) return null;
    return s.toString();
  }
}

/**
 * Global expansion tracker singleton.
 */
export const globalExpansionTracker = new ExpansionTracker();
