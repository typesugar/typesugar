/**
 * Additional code actions for the LSP server.
 *
 * Provides expand-macro, wrap-in-comptime, and add-derive actions.
 * Ported from packages/vscode/src/code-actions.ts.
 */

import * as ts from "typescript";
import type { ManifestState } from "./manifest.js";
import type { CodeAction, Range } from "vscode-languageserver/node.js";
import { CodeActionKind } from "vscode-languageserver/node.js";
import { offsetToPosition, positionToOffset, getDecoratorName } from "./helpers.js";

function findNodeAtOffset(sourceFile: ts.SourceFile, offset: number): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (offset >= node.getStart(sourceFile) && offset < node.getEnd()) {
      return ts.forEachChild(node, find) || node;
    }
    return undefined;
  }
  return find(sourceFile);
}

function findAncestor(node: ts.Node, predicate: (n: ts.Node) => boolean): ts.Node | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return undefined;
}

export function computeExtraCodeActions(
  text: string,
  fileName: string,
  manifest: ManifestState,
  range: Range,
  uri: string
): CodeAction[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".stsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const actions: CodeAction[] = [];
  const startOffset = positionToOffset(text, range.start);

  const node = findNodeAtOffset(sourceFile, startOffset);
  if (!node) return actions;

  // Expand macro action — for any macro invocation at cursor
  const macroCall = findAncestor(node, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      return manifest.expressionMacroNames.has(n.expression.text);
    }
    if (ts.isTaggedTemplateExpression(n) && ts.isIdentifier(n.tag)) {
      return manifest.taggedTemplateMacroNames.has(n.tag.text);
    }
    return false;
  });

  if (macroCall) {
    const macroName =
      ts.isCallExpression(macroCall) && ts.isIdentifier(macroCall.expression)
        ? macroCall.expression.text
        : ts.isTaggedTemplateExpression(macroCall) && ts.isIdentifier(macroCall.tag)
          ? macroCall.tag.text
          : "macro";

    actions.push({
      title: `Expand ${macroName}`,
      kind: CodeActionKind.Refactor,
      command: {
        title: `Expand ${macroName}`,
        command: "typesugar.expandMacro",
        arguments: [uri, macroCall.getStart(sourceFile)],
      },
    });
  }

  // Check for decorator
  const decoratorNode = findAncestor(node, (n) => {
    if (ts.isDecorator(n)) {
      const name = getDecoratorName(n);
      return !!name && manifest.decoratorMacroNames.has(name);
    }
    return false;
  });

  if (decoratorNode && ts.isDecorator(decoratorNode)) {
    const name = getDecoratorName(decoratorNode) ?? "decorator";
    actions.push({
      title: `Expand @${name}`,
      kind: CodeActionKind.Refactor,
      command: {
        title: `Expand @${name}`,
        command: "typesugar.expandMacro",
        arguments: [uri, decoratorNode.getStart(sourceFile)],
      },
    });
  }

  // Wrap in comptime — when there's a selection and comptime is available
  const endOffset = positionToOffset(text, range.end);
  if (endOffset > startOffset && manifest.expressionMacroNames.has("comptime")) {
    const selectedText = text.slice(startOffset, endOffset);
    // Only offer for single-line selections
    if (!selectedText.includes("\n")) {
      actions.push({
        title: "Wrap in comptime(...)",
        kind: CodeActionKind.Refactor,
        edit: {
          changes: {
            [uri]: [
              {
                range,
                newText: `comptime(() => ${selectedText})`,
              },
            ],
          },
        },
      });
    }
  }

  // Add @derive — for classes/interfaces without @derive
  const classOrInterface = findAncestor(
    node,
    (n) => ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n)
  );

  if (
    classOrInterface &&
    (ts.isClassDeclaration(classOrInterface) || ts.isInterfaceDeclaration(classOrInterface))
  ) {
    const decorators = ts.isClassDeclaration(classOrInterface)
      ? ts.getDecorators(classOrInterface)
      : undefined;
    const hasDerive = decorators?.some((d) => getDecoratorName(d) === "derive");

    if (!hasDerive) {
      const declStart = classOrInterface.getStart(sourceFile);

      actions.push({
        title: "Add @derive(...)",
        kind: CodeActionKind.Refactor,
        command: {
          title: "Add @derive(...)",
          command: "typesugar.addDerive",
          arguments: [uri, declStart],
        },
      });
    }
  }

  return actions;
}
