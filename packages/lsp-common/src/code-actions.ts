/**
 * Macro-specific code actions shared between LSP server and TS plugin.
 *
 * Returns actions in a generic format that each consumer converts to
 * their native type (LSP CodeAction or ts.CodeFixAction).
 *
 * @see PEP-034 Wave 2B
 */

import * as ts from "typescript";
import { findNodeAtOffset, findAncestor, getDecoratorName } from "./ast-helpers.js";

/**
 * Information about macro names known to the current project.
 * Both the LSP server's ManifestState and the TS plugin can provide this.
 */
export interface MacroManifest {
  expressionMacroNames: ReadonlySet<string>;
  taggedTemplateMacroNames: ReadonlySet<string>;
  decoratorMacroNames: ReadonlySet<string>;
}

/** A generic code action independent of LSP or TS plugin types. */
export interface MacroCodeAction {
  title: string;
  kind: "expand-macro" | "wrap-comptime" | "add-derive";
  /** For expand-macro: the macro name */
  macroName?: string;
  /** For expand-macro: the offset of the macro invocation in original source */
  macroOffset?: number;
  /** For wrap-comptime: the text edit */
  edit?: {
    start: number;
    length: number;
    newText: string;
  };
  /** For add-derive: the offset of the class/interface declaration */
  declOffset?: number;
}

/**
 * Compute macro-specific code actions for a given position range.
 *
 * Returns generic MacroCodeAction objects that both the LSP server and
 * TS plugin can convert to their native format.
 */
export function computeMacroCodeActions(
  text: string,
  fileName: string,
  manifest: MacroManifest,
  startOffset: number,
  endOffset: number
): MacroCodeAction[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".stsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const actions: MacroCodeAction[] = [];

  const node = findNodeAtOffset(sourceFile, startOffset);
  if (!node) return actions;

  // Expand macro — for any macro invocation at cursor
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
      kind: "expand-macro",
      macroName,
      macroOffset: macroCall.getStart(sourceFile),
    });
  }

  // Expand decorator macro
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
      kind: "expand-macro",
      macroName: name,
      macroOffset: decoratorNode.getStart(sourceFile),
    });
  }

  // Wrap in comptime — when there's a selection and comptime is available
  if (endOffset > startOffset && manifest.expressionMacroNames.has("comptime")) {
    const selectedText = text.slice(startOffset, endOffset);
    if (!selectedText.includes("\n")) {
      actions.push({
        title: "Wrap in comptime(...)",
        kind: "wrap-comptime",
        edit: {
          start: startOffset,
          length: endOffset - startOffset,
          newText: `comptime(() => ${selectedText})`,
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
      actions.push({
        title: "Add @derive(...)",
        kind: "add-derive",
        declOffset: classOrInterface.getStart(sourceFile),
      });
    }
  }

  return actions;
}
