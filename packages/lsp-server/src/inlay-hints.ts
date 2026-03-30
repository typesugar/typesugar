/**
 * Inlay hints computation for the LSP server.
 *
 * Shows inline type annotations for bind variables and comptime results.
 * Ported from packages/vscode/src/inlay-hints.ts.
 */

import * as ts from "typescript";
import type { ManifestState } from "./manifest.js";
import type { InlayHint, Range } from "vscode-languageserver/node.js";
import { InlayHintKind } from "vscode-languageserver/node.js";
import { offsetToPosition, positionToOffset } from "./helpers.js";
import type { ExpansionRecord } from "@typesugar/core";

export function computeInlayHints(
  text: string,
  fileName: string,
  manifest: ManifestState,
  visibleRange: Range,
  expansions?: ExpansionRecord[]
): InlayHint[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".stsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const hints: InlayHint[] = [];
  const rangeStart = positionToOffset(text, visibleRange.start);
  const rangeEnd = positionToOffset(text, visibleRange.end);

  function isInRange(node: ts.Node): boolean {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    return start < rangeEnd && end > rangeStart;
  }

  // Build expansion lookup by position
  const expansionByStart = new Map<number, ExpansionRecord>();
  if (expansions) {
    for (const exp of expansions) {
      expansionByStart.set(exp.originalStart, exp);
    }
  }

  function visit(node: ts.Node): void {
    if (!isInRange(node)) return;

    // Macro expansion hints: show truncated result after macro call
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (manifest.expressionMacroNames.has(name)) {
        const start = node.getStart(sourceFile);
        const expansion = expansionByStart.get(start);
        if (expansion) {
          const preview = truncate(expansion.expandedText.replace(/\s+/g, " ").trim(), 60);
          hints.push({
            position: offsetToPosition(text, node.getEnd()),
            label: ` = ${preview}`,
            kind: InlayHintKind.Type,
            paddingLeft: true,
            tooltip: {
              kind: "markdown",
              value: "```typescript\n" + expansion.expandedText + "\n```",
            },
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return hints;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}
