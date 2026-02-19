/**
 * Semantic Token Provider — manifest-driven macro highlighting.
 *
 * Walks the TypeScript AST of each document and emits semantic tokens for
 * macro invocations, decorators, tagged templates, extension methods, derive
 * arguments, and comprehension bind variables. All macro names come from the
 * manifest, so adding a new macro automatically gets highlighting.
 */

import * as vscode from "vscode";
import * as ts from "typescript";
import type { ManifestLoader } from "./manifest.js";

// ---------------------------------------------------------------------------
// Token Legend
// ---------------------------------------------------------------------------

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

export const LEGEND = new vscode.SemanticTokensLegend(
  [...TOKEN_TYPES],
  [...TOKEN_MODIFIERS],
);

const TokenTypeIndex = Object.fromEntries(
  TOKEN_TYPES.map((t, i) => [t, i]),
) as Record<(typeof TOKEN_TYPES)[number], number>;

const TokenModIndex = Object.fromEntries(
  TOKEN_MODIFIERS.map((m, i) => [m, 1 << i]),
) as Record<(typeof TOKEN_MODIFIERS)[number], number>;

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class MacroSemanticTokensProvider
  implements vscode.DocumentSemanticTokensProvider
{
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeSemanticTokens = this.onDidChangeEmitter.event;

  constructor(private readonly manifest: ManifestLoader) {
    // Re-tokenize all open documents when the manifest changes
    manifest.onDidChange(() => this.onDidChangeEmitter.fire());
  }

  provideDocumentSemanticTokens(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(LEGEND);
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
    const extensionNames = this.manifest.extensionMethodNames;
    const deriveArgs = this.manifest.deriveArgNames;
    const labelNames = this.manifest.labeledBlockLabels;

    const visit = (node: ts.Node): void => {
      // --- Expression macros: comptime(...), ops(...), Do(...) ---
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        expressionNames.has(node.expression.text)
      ) {
        const name = node.expression;
        const isComptime = name.text === "comptime";
        this.pushToken(
          builder,
          sourceFile,
          name,
          isComptime ? "comptimeBlock" : "macro",
          isComptime ? TokenModIndex.comptime : TokenModIndex.macro,
        );
      }

      // --- Tagged template macros: sql`...`, units`...` ---
      if (
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        templateNames.has(node.tag.text)
      ) {
        this.pushToken(
          builder,
          sourceFile,
          node.tag,
          "macroTemplate",
          TokenModIndex.macro,
        );
      }

      // --- Decorator macros: @derive(...), @operators(...) ---
      if (ts.isDecorator(node)) {
        const name = this.getDecoratorName(node);
        if (name && decoratorNames.has(name.text)) {
          this.pushToken(
            builder,
            sourceFile,
            name,
            "macroDecorator",
            TokenModIndex.macro,
          );

          // Highlight derive arguments: @derive(Eq, Ord, Clone)
          if (name.text === "derive" && ts.isCallExpression(node.expression)) {
            for (const arg of node.expression.arguments) {
              if (ts.isIdentifier(arg) && deriveArgs.has(arg.text)) {
                this.pushToken(builder, sourceFile, arg, "deriveArg", 0);
              } else if (ts.isStringLiteral(arg) && deriveArgs.has(arg.text)) {
                // @derive("Eq", "Ord") — string form
                this.pushToken(builder, sourceFile, arg, "deriveArg", 0);
              }
            }
          }
        }
      }

      // --- Extension methods: x.show(), point.eq(other) ---
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.name) &&
        extensionNames.has(node.name.text)
      ) {
        // Only highlight if the parent is a call expression (x.show())
        // or if it's a bare access (x.show — user might be mid-typing)
        this.pushToken(
          builder,
          sourceFile,
          node.name,
          "extensionMethod",
          TokenModIndex.macro,
        );
      }

      // --- Labeled block comprehensions: let: { ... } ---
      if (ts.isLabeledStatement(node) && labelNames.has(node.label.text)) {
        this.pushToken(
          builder,
          sourceFile,
          node.label,
          "macro",
          TokenModIndex.macro,
        );

        // Walk the block body looking for bind expressions: name << expr
        if (ts.isBlock(node.statement)) {
          this.tokenizeComprehensionBlock(builder, sourceFile, node.statement);
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
    return builder.build();
  }

  /**
   * Walk a comprehension block and highlight bind variables (name << expr).
   */
  private tokenizeComprehensionBlock(
    builder: vscode.SemanticTokensBuilder,
    sourceFile: ts.SourceFile,
    block: ts.Block,
  ): void {
    for (const stmt of block.statements) {
      if (!ts.isExpressionStatement(stmt)) continue;

      // Pattern: name << expr  (parsed as BinaryExpression with << operator)
      if (
        ts.isBinaryExpression(stmt.expression) &&
        stmt.expression.operatorToken.kind ===
          ts.SyntaxKind.LessThanLessThanToken
      ) {
        const left = stmt.expression.left;
        if (ts.isIdentifier(left)) {
          this.pushToken(
            builder,
            sourceFile,
            left,
            "bindVariable",
            TokenModIndex.macro,
          );
        }
      }
    }
  }

  /**
   * Extract the identifier node from a decorator (handles both @name and @name(...)).
   */
  private getDecoratorName(decorator: ts.Decorator): ts.Identifier | undefined {
    const expr = decorator.expression;
    if (ts.isIdentifier(expr)) return expr;
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      return expr.expression;
    }
    return undefined;
  }

  /**
   * Push a semantic token for a given AST node.
   */
  private pushToken(
    builder: vscode.SemanticTokensBuilder,
    sourceFile: ts.SourceFile,
    node: ts.Node,
    type: (typeof TOKEN_TYPES)[number],
    modifiers: number,
  ): void {
    const start = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    const width = node.getWidth(sourceFile);

    builder.push(
      new vscode.Range(
        new vscode.Position(start.line, start.character),
        new vscode.Position(start.line, start.character + width),
      ),
      TOKEN_TYPES[TokenTypeIndex[type]],
      modifiers > 0
        ? TOKEN_MODIFIERS.filter((_, i) => modifiers & (1 << i))
        : [],
    );
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
