/**
 * Inlay Hints Provider — type annotations and value previews inline.
 *
 * Shows:
 * - Bind variable types in comprehensions: `user << fetchUser(id)` → `user: User`
 * - Comptime results: `comptime(() => 2 + 3)` → `= 5`
 * - Tagged template results: `units\`5 meters\`` → `→ Length<Meters>`
 */

import * as vscode from "vscode";
import * as ts from "typescript";
import type { ManifestLoader } from "./manifest.js";
import type { ExpansionService } from "./expansion.js";

export class MacroInlayHintsProvider implements vscode.InlayHintsProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.onDidChangeEmitter.event;

  constructor(
    private readonly manifest: ManifestLoader,
    private readonly expansion: ExpansionService,
  ) {
    manifest.onDidChange(() => this.onDidChangeEmitter.fire());
  }

  async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlayHint[]> {
    const config = vscode.workspace.getConfiguration("typemacro");
    if (!config.get<boolean>("enableInlayHints", true)) return [];

    const hints: vscode.InlayHint[] = [];
    const text = document.getText();

    const sourceFile = ts.createSourceFile(
      document.fileName,
      text,
      ts.ScriptTarget.Latest,
      true,
      document.languageId === "typescriptreact"
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS,
    );

    const expressionNames = this.manifest.expressionMacroNames;
    const labelNames = this.manifest.labeledBlockLabels;

    // Try to get expansion results (may be cached from a recent build)
    const expansionResult = await this.expansion.getExpansionResult(document);

    const visit = (node: ts.Node): void => {
      if (token.isCancellationRequested) return;

      const nodeStart = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      const nodeEnd = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

      // Skip nodes outside the visible range
      if (nodeEnd.line < range.start.line || nodeStart.line > range.end.line) {
        // Still visit children — they might be in range
        ts.forEachChild(node, visit);
        return;
      }

      // --- Comptime result hints ---
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "comptime" &&
        expressionNames.has("comptime")
      ) {
        const result = expansionResult?.comptimeResults?.get(
          node.getStart(sourceFile),
        );
        if (result !== undefined) {
          const endPos = sourceFile.getLineAndCharacterOfPosition(
            node.getEnd(),
          );
          const hint = new vscode.InlayHint(
            new vscode.Position(endPos.line, endPos.character),
            ` = ${truncate(String(result), 40)}`,
            vscode.InlayHintKind.Type,
          );
          hint.paddingLeft = true;
          hint.tooltip = new vscode.MarkdownString(
            `**Compile-time result:**\n\`\`\`\n${String(result)}\n\`\`\``,
          );
          hints.push(hint);
        }
      }

      // --- Bind variable type hints in comprehensions ---
      if (ts.isLabeledStatement(node) && labelNames.has(node.label.text)) {
        if (ts.isBlock(node.statement)) {
          for (const stmt of node.statement.statements) {
            if (!ts.isExpressionStatement(stmt)) continue;
            if (
              ts.isBinaryExpression(stmt.expression) &&
              stmt.expression.operatorToken.kind ===
                ts.SyntaxKind.LessThanLessThanToken &&
              ts.isIdentifier(stmt.expression.left)
            ) {
              const bindName = stmt.expression.left;
              const inferredType = expansionResult?.bindTypes?.get(
                bindName.getStart(sourceFile),
              );
              if (inferredType) {
                const nameEnd = sourceFile.getLineAndCharacterOfPosition(
                  bindName.getEnd(),
                );
                const hint = new vscode.InlayHint(
                  new vscode.Position(nameEnd.line, nameEnd.character),
                  `: ${truncate(inferredType, 30)}`,
                  vscode.InlayHintKind.Type,
                );
                hint.paddingLeft = true;
                hints.push(hint);
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return hints;
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}
