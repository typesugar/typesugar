/**
 * Expansion Service — runs the typesugar transformer to get macro expansions.
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

  /** Focused view showing only expansion sites with context */
  focusedView: string;

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
  private resultCache = new Map<string, ExpansionResult>();
  private readonly disposables: vscode.Disposable[] = [];
  readonly log: (msg: string) => void;

  constructor() {
    const channel = vscode.window.createOutputChannel("Typesugar Expansion");
    this.log = (msg: string) => channel.appendLine(`[${new Date().toISOString()}] ${msg}`);

    // Invalidate cache on file save
    this.disposables.push(
      channel,
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.resultCache.delete(doc.uri.fsPath);
      })
    );
  }

  /**
   * Get cached expansion result for a document, or compute it.
   */
  async getExpansionResult(document: vscode.TextDocument): Promise<ExpansionResult | undefined> {
    const cached = this.resultCache.get(document.uri.fsPath);
    if (cached) {
      this.log(`getExpansionResult: cache hit for ${document.uri.fsPath}, expandedText length: ${cached.expandedText.length}`);
      return cached;
    }

    this.log(`getExpansionResult: cache miss, calling expandFile`);
    const result = await this.expandFile(document);
    this.log(`getExpansionResult: expandFile returned ${result ? `result with expandedText length ${result.expandedText.length}` : "undefined"}`);
    return result;
  }

  /**
   * Expand a single file by running the typesugar transformer.
   * Returns the expansion result with computed values and diagnostics.
   */
  async expandFile(document: vscode.TextDocument): Promise<ExpansionResult | undefined> {
    try {
      this.log(`expandFile: ${document.uri.fsPath}`);

      const transformerModule = await this.loadTransformer();
      if (!transformerModule) {
        this.log("expandFile: failed to load transformer module");
        return undefined;
      }

      const transformCode = transformerModule.transformCode;
      const formatExpansionsFn = transformerModule.formatExpansions;
      if (typeof transformCode !== "function") {
        this.log("expandFile: transformer module has no transformCode function");
        return undefined;
      }

      const code = document.getText();
      this.log(`expandFile: running transformCode on ${document.uri.fsPath} (${code.length} chars)`);

      const transformResult = transformCode(code, {
        fileName: document.uri.fsPath,
        preserveBlankLines: true,
      });

      this.log(`expandFile: transformCode returned, changed=${transformResult.changed}, code=${transformResult.code.length} chars, diagnostics=${transformResult.diagnostics?.length ?? 0}`);

      const expandedText = transformResult.changed ? transformResult.code : "";
      const focusedView =
        typeof formatExpansionsFn === "function" && transformResult.changed
          ? formatExpansionsFn(transformResult)
          : "";
      const comptimeResults = new Map<number, unknown>();
      const bindTypes = new Map<number, string>();
      const diagnostics: ExpansionDiagnostic[] = [];

      for (const diag of transformResult.diagnostics ?? []) {
        diagnostics.push({
          message: diag.message ?? String(diag),
          severity: diag.category === "error" ? "error" : "warning",
        });
      }

      if (expandedText) {
        const sourceFile = ts.createSourceFile(
          document.fileName,
          code,
          ts.ScriptTarget.Latest,
          true
        );
        this.extractComptimeResults(sourceFile, expandedText, comptimeResults);
      }

      const result: ExpansionResult = {
        expandedText,
        focusedView,
        comptimeResults,
        bindTypes,
        diagnostics,
      };

      if (result.expandedText) {
        this.resultCache.set(document.uri.fsPath, result);
      }
      return result;
    } catch (err) {
      this.log(`expandFile error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      return undefined;
    }
  }

  /**
   * Get the expansion for the specific macro at the given position.
   *
   * Returns `{ original, expanded }` for just the macro call at/near the
   * cursor, not the entire file. Falls back to the focused diff view if
   * no specific expansion record matches the position.
   */
  async getExpansionAtPosition(
    document: vscode.TextDocument,
    position: number
  ): Promise<{ original: string; expanded: string } | undefined> {
    try {
      const mod = await this.loadTransformer();
      if (!mod?.transformCode) return undefined;

      const transformCode = mod.transformCode as (
        code: string,
        options?: { fileName?: string; preserveBlankLines?: boolean }
      ) => {
        code: string;
        changed: boolean;
        original: string;
        expansions?: Array<{
          macroName: string;
          originalStart: number;
          originalEnd: number;
          originalText: string;
          expandedText: string;
        }>;
      };

      const code = document.getText();
      const result = transformCode(code, {
        fileName: document.uri.fsPath,
        preserveBlankLines: true,
      });

      if (!result.changed) return undefined;

      // If we have expansion records, find the one at/near the cursor
      if (result.expansions?.length) {
        // Find the expansion whose range contains or is nearest to the position
        let best = result.expansions[0];
        let bestDist = Infinity;

        for (const exp of result.expansions) {
          if (position >= exp.originalStart && position <= exp.originalEnd) {
            best = exp;
            bestDist = 0;
            break;
          }
          const dist = Math.min(
            Math.abs(position - exp.originalStart),
            Math.abs(position - exp.originalEnd)
          );
          if (dist < bestDist) {
            bestDist = dist;
            best = exp;
          }
        }

        return {
          original: best.originalText,
          expanded: best.expandedText,
        };
      }

      // No expansion records — fall back to focused diff
      const formatExpansionsFn = mod.formatExpansions as
        | ((r: { original: string; code: string; changed: boolean }) => string)
        | undefined;

      if (typeof formatExpansionsFn === "function") {
        return {
          original: "(full file)",
          expanded: formatExpansionsFn(result),
        };
      }

      return undefined;
    } catch (err) {
      this.log(`getExpansionAtPosition error: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /**
   * Get the fully transformed source for a file.
   * Uses the TransformationPipeline for preprocessing and macro expansion.
   * Used by the "Show Transformed" command.
   */
  async getTransformedFile(document: vscode.TextDocument): Promise<{ code: string; focusedView: string } | undefined> {
    try {
      const mod = await this.loadTransformer();
      if (!mod?.transformCode) return undefined;

      const transformCode = mod.transformCode as (
        code: string,
        options?: { fileName?: string; preserveBlankLines?: boolean }
      ) => { code: string; changed: boolean; original: string };

      const formatExpansionsFn = mod.formatExpansions as
        | ((result: { original: string; code: string; changed: boolean }) => string)
        | undefined;

      const result = transformCode(document.getText(), {
        fileName: document.uri.fsPath,
        preserveBlankLines: true,
      });

      if (!result.changed) return undefined;

      const focusedView =
        typeof formatExpansionsFn === "function" ? formatExpansionsFn(result) : "";

      return { code: result.code, focusedView };
    } catch (error) {
      this.log(`getTransformedFile error: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private cachedTransformerModule: Record<string, unknown> | undefined;

  private async loadTransformer(): Promise<Record<string, unknown> | undefined> {
    if (this.cachedTransformerModule) return this.cachedTransformerModule;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      this.log("loadTransformer: no workspace folders");
      return undefined;
    }

    const root = workspaceFolders[0].uri.fsPath;

    const candidates = [
      path.join(root, "node_modules", "@typesugar", "transformer", "dist", "index.js"),
      path.join(root, "node_modules", "typesugar", "dist", "index.js"),
    ];

    for (const candidate of candidates) {
      try {
        this.log(`loadTransformer: trying ${candidate}`);
        // Bust Node's require cache so we always get the latest build
        const resolved = require.resolve(candidate);
        delete require.cache[resolved];
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(candidate);
        this.log(`loadTransformer: loaded from ${candidate}, keys: ${Object.keys(mod).join(", ")}`);
        this.cachedTransformerModule = mod;
        return mod;
      } catch (err) {
        this.log(`loadTransformer: failed ${candidate}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }

    return undefined;
  }

  /** Force the transformer to be reloaded on next use (e.g., after rebuild). */
  reloadTransformer(): void {
    this.cachedTransformerModule = undefined;
    this.resultCache.clear();
  }

  /**
   * Extract comptime results by finding comptime() calls in the original
   * source and matching them to literal values in the expanded output.
   */
  private extractComptimeResults(
    sourceFile: ts.SourceFile,
    expandedText: string,
    results: Map<number, unknown>
  ): void {
    if (!expandedText) return;

    // Parse the expanded output to find replaced comptime calls
    const expandedFile = ts.createSourceFile(
      "expanded.ts",
      expandedText,
      ts.ScriptTarget.Latest,
      true
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
        if (ts.isVariableDeclaration(parent) && parent.name && ts.isIdentifier(parent.name)) {
          const varName = parent.name.text;
          // Search expanded output for `const varName = <literal>`
          const pattern = new RegExp(
            `(?:const|let|var)\\s+${escapeRegex(varName)}\\s*=\\s*(.+?)(?:;|$)`,
            "m"
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
    types: Map<number, string>
  ): void {
    const visit = (node: ts.Node): void => {
      if (
        ts.isLabeledStatement(node) &&
        (node.label.text === "let" || node.label.text === "yield" || node.label.text === "pure") &&
        ts.isBlock(node.statement)
      ) {
        for (const stmt of node.statement.statements) {
          if (!ts.isExpressionStatement(stmt)) continue;
          if (
            ts.isBinaryExpression(stmt.expression) &&
            stmt.expression.operatorToken.kind === ts.SyntaxKind.LessThanLessThanToken &&
            ts.isIdentifier(stmt.expression.left)
          ) {
            try {
              const rightType = checker.getTypeAtLocation(stmt.expression.right);
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
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
