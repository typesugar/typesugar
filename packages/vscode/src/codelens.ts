/**
 * CodeLens Provider — inline macro expansion previews.
 *
 * Shows a clickable lens above macro invocations that reveals what the macro
 * expands to. For comptime, shows the computed value. For derive, shows the
 * number of generated functions. For tagged templates, shows validation status.
 *
 * The expansion is computed lazily (on resolve) by running the actual typemacro
 * transformer on the file in a background worker.
 */

import * as vscode from "vscode";
import * as ts from "typescript";
import type { ManifestLoader } from "./manifest.js";
import type { ExpansionService } from "./expansion.js";

export class MacroCodeLensProvider implements vscode.CodeLensProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.onDidChangeEmitter.event;

  constructor(
    private readonly manifest: ManifestLoader,
    private readonly expansion: ExpansionService,
  ) {
    manifest.onDidChange(() => this.onDidChangeEmitter.fire());
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration("typemacro");
    if (!config.get<boolean>("enableCodeLens", true)) return [];

    const lenses: vscode.CodeLens[] = [];
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
    const decoratorNames = this.manifest.decoratorMacroNames;
    const templateNames = this.manifest.taggedTemplateMacroNames;
    const labelNames = this.manifest.labeledBlockLabels;

    const visit = (node: ts.Node): void => {
      // Expression macros
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        expressionNames.has(node.expression.text)
      ) {
        const pos = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        const range = new vscode.Range(
          pos.line,
          pos.character,
          pos.line,
          pos.character,
        );
        lenses.push(
          new vscode.CodeLens(range, {
            title: `$(zap) ${node.expression.text}(...)`,
            command: "typemacro.expandMacro",
            arguments: [document.uri, node.getStart(sourceFile)],
            tooltip: "Click to see macro expansion",
          }),
        );
      }

      // Decorator macros
      if (ts.isDecorator(node)) {
        const nameNode = getDecoratorNameNode(node);
        if (nameNode && decoratorNames.has(nameNode.text)) {
          const pos = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          const range = new vscode.Range(
            pos.line,
            pos.character,
            pos.line,
            pos.character,
          );

          let title = `$(zap) @${nameNode.text}`;
          if (
            nameNode.text === "derive" &&
            ts.isCallExpression(node.expression)
          ) {
            const argCount = node.expression.arguments.length;
            title += ` — ${argCount} derive${argCount === 1 ? "" : "s"}`;
          }

          lenses.push(
            new vscode.CodeLens(range, {
              title,
              command: "typemacro.expandMacro",
              arguments: [document.uri, node.getStart(sourceFile)],
              tooltip: "Click to see macro expansion",
            }),
          );
        }
      }

      // Tagged template macros
      if (
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        templateNames.has(node.tag.text)
      ) {
        const pos = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        const range = new vscode.Range(
          pos.line,
          pos.character,
          pos.line,
          pos.character,
        );
        lenses.push(
          new vscode.CodeLens(range, {
            title: `$(zap) ${node.tag.text}\`...\``,
            command: "typemacro.expandMacro",
            arguments: [document.uri, node.getStart(sourceFile)],
            tooltip: "Click to see macro expansion",
          }),
        );
      }

      // Labeled block comprehensions
      if (ts.isLabeledStatement(node) && labelNames.has(node.label.text)) {
        // Only show lens on the opening label (let:), not continuations
        const isOpening = Object.keys(
          this.manifest.current.macros.labeledBlock,
        ).includes(node.label.text);
        if (isOpening) {
          const pos = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          const range = new vscode.Range(
            pos.line,
            pos.character,
            pos.line,
            pos.character,
          );
          lenses.push(
            new vscode.CodeLens(range, {
              title: `$(zap) ${node.label.text}: comprehension`,
              command: "typemacro.expandMacro",
              arguments: [document.uri, node.getStart(sourceFile)],
              tooltip: "Click to see flatMap chain expansion",
            }),
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return lenses;
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}

function getDecoratorNameNode(
  decorator: ts.Decorator,
): ts.Identifier | undefined {
  const expr = decorator.expression;
  if (ts.isIdentifier(expr)) return expr;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression;
  }
  return undefined;
}
