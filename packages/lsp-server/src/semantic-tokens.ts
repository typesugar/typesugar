/**
 * Semantic token computation for the LSP server.
 *
 * Walks the TypeScript AST and identifies macro-related tokens using the manifest.
 * Ported from packages/vscode/src/semantic-tokens.ts.
 */

import * as ts from "typescript";
import type { ManifestState } from "./manifest.js";
import type { SemanticTokensLegend, SemanticTokens } from "vscode-languageserver/node.js";
import { getDecoratorName } from "./helpers.js";

// Token types and modifiers — must match the legend sent to the client
export const TOKEN_TYPES = [
  "macro",
  "macroDecorator",
  "macroTemplate",
  "extensionMethod",
  "deriveArg",
  "bindVariable",
  "comptimeBlock",
] as const;

export const TOKEN_MODIFIERS = ["macro", "comptime"] as const;

const TOKEN_TYPE_INDEX = new Map(TOKEN_TYPES.map((t, i) => [t, i]));
const TOKEN_MODIFIER_INDEX = new Map(TOKEN_MODIFIERS.map((m, i) => [m, i]));

export function getSemanticTokensLegend(): SemanticTokensLegend {
  return {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [...TOKEN_MODIFIERS],
  };
}

interface TokenData {
  line: number;
  startChar: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

function modifierBit(name: (typeof TOKEN_MODIFIERS)[number]): number {
  const idx = TOKEN_MODIFIER_INDEX.get(name);
  return idx !== undefined ? 1 << idx : 0;
}

export function computeSemanticTokens(
  text: string,
  fileName: string,
  manifest: ManifestState
): SemanticTokens {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".stsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const tokens: TokenData[] = [];

  function pushToken(
    node: ts.Node,
    typeName: (typeof TOKEN_TYPES)[number],
    modifiers: (typeof TOKEN_MODIFIERS)[number][] = []
  ): void {
    const start = node.getStart(sourceFile);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
    const length = node.getEnd() - start;
    const typeIdx = TOKEN_TYPE_INDEX.get(typeName);
    if (typeIdx === undefined) return;

    let modBits = 0;
    for (const m of modifiers) {
      modBits |= modifierBit(m);
    }

    tokens.push({
      line,
      startChar: character,
      length,
      tokenType: typeIdx,
      tokenModifiers: modBits,
    });
  }

  function visit(node: ts.Node): void {
    // Expression macros: comptime(...), summon(...), etc.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (manifest.expressionMacroNames.has(name)) {
        if (name === "comptime") {
          pushToken(node.expression, "comptimeBlock", ["comptime"]);
        } else {
          pushToken(node.expression, "macro", ["macro"]);
        }
      }
    }

    // Tagged template macros: sql`...`, etc.
    if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag)) {
      if (manifest.taggedTemplateMacroNames.has(node.tag.text)) {
        pushToken(node.tag, "macroTemplate", ["macro"]);
      }
    }

    // Decorator macros: @derive(...), @typeclass, etc.
    if (ts.isDecorator(node)) {
      const name = getDecoratorName(node);
      if (name && manifest.decoratorMacroNames.has(name)) {
        // Token the decorator name (not the @)
        const expr = node.expression;
        const nameNode = ts.isCallExpression(expr) ? expr.expression : expr;
        pushToken(nameNode, "macroDecorator", ["macro"]);

        // Derive arguments: @derive("Eq", "Ord")
        if (name === "derive" && ts.isCallExpression(expr)) {
          for (const arg of expr.arguments) {
            if (
              (ts.isStringLiteral(arg) || ts.isIdentifier(arg)) &&
              manifest.deriveArgNames.has(arg.text)
            ) {
              pushToken(arg, "deriveArg");
            }
          }
        }
      }
    }

    // Extension methods: foo.show(), foo.eq(bar)
    if (ts.isPropertyAccessExpression(node)) {
      if (manifest.extensionMethodNames.has(node.name.text)) {
        pushToken(node.name, "extensionMethod");
      }
    }

    // Labeled blocks (comprehensions): let: { ... }
    if (ts.isLabeledStatement(node)) {
      if (manifest.labeledBlockLabels.has(node.label.text)) {
        pushToken(node.label, "macro", ["macro"]);

        // Bind variables: x << expr
        visitBindVariables(node.statement);
      }
    }

    ts.forEachChild(node, visit);
  }

  function visitBindVariables(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken
    ) {
      if (ts.isIdentifier(node.left)) {
        pushToken(node.left, "bindVariable");
      }
    }
    ts.forEachChild(node, visitBindVariables);
  }

  visit(sourceFile);

  // Sort tokens by position (line, then character)
  tokens.sort((a, b) => a.line - b.line || a.startChar - b.startChar);

  // Encode as delta format per LSP spec
  const data: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const token of tokens) {
    const deltaLine = token.line - prevLine;
    const deltaChar = deltaLine === 0 ? token.startChar - prevChar : token.startChar;

    data.push(deltaLine, deltaChar, token.length, token.tokenType, token.tokenModifiers);

    prevLine = token.line;
    prevChar = token.startChar;
  }

  return { data };
}
