/**
 * CodeLens computation for the LSP server.
 *
 * Places clickable lenses above macro invocations showing macro names.
 * Ported from packages/vscode/src/codelens.ts.
 */

import * as ts from "typescript";
import type { ManifestState } from "./manifest.js";
import type { CodeLens, Range } from "vscode-languageserver/node.js";
import { offsetToPosition, getDecoratorName } from "./helpers.js";

export function computeCodeLenses(
  text: string,
  fileName: string,
  manifest: ManifestState,
  uri: string
): CodeLens[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".stsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const lenses: CodeLens[] = [];

  function makeRange(node: ts.Node): Range {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    return {
      start: offsetToPosition(text, start),
      end: offsetToPosition(text, end),
    };
  }

  function visit(node: ts.Node): void {
    // Expression macros
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (manifest.expressionMacroNames.has(name)) {
        lenses.push({
          range: makeRange(node),
          command: {
            title: `$(zap) ${name}(...)`,
            command: "typesugar.expandMacro",
            arguments: [uri, node.getStart(sourceFile)],
          },
        });
      }
    }

    // Tagged template macros
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag)) {
      const name = node.tag.text;
      if (manifest.taggedTemplateMacroNames.has(name)) {
        lenses.push({
          range: makeRange(node),
          command: {
            title: `$(zap) ${name}\`...\``,
            command: "typesugar.expandMacro",
            arguments: [uri, node.getStart(sourceFile)],
          },
        });
      }
    }

    // Decorator macros
    if (ts.isDecorator(node)) {
      const name = getDecoratorName(node);
      if (name && manifest.decoratorMacroNames.has(name)) {
        let title = `$(zap) @${name}`;
        // Count derive args
        if (name === "derive") {
          const expr = node.expression;
          if (ts.isCallExpression(expr)) {
            title += ` — ${expr.arguments.length} derives`;
          }
        }
        lenses.push({
          range: makeRange(node),
          command: {
            title,
            command: "typesugar.expandMacro",
            arguments: [uri, node.getStart(sourceFile)],
          },
        });
      }
    }

    // Labeled blocks
    if (ts.isLabeledStatement(node)) {
      const name = node.label.text;
      // Only create lens for opening labels (not continuations like yield/pure)
      if (manifest.labeledBlockLabels.has(name)) {
        const entry = manifest.current.macros.labeledBlock[name];
        if (entry) {
          // This is a primary label
          lenses.push({
            range: makeRange(node),
            command: {
              title: `$(zap) ${name}: comprehension`,
              command: "typesugar.expandMacro",
              arguments: [uri, node.getStart(sourceFile)],
            },
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return lenses;
}
