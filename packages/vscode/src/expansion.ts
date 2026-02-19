/**
 * Expansion Service — runs the typemacro transformer to get macro expansions.
 *
 * This is the bridge between the VSCode extension and the actual macro system.
 * It manages a TypeScript Program instance, runs the transformer, and caches
 * results for use by CodeLens, inlay hints, and diagnostics.
 *
 * The service is lazy: it only creates the TS program when first needed, and
 * re-uses it across requests. It invalidates on file save.
 */

import * as vscode from "vscode";
import * as ts from "typescript";
import * as path from "path";

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

export interface ExpansionResult {
  /** The expanded source text (full file after macro expansion) */
  expandedText: string;

  /** Map from comptime call position → computed value */
  comptimeResults: Map<number, unknown>;

  /** Map from bind variable position → inferred type string */
  bindTypes: Map<number, string>;

  /** Diagnostics emitted during expansion */
  diagnostics: ExpansionDiagnostic[];
}

export interface ExpansionDiagnostic {
  message: string;
  severity: "error" | "warning";
  code?: number;
  range?: {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
  };
  /** The expanded code that caused the error (for related info) */
  expansion?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ExpansionService {
  private program: ts.Program | undefined;
  private resultCache = new Map<string, ExpansionResult>();
  private configPath: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // Invalidate cache on file save
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.resultCache.delete(doc.uri.fsPath);
      }),
    );
  }

  /**
   * Get cached expansion result for a document, or compute it.
   */
  async getExpansionResult(
    document: vscode.TextDocument,
  ): Promise<ExpansionResult | undefined> {
    const cached = this.resultCache.get(document.uri.fsPath);
    if (cached) return cached;

    return this.expandFile(document);
  }

  /**
   * Expand a single file by running the typemacro transformer.
   * Returns the expansion result with computed values and diagnostics.
   */
  async expandFile(
    document: vscode.TextDocument,
  ): Promise<ExpansionResult | undefined> {
    try {
      const program = this.getOrCreateProgram(document);
      if (!program) return undefined;

      // Try to dynamically load the transformer
      const transformerModule = await this.loadTransformer();
      if (!transformerModule) return undefined;

      const sourceFile = program.getSourceFile(document.uri.fsPath);
      if (!sourceFile) return undefined;

      const comptimeResults = new Map<number, unknown>();
      const bindTypes = new Map<number, string>();
      const diagnostics: ExpansionDiagnostic[] = [];

      // Run the transformer
      const transformerFactory = transformerModule.default(program, {
        verbose: false,
      });

      let expandedText = "";

      const emitResult = program.emit(
        sourceFile,
        (fileName, text) => {
          if (fileName.endsWith(".js") || fileName.endsWith(".ts")) {
            expandedText = text;
          }
        },
        undefined,
        false,
        { before: [transformerFactory] },
      );

      // Collect diagnostics
      for (const diag of emitResult.diagnostics) {
        if (diag.source === "typemacro" || diag.code === 90000) {
          const message = ts.flattenDiagnosticMessageText(
            diag.messageText,
            "\n",
          );
          let range: ExpansionDiagnostic["range"];

          if (
            diag.file &&
            diag.start !== undefined &&
            diag.length !== undefined
          ) {
            const start = diag.file.getLineAndCharacterOfPosition(diag.start);
            const end = diag.file.getLineAndCharacterOfPosition(
              diag.start + diag.length,
            );
            range = {
              startLine: start.line,
              startChar: start.character,
              endLine: end.line,
              endChar: end.character,
            };
          }

          diagnostics.push({
            message,
            severity:
              diag.category === ts.DiagnosticCategory.Error
                ? "error"
                : "warning",
            code: diag.code,
            range,
          });
        }
      }

      // Extract comptime results by diffing original vs expanded
      this.extractComptimeResults(sourceFile, expandedText, comptimeResults);

      // Extract bind types from the type checker
      this.extractBindTypes(sourceFile, program.getTypeChecker(), bindTypes);

      const result: ExpansionResult = {
        expandedText,
        comptimeResults,
        bindTypes,
        diagnostics,
      };

      this.resultCache.set(document.uri.fsPath, result);
      return result;
    } catch {
      return undefined;
    }
  }

  /**
   * Get the expanded text for a specific macro at a given position.
   * Used by the "Expand macro" command.
   */
  async getExpansionAtPosition(
    document: vscode.TextDocument,
    position: number,
  ): Promise<string | undefined> {
    const result = await this.getExpansionResult(document);
    if (!result) return undefined;

    // For now, return the full expanded file.
    // A more sophisticated version would diff and extract just the
    // expansion at the given position.
    return result.expandedText || undefined;
  }

  private getOrCreateProgram(
    document: vscode.TextDocument,
  ): ts.Program | undefined {
    // Find tsconfig.json
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) return undefined;

    const configPath = ts.findConfigFile(
      workspaceFolder.uri.fsPath,
      ts.sys.fileExists,
      "tsconfig.json",
    );

    // Re-use program if config hasn't changed
    if (this.program && this.configPath === configPath) {
      return this.program;
    }

    if (!configPath) return undefined;

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) return undefined;

    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
    );

    this.program = ts.createProgram(parsed.fileNames, parsed.options);
    this.configPath = configPath;
    return this.program;
  }

  private async loadTransformer(): Promise<
    | {
        default: (
          program: ts.Program,
          config?: unknown,
        ) => ts.TransformerFactory<ts.SourceFile>;
      }
    | undefined
  > {
    try {
      // Try to load from the workspace's node_modules
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders?.length) return undefined;

      const root = workspaceFolders[0].uri.fsPath;
      const transformerPath = path.join(
        root,
        "node_modules",
        "typemacro",
        "dist",
        "transformer.js",
      );

      // Dynamic import
      return await import(transformerPath);
    } catch {
      return undefined;
    }
  }

  /**
   * Extract comptime results by finding comptime() calls in the original
   * source and matching them to literal values in the expanded output.
   */
  private extractComptimeResults(
    sourceFile: ts.SourceFile,
    expandedText: string,
    results: Map<number, unknown>,
  ): void {
    if (!expandedText) return;

    // Parse the expanded output to find replaced comptime calls
    const expandedFile = ts.createSourceFile(
      "expanded.ts",
      expandedText,
      ts.ScriptTarget.Latest,
      true,
    );

    // Walk the original looking for comptime() calls and try to find
    // corresponding literal values in the expanded output at similar positions.
    // This is a heuristic — a proper implementation would use source maps.
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "comptime"
      ) {
        // Look for a variable declaration containing this call
        const parent = node.parent;
        if (
          ts.isVariableDeclaration(parent) &&
          parent.name &&
          ts.isIdentifier(parent.name)
        ) {
          const varName = parent.name.text;
          // Search expanded output for `const varName = <literal>`
          const pattern = new RegExp(
            `(?:const|let|var)\\s+${escapeRegex(varName)}\\s*=\\s*(.+?)(?:;|$)`,
            "m",
          );
          const match = expandedText.match(pattern);
          if (match) {
            try {
              const value = JSON.parse(match[1]);
              results.set(node.getStart(sourceFile), value);
            } catch {
              // Value isn't simple JSON — store as string
              results.set(node.getStart(sourceFile), match[1].trim());
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  /**
   * Extract bind variable types from comprehension blocks using the type checker.
   */
  private extractBindTypes(
    sourceFile: ts.SourceFile,
    checker: ts.TypeChecker,
    types: Map<number, string>,
  ): void {
    const visit = (node: ts.Node): void => {
      if (
        ts.isLabeledStatement(node) &&
        (node.label.text === "let" ||
          node.label.text === "yield" ||
          node.label.text === "pure") &&
        ts.isBlock(node.statement)
      ) {
        for (const stmt of node.statement.statements) {
          if (!ts.isExpressionStatement(stmt)) continue;
          if (
            ts.isBinaryExpression(stmt.expression) &&
            stmt.expression.operatorToken.kind ===
              ts.SyntaxKind.LessThanLessThanToken &&
            ts.isIdentifier(stmt.expression.left)
          ) {
            try {
              const rightType = checker.getTypeAtLocation(
                stmt.expression.right,
              );
              // For monadic types, try to extract the inner type
              const typeStr = checker.typeToString(rightType);
              types.set(stmt.expression.left.getStart(sourceFile), typeStr);
            } catch {
              // Type checker may fail on macro-generated code
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.resultCache.clear();
    this.program = undefined;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
