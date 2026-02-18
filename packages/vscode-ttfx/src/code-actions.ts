/**
 * Code Actions Provider — quick fixes and refactorings for macros.
 *
 * Provides:
 * - "Expand macro" — replace a macro invocation with its expansion
 * - "Wrap in comptime" — wrap a selected expression in comptime(() => ...)
 * - "Add @derive" — add derive decorators to a class/interface
 */

import * as vscode from "vscode";
import * as ts from "typescript";
import type { ManifestLoader } from "./manifest.js";
import type { ExpansionService } from "./expansion.js";

export class MacroCodeActionsProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.Refactor,
    vscode.CodeActionKind.QuickFix,
  ];

  constructor(
    private readonly manifest: ManifestLoader,
    private readonly expansion: ExpansionService,
  ) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
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

    const offset = document.offsetAt(range.start);
    const node = findNodeAtOffset(sourceFile, offset);
    if (!node) return actions;

    const expressionNames = this.manifest.expressionMacroNames;
    const decoratorNames = this.manifest.decoratorMacroNames;
    const templateNames = this.manifest.taggedTemplateMacroNames;

    // --- "Expand macro" for expression macros ---
    const callExpr = findAncestor(node, ts.isCallExpression) as
      | ts.CallExpression
      | undefined;
    if (
      callExpr &&
      ts.isIdentifier(callExpr.expression) &&
      expressionNames.has(callExpr.expression.text)
    ) {
      const action = new vscode.CodeAction(
        `Expand ${callExpr.expression.text}(...)`,
        vscode.CodeActionKind.Refactor,
      );
      action.command = {
        command: "typemacro.expandMacro",
        title: "Expand macro",
        arguments: [document.uri, callExpr.getStart(sourceFile)],
      };
      actions.push(action);
    }

    // --- "Expand macro" for decorator macros ---
    const decorator = findAncestor(node, ts.isDecorator);
    if (decorator) {
      const name = getDecoratorName(decorator as ts.Decorator);
      if (name && decoratorNames.has(name)) {
        const action = new vscode.CodeAction(
          `Expand @${name}`,
          vscode.CodeActionKind.Refactor,
        );
        action.command = {
          command: "typemacro.expandMacro",
          title: "Expand macro",
          arguments: [document.uri, decorator.getStart(sourceFile)],
        };
        actions.push(action);
      }
    }

    // --- "Expand macro" for tagged templates ---
    const taggedTemplate = findAncestor(node, ts.isTaggedTemplateExpression);
    if (
      taggedTemplate &&
      ts.isIdentifier((taggedTemplate as ts.TaggedTemplateExpression).tag) &&
      templateNames.has(
        ((taggedTemplate as ts.TaggedTemplateExpression).tag as ts.Identifier)
          .text,
      )
    ) {
      const tagName = (
        (taggedTemplate as ts.TaggedTemplateExpression).tag as ts.Identifier
      ).text;
      const action = new vscode.CodeAction(
        `Expand ${tagName}\`...\``,
        vscode.CodeActionKind.Refactor,
      );
      action.command = {
        command: "typemacro.expandMacro",
        title: "Expand macro",
        arguments: [document.uri, taggedTemplate.getStart(sourceFile)],
      };
      actions.push(action);
    }

    // --- "Wrap in comptime" for selected expressions ---
    if (
      range instanceof vscode.Selection &&
      !range.isEmpty &&
      expressionNames.has("comptime")
    ) {
      const selectedText = document.getText(range).trim();
      if (selectedText && !selectedText.includes("\n")) {
        const action = new vscode.CodeAction(
          "Wrap in comptime(() => ...)",
          vscode.CodeActionKind.Refactor,
        );
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(
          document.uri,
          range,
          `comptime(() => ${selectedText})`,
        );
        actions.push(action);
      }
    }

    // --- "Add @derive" for classes/interfaces without one ---
    const classOrInterface = findAncestor(
      node,
      (n) => ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n),
    );
    if (classOrInterface) {
      const hasDerive = ts.canHaveDecorators(classOrInterface)
        ? (ts.getDecorators(classOrInterface) ?? []).some((d) => {
            const dName = getDecoratorName(d);
            return dName === "derive";
          })
        : false;

      if (!hasDerive && decoratorNames.has("derive")) {
        const action = new vscode.CodeAction(
          "Add @derive(...)",
          vscode.CodeActionKind.Refactor,
        );
        action.command = {
          command: "typemacro.addDerive",
          title: "Add derive",
          arguments: [document.uri, classOrInterface.getStart(sourceFile)],
        };
        actions.push(action);
      }
    }

    return actions;
  }
}

// ---------------------------------------------------------------------------
// AST Helpers
// ---------------------------------------------------------------------------

function findNodeAtOffset(
  sourceFile: ts.SourceFile,
  offset: number,
): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (offset >= node.getStart(sourceFile) && offset < node.getEnd()) {
      return ts.forEachChild(node, find) ?? node;
    }
    return undefined;
  }
  return find(sourceFile);
}

function findAncestor(
  node: ts.Node,
  predicate: (node: ts.Node) => boolean,
): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return undefined;
}
