/**
 * typesugar Standalone LSP Server
 *
 * Provides macro-aware IDE features (diagnostics, completions, hover,
 * go-to-definition, rename, etc.) for any editor that supports LSP.
 *
 * Architecture:
 * 1. Creates a TypeScript LanguageService with a custom LanguageServiceHost
 * 2. Intercepts getScriptSnapshot to serve transformed (macro-expanded) code
 * 3. Maps all positions bidirectionally between original and transformed coordinates
 * 4. Applies diagnostic suppression rules to macro-generated code whose
 *    positions can't be mapped back to the original source
 *
 * Usage: typesugar-lsp --stdio
 *
 * This module OPENS THE CONNECTION AT LOAD TIME — it is the bin/script entry
 * (`dist/server.js`, `dist/server.cjs`, `dist/server-bundled.cjs`), never the
 * package's library entry. Import `src/index.ts` ("." export) for the pure
 * helpers.
 */

import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItemKind,
  DiagnosticSeverity,
  DocumentHighlightKind,
  CodeActionKind,
  type InitializeParams,
  type TextDocumentPositionParams,
  type CompletionItem,
  type Hover,
  type Definition,
  type Location,
  type ReferenceParams,
  type DocumentHighlight,
  type SignatureHelp,
  type RenameParams,
  type WorkspaceEdit,
  type PrepareRenameParams,
  type CodeActionParams,
  type CodeAction,
  type Diagnostic,
  type Range,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  uriToFileName,
  fileNameToUri,
  normalizeFileName,
  mapTsDiagnosticToOriginal,
} from "./helpers.js";
import {
  TransformationPipeline,
  transformCode,
  type TransformResult,
  type TransformDiagnostic,
} from "@typesugar/transformer/pipeline";
import {
  IdentityPositionMapper,
  type PositionMapper,
} from "@typesugar/transformer/position-mapper";
import {
  config,
  filterDiagnostics,
  getDiagnosticSuppressionRules,
  assertSupportedTypeScript,
  type PositionMapFn,
} from "@typesugar/core";
import {
  registerAllDiagnosticSuppressionRules,
  setComptimeEvaluationEnabled,
} from "@typesugar/macros";
import {
  mapTextSpanToOriginal,
  offsetToPosition,
  positionToOffset,
  textSpanToRange,
  computeMacroCodeActions,
} from "@typesugar/lsp-common";
import { ManifestState } from "./manifest.js";
import { computeSemanticTokens, getSemanticTokensLegend } from "./semantic-tokens.js";
import { computeCodeLenses } from "./codelens.js";
import { computeInlayHints } from "./inlay-hints.js";
import { announceDeprecation } from "./deprecation.js";

// ---------------------------------------------------------------------------
// Connection setup (fix #9: always let vscode-languageserver auto-detect
// transport from argv; the bin script ensures --stdio is present)
// ---------------------------------------------------------------------------

// PEP-060 item 1: refuse to start on TypeScript 7 (no JS compiler API) with one
// clear message on stderr, which the editor shows in the server's output.
assertSupportedTypeScript(ts);

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// tooling #14: a throw that escapes a timer or a promise (the debounced
// diagnostics, a transformer bug) must not kill the server — the client would
// restart it, it would hit the same file again, and crash-loop. Log it instead.
process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
});
process.on("unhandledRejection", (reason) => {
  log(
    `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`
  );
});

let workspaceRoot = "";
/** Directory of the tsconfig in use (or the workspace root without one). */
let projectDir = "";
/**
 * Whether comptime blocks are evaluated in the editor. Off unless the client
 * opts in (initializationOptions.comptimeInEditor or
 * TYPESUGAR_COMPTIME_IN_EDITOR=1): opening an unreviewed repository must not
 * execute its comptime code.
 */
let comptimeInEditor = false;
let languageService: ts.LanguageService | null = null;
let pipeline: TransformationPipeline | null = null;
let pipelineGeneration = 0; // Incremented on pipeline recreation to bust TS language service cache
let currentCompilerOptions: ts.CompilerOptions = {};
const manifest = new ManifestState();

// Transform cache
interface TransformCacheEntry {
  result: TransformResult;
  version: string;
}
const transformCache = new Map<string, TransformCacheEntry>();
const rawMacroDiagnosticCache = new Map<string, TransformDiagnostic[]>();

interface StoredSuggestion {
  description: string;
  start: number;
  length: number;
  replacement: string;
}
const suggestionCache = new Map<string, StoredSuggestion[]>();

// File tracking
let projectFileNames: string[] = [];

// Diagnostic debounce timers (fix #6)
const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DIAGNOSTIC_DELAY_MS = 300;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  connection.console.log(`[typesugar-lsp] ${msg}`);
}

/**
 * Wrap an LSP handler so that uncaught exceptions return a fallback value
 * instead of crashing the server (which resets the connection for the client).
 */
function safeHandler<P, R>(fallback: R, handler: (params: P) => R): (params: P) => R {
  return (params: P): R => {
    try {
      return handler(params);
    } catch (e) {
      log(`Handler error: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function loadTsConfig(rootDir: string): {
  compilerOptions: ts.CompilerOptions;
  fileNames: string[];
} {
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
  projectDir = configPath ? path.dirname(configPath) : rootDir;
  if (!configPath) {
    log("No tsconfig.json found, using defaults");
    return {
      compilerOptions: ts.getDefaultCompilerOptions(),
      fileNames: [],
    };
  }

  log(`Loading tsconfig from ${configPath}`);
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    log(
      `Error reading tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
    );
    return {
      compilerOptions: ts.getDefaultCompilerOptions(),
      fileNames: [],
    };
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
  return {
    compilerOptions: parsed.options,
    fileNames: parsed.fileNames.map((f) => normalizeFileName(f)),
  };
}

// ---------------------------------------------------------------------------
// Document content helpers (fix #2: use proper URI-based document lookup)
// ---------------------------------------------------------------------------

function getOriginalContent(fileName: string): string | undefined {
  const normalizedFileName = normalizeFileName(fileName);
  // Use vscode-uri to construct the URI the editor would use
  const uri = fileNameToUri(normalizedFileName);
  const doc = documents.get(uri);
  if (doc) {
    return doc.getText();
  }
  // Read from disk
  try {
    return fs.readFileSync(normalizedFileName, "utf-8");
  } catch {
    return undefined;
  }
}

function getFileVersion(fileName: string): string {
  const normalizedFileName = normalizeFileName(fileName);
  const uri = fileNameToUri(normalizedFileName);
  const doc = documents.get(uri);
  if (doc) {
    return doc.version.toString();
  }
  // Use disk modification time
  try {
    return fs.statSync(normalizedFileName).mtimeMs.toString();
  } catch {
    return "0";
  }
}

// ---------------------------------------------------------------------------
// Pipeline lifecycle
// ---------------------------------------------------------------------------

function createPipeline(compilerOptions: ts.CompilerOptions): void {
  currentCompilerOptions = compilerOptions;
  pipelineGeneration++;
  // Editor hosts must not run comptime code unless the user opted in.
  setComptimeEvaluationEnabled(comptimeInEditor);
  // Read typesugar.config.* for THIS project, not whatever is above the
  // server process's cwd.
  try {
    config.load({ searchFrom: projectDir || workspaceRoot });
    const loadError = config.getLoadError();
    if (loadError) {
      connection.window.showWarningMessage(
        `typesugar: config file not applied (${loadError.kind}): ${loadError.message}`
      );
    }
  } catch (e) {
    log(`Failed to load typesugar config: ${e instanceof Error ? e.message : String(e)}`);
  }
  pipeline = new TransformationPipeline(compilerOptions, projectFileNames, {
    verbose: false,
    readFile: (f: string) => getOriginalContent(f),
    fileExists: (f: string) => ts.sys.fileExists(f),
  });
  // Clear transform caches when pipeline is recreated
  transformCache.clear();
  rawMacroDiagnosticCache.clear();
  suggestionCache.clear();

  // Pre-transform all project files in deterministic order.
  // This populates global macro registries (instanceRegistry, etc.) consistently.
  // Without this, files get transformed in random order driven by the TS language
  // service, and the registries end up in different states each time.
  for (const fn of projectFileNames) {
    if (pipeline.shouldTransform(fn)) {
      try {
        const result = pipeline.transform(fn);
        transformCache.set(fn, { result, version: getFileVersion(fn) });
        if (result.diagnostics.length > 0) {
          rawMacroDiagnosticCache.set(fn, result.diagnostics);
        }
      } catch {
        // Non-fatal — individual file transform errors are handled later
      }
    }
  }
  log(
    `Pipeline created, pre-transformed ${projectFileNames.filter((f) => pipeline!.shouldTransform(f)).length} files`
  );
}

// ---------------------------------------------------------------------------
// Transform layer (fix #3: getTransformResult uses getFileVersion which is
// independent of the host's getScriptVersion, avoiding recursion)
// ---------------------------------------------------------------------------

function getTransformResult(fileName: string): TransformResult | null {
  const normalizedFileName = normalizeFileName(fileName);

  if (!pipeline) return null;

  if (!pipeline.shouldTransform(normalizedFileName)) {
    return null;
  }

  const currentVersion = getFileVersion(normalizedFileName);
  const cached = transformCache.get(normalizedFileName);

  if (cached && cached.version === currentVersion) {
    return cached.result;
  }

  // Invalidate stale cache
  if (cached) {
    pipeline.invalidate(normalizedFileName);
  }
  rawMacroDiagnosticCache.delete(normalizedFileName);
  suggestionCache.delete(normalizedFileName);

  try {
    const result = pipeline.transform(normalizedFileName);

    log(
      `Transform ${path.basename(normalizedFileName)}: changed=${result.changed}, diags=${result.diagnostics.length}, code=${result.code.length} chars`
    );

    if (result.diagnostics.length > 0) {
      rawMacroDiagnosticCache.set(normalizedFileName, result.diagnostics);
      for (const d of result.diagnostics) {
        log(`  macro diag: ${d.message.substring(0, 100)}`);
      }
    } else {
      rawMacroDiagnosticCache.delete(normalizedFileName);
    }

    transformCache.set(normalizedFileName, { result, version: currentVersion });
    return result;
  } catch (error) {
    log(`Transform error for ${normalizedFileName}: ${error}`);
    return null;
  }
}

function getMapper(fileName: string): PositionMapper {
  const result = getTransformResult(fileName);
  return result?.mapper ?? new IdentityPositionMapper();
}

// ---------------------------------------------------------------------------
// LanguageServiceHost (fix #3: getScriptVersion does NOT call
// getTransformResult — it uses a separate version scheme to avoid recursion.
// The transform cache is keyed on getFileVersion which is independent.)
// ---------------------------------------------------------------------------

function createLanguageServiceHost(compilerOptions: ts.CompilerOptions): ts.LanguageServiceHost {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => projectFileNames,

    getScriptVersion: (fileName: string) => {
      const normalizedFileName = normalizeFileName(fileName);
      // Use getFileVersion (doc version or mtime) as the base.
      // When the file has been transformed, append transform code length
      // to bust the TS cache. Crucially, we check the transformCache
      // directly instead of calling getTransformResult to avoid a
      // transform → getScriptVersion → transform loop.
      const baseVersion = getFileVersion(normalizedFileName);
      const cached = transformCache.get(normalizedFileName);
      if (cached && cached.result.changed && cached.version === baseVersion) {
        return `${baseVersion}-g${pipelineGeneration}-ts-${cached.result.code.length}`;
      }

      return `${baseVersion}-g${pipelineGeneration}`;
    },

    getScriptSnapshot: (fileName: string) => {
      const normalizedFileName = normalizeFileName(fileName);

      // Skip transformation for declaration files and node_modules —
      // these can never be macro-transformed and reading them directly
      // avoids unnecessary pipeline calls (especially for 60+ lib.d.ts files)
      if (normalizedFileName.endsWith(".d.ts") || normalizedFileName.includes("node_modules")) {
        const content = getOriginalContent(normalizedFileName);
        return content !== undefined ? ts.ScriptSnapshot.fromString(content) : undefined;
      }

      // Try pipeline transformation first
      const result = getTransformResult(normalizedFileName);
      if (result?.changed) {
        return ts.ScriptSnapshot.fromString(result.code);
      }

      // Regular files
      const content = getOriginalContent(normalizedFileName);
      if (content !== undefined) {
        return ts.ScriptSnapshot.fromString(content);
      }

      return undefined;
    },

    getCompilationSettings: () => compilerOptions,
    getCurrentDirectory: () => workspaceRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),

    fileExists: (fileName: string) => ts.sys.fileExists(fileName),

    readFile: (fileName: string) => {
      return getOriginalContent(fileName);
    },

    directoryExists: (dirName: string) => ts.sys.directoryExists(dirName),
    getDirectories: (dirName: string) => ts.sys.getDirectories(dirName),

    resolveModuleNames: (
      moduleNames: string[],
      containingFile: string,
      _reusedNames: string[] | undefined,
      redirectedReference: ts.ResolvedProjectReference | undefined,
      options: ts.CompilerOptions
    ): (ts.ResolvedModule | undefined)[] => {
      return moduleNames.map((moduleName) => {
        const result = ts.resolveModuleName(
          moduleName,
          containingFile,
          options,
          {
            fileExists: host.fileExists!,
            readFile: (f) => host.readFile?.(f),
            directoryExists: host.directoryExists,
            getCurrentDirectory: () => workspaceRoot,
            getDirectories: host.getDirectories,
          },
          undefined,
          redirectedReference
        );

        return result.resolvedModule;
      });
    },
  };

  return host;
}

// ---------------------------------------------------------------------------
// Diagnostic suppression registration
// ---------------------------------------------------------------------------

function registerDiagnosticSuppressionRules(): void {
  const positionMapFn: PositionMapFn = (
    fileName: string,
    transformedPos: number
  ): number | null => {
    const mapper = getMapper(fileName);
    return mapper.toOriginal(transformedPos);
  };

  registerAllDiagnosticSuppressionRules({ positionMapFn });
}

// ---------------------------------------------------------------------------
// Diagnostic helpers
// ---------------------------------------------------------------------------

function convertTransformDiagnostic(diag: TransformDiagnostic, originalText: string): Diagnostic {
  const range = {
    start: offsetToPosition(originalText, diag.start),
    end: offsetToPosition(originalText, diag.start + diag.length),
  };

  return {
    range,
    severity: diag.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    code: diag.code ?? 9999,
    source: "typesugar",
    message: diag.message,
  };
}

/** See mapTsDiagnosticToOriginal (helpers.ts) — deep-review tooling #24. */
function mapTsDiagnostic(
  diag: ts.Diagnostic,
  mapper: PositionMapper,
  transformedCode: string,
  originalText: string
): ts.Diagnostic | null {
  return mapTsDiagnosticToOriginal(diag, mapper, transformedCode, originalText);
}

function getDiagnosticsForFile(fileName: string): Diagnostic[] {
  if (!languageService) return [];

  const normalizedFileName = normalizeFileName(fileName);
  const originalText = getOriginalContent(normalizedFileName);
  if (!originalText) return [];

  // Run transformation and capture its diagnostics directly.
  // Don't rely on rawMacroDiagnosticCache — it can be overwritten by other code
  // paths (e.g., getScriptSnapshot) that re-transform between calls.
  const transformResult = getTransformResult(normalizedFileName);
  const transformDiags = transformResult?.diagnostics ?? [];

  const mapper = transformResult?.mapper ?? new IdentityPositionMapper();
  const diagnostics: Diagnostic[] = [];

  // Get TS diagnostics and map them back
  const semanticDiags = languageService.getSemanticDiagnostics(normalizedFileName);
  const syntacticDiags = languageService.getSyntacticDiagnostics(normalizedFileName);
  const allTsDiags = [...syntacticDiags, ...semanticDiags];

  log(
    `getDiagnosticsForFile ${path.basename(normalizedFileName)}: ${allTsDiags.length} raw TS diags`
  );

  // Apply diagnostic suppression filtering
  const program = languageService.getProgram();
  let filtered: readonly ts.Diagnostic[];
  if (program && getDiagnosticSuppressionRules().length > 0) {
    const checker = program.getTypeChecker();
    // Per-call context: suppression runs against THIS program and this
    // server's position mapping, not whatever another host registered.
    filtered = filterDiagnostics(allTsDiags, checker, (fn) => program.getSourceFile(fn), {
      program,
      positionMapFn: (fn, pos) => getMapper(fn).toOriginal(pos),
    });
  } else {
    filtered = allTsDiags;
  }

  const suppressedCount = allTsDiags.length - filtered.length;
  log(`  After diagnostic suppression: ${filtered.length} (suppressed ${suppressedCount})`);
  if (suppressedCount > 0) {
    for (const diag of allTsDiags) {
      if (!filtered.includes(diag)) {
        log(
          `  SUPPRESSED: TS${diag.code} at pos ${diag.start}: ${ts.flattenDiagnosticMessageText(diag.messageText, " ").substring(0, 100)}`
        );
      }
    }
  }

  // Map positions back and convert to LSP format
  let droppedByMapper = 0;
  for (const diag of filtered) {
    const mapped = mapTsDiagnostic(
      diag,
      mapper,
      transformResult?.code ?? originalText,
      originalText
    );
    if (!mapped || mapped.start === undefined) {
      droppedByMapper++;
      if (droppedByMapper <= 10) {
        log(
          `  Dropped by mapper: TS${diag.code} at pos ${diag.start} — ${ts.flattenDiagnosticMessageText(diag.messageText, " ").substring(0, 80)}`
        );
      }
      continue;
    }

    const range = {
      start: offsetToPosition(originalText, mapped.start),
      end: offsetToPosition(originalText, mapped.start + (mapped.length ?? 1)),
    };

    diagnostics.push({
      range,
      severity:
        mapped.category === ts.DiagnosticCategory.Error
          ? DiagnosticSeverity.Error
          : mapped.category === ts.DiagnosticCategory.Warning
            ? DiagnosticSeverity.Warning
            : DiagnosticSeverity.Information,
      code: mapped.code,
      source: mapped.source ?? "typescript",
      message: ts.flattenDiagnosticMessageText(mapped.messageText, "\n"),
    });
  }

  if (droppedByMapper > 0) {
    log(`  Dropped by position mapper: ${droppedByMapper}`);
  }

  // Add macro diagnostics from this transform run (not from cache)
  const suggestions: StoredSuggestion[] = [];

  for (const diag of transformDiags) {
    if (normalizeFileName(diag.file) !== normalizedFileName) continue;
    diagnostics.push(convertTransformDiagnostic(diag, originalText));
    if (diag.suggestion) {
      suggestions.push(diag.suggestion);
    }
  }

  if (suggestions.length > 0) {
    suggestionCache.set(normalizedFileName, suggestions);
  } else {
    suggestionCache.delete(normalizedFileName);
  }

  return diagnostics;
}

// fix #6: debounced diagnostic publishing
function publishDiagnostics(uri: string): void {
  const existing = diagnosticTimers.get(uri);
  if (existing) clearTimeout(existing);

  diagnosticTimers.set(
    uri,
    setTimeout(() => {
      diagnosticTimers.delete(uri);
      // tooling #14: a throw here is outside any LSP handler — uncaught, it
      // would kill the server.
      try {
        const fileName = uriToFileName(uri);
        const diagnostics = getDiagnosticsForFile(fileName);
        log(
          `Publishing ${diagnostics.length} diagnostics for ${path.basename(fileName)} (debounced)`
        );
        for (const d of diagnostics) {
          log(`  [${d.source}:${d.code}] L${d.range.start.line}: ${d.message.substring(0, 80)}`);
        }
        connection.sendDiagnostics({ uri, diagnostics });
      } catch (e) {
        log(`Diagnostics failed for ${uri}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, DIAGNOSTIC_DELAY_MS)
  );
}

// Immediate publish (for onDidOpen — user expects results right away)
function publishDiagnosticsImmediate(uri: string): void {
  const existing = diagnosticTimers.get(uri);
  if (existing) clearTimeout(existing);
  diagnosticTimers.delete(uri);

  try {
    const fileName = uriToFileName(uri);
    const diagnostics = getDiagnosticsForFile(fileName);

    log(`Publishing ${diagnostics.length} diagnostics for ${path.basename(fileName)} (immediate)`);
    for (const d of diagnostics) {
      log(`  [${d.source}:${d.code}] L${d.range.start.line}: ${d.message.substring(0, 80)}`);
    }
    connection.sendDiagnostics({ uri, diagnostics });
  } catch (e) {
    log(`Diagnostics failed for ${uri}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Extension method completions (ported from language-service.ts)
// ---------------------------------------------------------------------------

function isFirstParamCompatible(
  checker: ts.TypeChecker,
  fnSymbol: ts.Symbol,
  targetType: ts.Type
): boolean {
  const decl = fnSymbol.getDeclarations()?.[0];
  if (
    !decl ||
    (!ts.isFunctionDeclaration(decl) &&
      !ts.isArrowFunction(decl) &&
      !ts.isFunctionExpression(decl) &&
      !ts.isMethodDeclaration(decl))
  ) {
    return false;
  }

  const signature = checker.getSignatureFromDeclaration(decl as ts.SignatureDeclaration);
  if (!signature) return false;

  const params = signature.getParameters();
  if (params.length === 0) return false;

  const firstParam = params[0];
  const firstParamDecl = firstParam.getDeclarations()?.[0];
  if (!firstParamDecl || !ts.isParameter(firstParamDecl)) return false;

  const firstParamType = checker.getTypeAtLocation(firstParamDecl);
  return checker.isTypeAssignableTo(targetType, firstParamType);
}

function getReceiverTypeAtPosition(
  sourceFile: ts.SourceFile,
  position: number,
  checker: ts.TypeChecker
): ts.Type | null {
  function findNodeAtPosition(node: ts.Node): ts.Node | undefined {
    if (position >= node.getStart() && position <= node.getEnd()) {
      return ts.forEachChild(node, findNodeAtPosition) || node;
    }
    return undefined;
  }

  const node = findNodeAtPosition(sourceFile);
  if (!node) return null;

  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isPropertyAccessExpression(current)) {
      return checker.getTypeAtLocation(current.expression);
    }
    if (current.parent && ts.isPropertyAccessExpression(current.parent)) {
      if (
        current === current.parent.name ||
        (position > current.parent.expression.getEnd() && position <= current.parent.name.getEnd())
      ) {
        return checker.getTypeAtLocation(current.parent.expression);
      }
    }
    current = current.parent;
  }

  return null;
}

function getExtensionCompletions(
  sourceFile: ts.SourceFile,
  receiverType: ts.Type,
  checker: ts.TypeChecker
): ts.CompletionEntry[] {
  const extensions: ts.CompletionEntry[] = [];
  const seen = new Set<string>();

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;

    const clause = stmt.importClause;
    if (!clause) continue;

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const spec of clause.namedBindings.elements) {
        const name = spec.name.text;
        if (seen.has(name)) continue;

        const symbol = checker.getSymbolAtLocation(spec.name);
        if (!symbol) continue;

        const resolved = checker.getAliasedSymbol(symbol);
        const targetSymbol = resolved ?? symbol;

        if (isFirstParamCompatible(checker, targetSymbol, receiverType)) {
          seen.add(name);
          extensions.push({
            name,
            kind: ts.ScriptElementKind.functionElement,
            sortText: "1" + name,
            insertText: `${name}()`,
            labelDetails: { description: "(extension)" },
          });
        }
      }
    }

    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      const namespaceSymbol = checker.getSymbolAtLocation(clause.namedBindings.name);
      if (!namespaceSymbol) continue;

      const exports = checker.getExportsOfModule(namespaceSymbol);
      for (const exp of exports) {
        const name = exp.getName();
        if (seen.has(name)) continue;

        if (isFirstParamCompatible(checker, exp, receiverType)) {
          seen.add(name);
          extensions.push({
            name,
            kind: ts.ScriptElementKind.functionElement,
            sortText: "1" + name,
            insertText: `${name}()`,
            labelDetails: {
              description: `(extension from ${(clause.namedBindings as ts.NamespaceImport).name.text})`,
            },
          });
        }
      }
    }
  }

  return extensions;
}

// ---------------------------------------------------------------------------
// TS CompletionEntry → LSP CompletionItem conversion
// ---------------------------------------------------------------------------

function tsKindToLspKind(kind: ts.ScriptElementKind): CompletionItemKind {
  switch (kind) {
    case ts.ScriptElementKind.functionElement:
    case ts.ScriptElementKind.memberFunctionElement:
    case ts.ScriptElementKind.constructSignatureElement:
      return CompletionItemKind.Function;
    case ts.ScriptElementKind.memberVariableElement:
    case ts.ScriptElementKind.variableElement:
    case ts.ScriptElementKind.localVariableElement:
    case ts.ScriptElementKind.letElement:
    case ts.ScriptElementKind.constElement:
      return CompletionItemKind.Variable;
    case ts.ScriptElementKind.classElement:
      return CompletionItemKind.Class;
    case ts.ScriptElementKind.interfaceElement:
      return CompletionItemKind.Interface;
    case ts.ScriptElementKind.typeElement:
      return CompletionItemKind.TypeParameter;
    case ts.ScriptElementKind.enumElement:
      return CompletionItemKind.Enum;
    case ts.ScriptElementKind.enumMemberElement:
      return CompletionItemKind.EnumMember;
    case ts.ScriptElementKind.moduleElement:
      return CompletionItemKind.Module;
    case ts.ScriptElementKind.keyword:
      return CompletionItemKind.Keyword;
    case ts.ScriptElementKind.memberGetAccessorElement:
    case ts.ScriptElementKind.memberSetAccessorElement:
      return CompletionItemKind.Property;
    default:
      return CompletionItemKind.Property;
  }
}

// ---------------------------------------------------------------------------
// LSP lifecycle
// ---------------------------------------------------------------------------

connection.onInitialize((params: InitializeParams): InitializeResult => {
  workspaceRoot = params.rootUri
    ? uriToFileName(params.rootUri)
    : (params.rootPath ?? process.cwd());

  log(`Initializing with workspace root: ${workspaceRoot}`);

  const initOptions = (params.initializationOptions ?? {}) as { comptimeInEditor?: unknown };
  comptimeInEditor =
    initOptions.comptimeInEditor === true || process.env.TYPESUGAR_COMPTIME_IN_EDITOR === "1";
  log(`comptime evaluation in editor: ${comptimeInEditor ? "ENABLED (opted in)" : "disabled"}`);

  // Load tsconfig
  const { compilerOptions, fileNames: tsFileNames } = loadTsConfig(workspaceRoot);

  projectFileNames = [...new Set(tsFileNames)]; // already normalizeFileName'd

  // Load macro manifest
  if (manifest.load(workspaceRoot)) {
    log(
      `Manifest loaded: ${manifest.expressionMacroNames.size} expression macros, ` +
        `${manifest.decoratorMacroNames.size} decorator macros`
    );
  } else {
    log("No typesugar.manifest.json found, using defaults");
  }

  // Create transformation pipeline
  createPipeline(compilerOptions);

  // Create language service
  const host = createLanguageServiceHost(compilerOptions);
  languageService = ts.createLanguageService(host, ts.createDocumentRegistry());

  // Register diagnostic suppression rules
  registerDiagnosticSuppressionRules();

  log("Language service initialized");

  const semanticTokensLegend = getSemanticTokensLegend();

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      completionProvider: {
        triggerCharacters: [".", '"', "'", "/", "@"],
        resolveProvider: true,
      },
      hoverProvider: true,
      definitionProvider: true,
      typeDefinitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ",", "<"],
      },
      renameProvider: {
        prepareProvider: true,
      },
      codeActionProvider: true,
      semanticTokensProvider: {
        legend: semanticTokensLegend,
        full: true,
      },
      codeLensProvider: {
        resolveProvider: false,
      },
      inlayHintProvider: true,
      executeCommandProvider: {
        commands: [
          "typesugar.expandMacro",
          "typesugar.showTransformed",
          "typesugar.refreshManifest",
        ],
      },
    },
  };
});

connection.onInitialized(() => {
  // PEP-060 D5: not supported in 1.0 — the tsserver plugin is the editor engine.
  announceDeprecation(connection);
  log("Server initialized, publishing initial diagnostics...");

  // Publish diagnostics for all open documents
  for (const doc of documents.all()) {
    publishDiagnosticsImmediate(doc.uri);
  }
});

// fix #7: clean shutdown
connection.onShutdown(() => {
  log("Shutting down...");
  // Clear all pending diagnostic timers
  for (const timer of diagnosticTimers.values()) {
    clearTimeout(timer);
  }
  diagnosticTimers.clear();

  // Dispose the language service
  if (languageService) {
    languageService.dispose();
    languageService = null;
  }
  pipeline = null;
});

connection.onExit(() => {
  process.exit(0);
});

// ---------------------------------------------------------------------------
// Document sync → diagnostics
// ---------------------------------------------------------------------------

documents.onDidOpen((event) => {
  log(`Document opened: ${event.document.uri}`);
  const fileName = uriToFileName(event.document.uri);
  const normalized = normalizeFileName(fileName);

  // tooling #15: add a file outside the tsconfig to the project WITHOUT
  // recreating the pipeline (which re-transformed the whole project
  // synchronously on every such open). The pipeline was constructed with
  // `projectFileNames` and keeps that array (`getFileNames()` returns it), so
  // pushing here extends its root files; `invalidateContent` drops its
  // program so the next transform rebuilds it (reusing the old one). If a
  // future pipeline copies the list instead, fall back to recreating it.
  if (!projectFileNames.includes(normalized)) {
    projectFileNames.push(normalized);
    if (pipeline?.shouldTransform(normalized)) {
      if (pipeline.getFileNames().includes(normalized)) {
        pipeline.invalidateContent(normalized);
        log(`Added ${path.basename(normalized)} to the project`);
      } else if (currentCompilerOptions) {
        createPipeline(currentCompilerOptions);
        log(`Recreated pipeline to include ${path.basename(normalized)}`);
      }
    }
  }

  // Immediate diagnostics on open (no debounce)
  publishDiagnosticsImmediate(event.document.uri);
});

documents.onDidChangeContent((event) => {
  const fileName = normalizeFileName(uriToFileName(event.document.uri));
  log(`onDidChangeContent: ${path.basename(fileName)} v${event.document.version}`);

  // Skip if the cached transform is already for this version.
  // onDidChangeContent fires on didOpen too (same version) — re-transforming
  // would overwrite the correct diagnostics from publishDiagnosticsImmediate.
  const currentVersion = getFileVersion(fileName);
  const cached = transformCache.get(fileName);
  if (cached && cached.version === currentVersion) {
    log(`  Skipping — transform cache already at v${currentVersion}`);
    return;
  }

  // Invalidate transform cache and reset pipeline program for changed file
  if (pipeline) {
    pipeline.invalidateContent(fileName);
  }
  transformCache.delete(fileName);
  rawMacroDiagnosticCache.delete(fileName);
  suggestionCache.delete(fileName);

  // fix #6: debounced diagnostics — don't block the message loop on every keystroke
  publishDiagnostics(event.document.uri);
});

// fix #13: on save, re-check dependents — other open files may have stale diagnostics
documents.onDidSave((event) => {
  const savedFileName = normalizeFileName(uriToFileName(event.document.uri));

  // Re-publish diagnostics for all OTHER open documents, since saving file A
  // can change the diagnostics in file B if B imports A.
  for (const doc of documents.all()) {
    const docFileName = normalizeFileName(uriToFileName(doc.uri));
    if (docFileName !== savedFileName) {
      // Invalidate the dependent's transform cache so it re-transforms
      if (pipeline) {
        pipeline.invalidate(docFileName);
      }
      transformCache.delete(docFileName);
      rawMacroDiagnosticCache.delete(docFileName);

      publishDiagnostics(doc.uri);
    }
  }
});

documents.onDidClose((event) => {
  // Cancel any pending diagnostics
  const existing = diagnosticTimers.get(event.document.uri);
  if (existing) {
    clearTimeout(existing);
    diagnosticTimers.delete(event.document.uri);
  }
  // Clear diagnostics when a document is closed
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// ---------------------------------------------------------------------------
// textDocument/completion (fix #4: store transformedOffset in item.data)
// ---------------------------------------------------------------------------

connection.onCompletion(
  safeHandler([] as CompletionItem[], (params: TextDocumentPositionParams): CompletionItem[] => {
    if (!languageService) return [];

    const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
    const originalText = getOriginalContent(fileName);
    if (!originalText) return [];

    const offset = positionToOffset(originalText, params.position);
    const mapper = getMapper(fileName);
    const transformedOffset = mapper.toTransformed(offset);

    if (transformedOffset === null) return [];

    const result = languageService.getCompletionsAtPosition(fileName, transformedOffset, undefined);
    if (!result) return [];

    const items: CompletionItem[] = result.entries.map((entry) => ({
      label: entry.name,
      kind: tsKindToLspKind(entry.kind),
      sortText: entry.sortText,
      insertText: entry.insertText ?? entry.name,
      detail: entry.labelDetails?.description,
      data: {
        fileName,
        name: entry.name,
        source: entry.source,
        offset: transformedOffset, // fix #4: pass actual position for resolve
      },
    }));

    // Add extension method completions
    try {
      const program = languageService.getProgram();
      if (program) {
        const checker = program.getTypeChecker();
        const sourceFile = program.getSourceFile(fileName);
        if (sourceFile) {
          const receiverType = getReceiverTypeAtPosition(sourceFile, transformedOffset, checker);
          if (receiverType) {
            const extensionEntries = getExtensionCompletions(sourceFile, receiverType, checker);
            const existingNames = new Set(items.map((i) => i.label));
            for (const ext of extensionEntries) {
              if (!existingNames.has(ext.name)) {
                items.push({
                  label: ext.name,
                  kind: CompletionItemKind.Function,
                  sortText: ext.sortText,
                  insertText: ext.insertText,
                  detail: ext.labelDetails?.description,
                });
              }
            }
          }
        }
      }
    } catch (error) {
      log(`Error getting extension completions: ${error}`);
    }

    return items;
  })
);

// fix #4: use stored offset for completion resolve
connection.onCompletionResolve(
  safeHandler({} as CompletionItem, (item: CompletionItem): CompletionItem => {
    if (!languageService || !item.data) return item;

    const { fileName, name, source, offset } = item.data;
    const details = languageService.getCompletionEntryDetails(
      fileName,
      offset ?? 0,
      name,
      undefined,
      source,
      undefined,
      undefined
    );

    if (details) {
      item.documentation = ts.displayPartsToString(details.documentation);
      item.detail = ts.displayPartsToString(details.displayParts);
    }

    return item;
  })
);

// ---------------------------------------------------------------------------
// textDocument/hover
// ---------------------------------------------------------------------------

connection.onHover(
  safeHandler(null as Hover | null, (params: TextDocumentPositionParams): Hover | null => {
    if (!languageService) return null;

    const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
    const originalText = getOriginalContent(fileName);
    if (!originalText) return null;

    const offset = positionToOffset(originalText, params.position);
    const mapper = getMapper(fileName);
    const transformedOffset = mapper.toTransformed(offset);

    if (transformedOffset === null) return null;

    const info = languageService.getQuickInfoAtPosition(fileName, transformedOffset);
    if (!info) return null;

    const mappedSpan = mapTextSpanToOriginal(info.textSpan, mapper);
    if (!mappedSpan) return null;

    const displayString = ts.displayPartsToString(info.displayParts);
    const documentation = ts.displayPartsToString(info.documentation);

    let contents = "```typescript\n" + displayString + "\n```";
    if (documentation) {
      contents += "\n\n" + documentation;
    }

    return {
      contents: { kind: "markdown", value: contents },
      range: textSpanToRange(mappedSpan, originalText),
    };
  })
);

// ---------------------------------------------------------------------------
// textDocument/definition
// ---------------------------------------------------------------------------

connection.onDefinition(
  safeHandler(
    null as Definition | null,
    (params: TextDocumentPositionParams): Definition | null => {
      if (!languageService) return null;

      const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
      const originalText = getOriginalContent(fileName);
      if (!originalText) return null;

      const offset = positionToOffset(originalText, params.position);
      const mapper = getMapper(fileName);
      const transformedOffset = mapper.toTransformed(offset);

      if (transformedOffset === null) return null;

      const result = languageService.getDefinitionAndBoundSpan(fileName, transformedOffset);
      if (!result?.definitions) return null;

      const locations: Location[] = [];
      for (const def of result.definitions) {
        const targetMapper = getMapper(def.fileName);
        const mappedSpan = mapTextSpanToOriginal(def.textSpan, targetMapper);
        if (!mappedSpan) continue;

        const targetText = getOriginalContent(def.fileName);
        if (!targetText) continue;

        locations.push({
          uri: fileNameToUri(def.fileName),
          range: textSpanToRange(mappedSpan, targetText),
        });
      }

      return locations.length === 1 ? locations[0] : locations;
    }
  )
);

// ---------------------------------------------------------------------------
// textDocument/typeDefinition
// ---------------------------------------------------------------------------

connection.onTypeDefinition(
  safeHandler(
    null as Definition | null,
    (params: TextDocumentPositionParams): Definition | null => {
      if (!languageService) return null;

      const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
      const originalText = getOriginalContent(fileName);
      if (!originalText) return null;

      const offset = positionToOffset(originalText, params.position);
      const mapper = getMapper(fileName);
      const transformedOffset = mapper.toTransformed(offset);

      if (transformedOffset === null) return null;

      const definitions = languageService.getTypeDefinitionAtPosition(fileName, transformedOffset);
      if (!definitions) return null;

      const locations: Location[] = [];
      for (const def of definitions) {
        const targetMapper = getMapper(def.fileName);
        const mappedSpan = mapTextSpanToOriginal(def.textSpan, targetMapper);
        if (!mappedSpan) continue;

        const targetText = getOriginalContent(def.fileName);
        if (!targetText) continue;

        locations.push({
          uri: fileNameToUri(def.fileName),
          range: textSpanToRange(mappedSpan, targetText),
        });
      }

      return locations.length === 1 ? locations[0] : locations;
    }
  )
);

// ---------------------------------------------------------------------------
// textDocument/references
// ---------------------------------------------------------------------------

connection.onReferences(
  safeHandler(null as Location[] | null, (params: ReferenceParams): Location[] | null => {
    if (!languageService) return null;

    const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
    const originalText = getOriginalContent(fileName);
    if (!originalText) return null;

    const offset = positionToOffset(originalText, params.position);
    const mapper = getMapper(fileName);
    const transformedOffset = mapper.toTransformed(offset);

    if (transformedOffset === null) return null;

    const references = languageService.getReferencesAtPosition(fileName, transformedOffset);
    if (!references) return null;

    const locations: Location[] = [];
    for (const ref of references) {
      const targetMapper = getMapper(ref.fileName);
      const mappedSpan = mapTextSpanToOriginal(ref.textSpan, targetMapper);
      if (!mappedSpan) continue;

      const targetText = getOriginalContent(ref.fileName);
      if (!targetText) continue;

      locations.push({
        uri: fileNameToUri(ref.fileName),
        range: textSpanToRange(mappedSpan, targetText),
      });
    }

    return locations;
  })
);

// ---------------------------------------------------------------------------
// textDocument/documentHighlight (fix #10: use DocumentHighlightKind enum)
// ---------------------------------------------------------------------------

connection.onDocumentHighlight(
  safeHandler(
    null as DocumentHighlight[] | null,
    (params: TextDocumentPositionParams): DocumentHighlight[] | null => {
      if (!languageService) return null;

      const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
      const originalText = getOriginalContent(fileName);
      if (!originalText) return null;

      const offset = positionToOffset(originalText, params.position);
      const mapper = getMapper(fileName);
      const transformedOffset = mapper.toTransformed(offset);

      if (transformedOffset === null) return null;

      const highlights = languageService.getDocumentHighlights(fileName, transformedOffset, [
        fileName,
      ]);
      if (!highlights) return null;

      const result: DocumentHighlight[] = [];
      for (const docHighlight of highlights) {
        const targetMapper = getMapper(docHighlight.fileName);
        for (const span of docHighlight.highlightSpans) {
          const mappedSpan = mapTextSpanToOriginal(span.textSpan, targetMapper);
          if (!mappedSpan) continue;

          result.push({
            range: textSpanToRange(mappedSpan, originalText),
            kind:
              span.kind === ts.HighlightSpanKind.writtenReference
                ? DocumentHighlightKind.Write
                : DocumentHighlightKind.Read,
          });
        }
      }

      return result;
    }
  )
);

// ---------------------------------------------------------------------------
// textDocument/signatureHelp
// ---------------------------------------------------------------------------

connection.onSignatureHelp(
  safeHandler(
    null as SignatureHelp | null,
    (params: TextDocumentPositionParams): SignatureHelp | null => {
      if (!languageService) return null;

      const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
      const originalText = getOriginalContent(fileName);
      if (!originalText) return null;

      const offset = positionToOffset(originalText, params.position);
      const mapper = getMapper(fileName);
      const transformedOffset = mapper.toTransformed(offset);

      if (transformedOffset === null) return null;

      const result = languageService.getSignatureHelpItems(fileName, transformedOffset, undefined);
      if (!result) return null;

      return {
        signatures: result.items.map((item) => ({
          label:
            ts.displayPartsToString(item.prefixDisplayParts) +
            item.parameters
              .map((p) => ts.displayPartsToString(p.displayParts))
              .join(ts.displayPartsToString(item.separatorDisplayParts)) +
            ts.displayPartsToString(item.suffixDisplayParts),
          documentation: ts.displayPartsToString(item.documentation),
          parameters: item.parameters.map((p) => ({
            label: ts.displayPartsToString(p.displayParts),
            documentation: ts.displayPartsToString(p.documentation),
          })),
        })),
        activeSignature: result.selectedItemIndex,
        activeParameter: result.argumentIndex,
      };
    }
  )
);

// ---------------------------------------------------------------------------
// textDocument/prepareRename + textDocument/rename
// ---------------------------------------------------------------------------

connection.onPrepareRename(
  safeHandler(null as Range | null, (params: PrepareRenameParams): Range | null => {
    if (!languageService) return null;

    const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
    const originalText = getOriginalContent(fileName);
    if (!originalText) return null;

    const offset = positionToOffset(originalText, params.position);
    const mapper = getMapper(fileName);
    const transformedOffset = mapper.toTransformed(offset);

    if (transformedOffset === null) return null;

    const info = languageService.getRenameInfo(fileName, transformedOffset);
    if (!info.canRename) return null;

    const mappedSpan = mapTextSpanToOriginal(info.triggerSpan, mapper);
    if (!mappedSpan) return null;

    return textSpanToRange(mappedSpan, originalText);
  })
);

connection.onRenameRequest(
  safeHandler(null as WorkspaceEdit | null, (params: RenameParams): WorkspaceEdit | null => {
    if (!languageService) return null;

    const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
    const originalText = getOriginalContent(fileName);
    if (!originalText) return null;

    const offset = positionToOffset(originalText, params.position);
    const mapper = getMapper(fileName);
    const transformedOffset = mapper.toTransformed(offset);

    if (transformedOffset === null) return null;

    const locations = languageService.findRenameLocations(
      fileName,
      transformedOffset,
      false,
      false
    );

    if (!locations) return null;

    const changes: Record<string, Array<{ range: Range; newText: string }>> = {};

    for (const loc of locations) {
      const targetMapper = getMapper(loc.fileName);
      const mappedSpan = mapTextSpanToOriginal(loc.textSpan, targetMapper);
      if (!mappedSpan) continue;

      const targetText = getOriginalContent(loc.fileName);
      if (!targetText) continue;

      const uri = fileNameToUri(loc.fileName);
      if (!changes[uri]) changes[uri] = [];

      changes[uri].push({
        range: textSpanToRange(mappedSpan, targetText),
        newText: params.newName,
      });
    }

    return { changes };
  })
);

// ---------------------------------------------------------------------------
// textDocument/codeAction
// ---------------------------------------------------------------------------

connection.onCodeAction(
  safeHandler([] as CodeAction[], (params: CodeActionParams): CodeAction[] => {
    if (!languageService) return [];

    const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
    const originalText = getOriginalContent(fileName);
    if (!originalText) return [];

    const actions: CodeAction[] = [];

    // Check for typesugar Quick Fix suggestions
    const fileSuggestions = suggestionCache.get(fileName);
    if (fileSuggestions && fileSuggestions.length > 0) {
      const startOffset = positionToOffset(originalText, params.range.start);
      const endOffset = positionToOffset(originalText, params.range.end);

      for (const suggestion of fileSuggestions) {
        const suggestionEnd = suggestion.start + suggestion.length;
        if (suggestion.start <= endOffset && suggestionEnd >= startOffset) {
          actions.push({
            title: suggestion.description,
            kind: "quickfix",
            edit: {
              changes: {
                [params.textDocument.uri]: [
                  {
                    range: {
                      start: offsetToPosition(originalText, suggestion.start),
                      end: offsetToPosition(originalText, suggestion.start + suggestion.length),
                    },
                    newText: suggestion.replacement,
                  },
                ],
              },
            },
          });
        }
      }
    }

    // Get TS code fixes
    const mapper = getMapper(fileName);
    const startOffset = positionToOffset(originalText, params.range.start);
    const endOffset = positionToOffset(originalText, params.range.end);
    const transformedStart = mapper.toTransformed(startOffset);
    const transformedEnd = mapper.toTransformed(endOffset);

    if (transformedStart !== null && transformedEnd !== null) {
      const errorCodes = params.context.diagnostics
        .filter((d) => typeof d.code === "number")
        .map((d) => d.code as number);

      if (errorCodes.length > 0) {
        const fixes = languageService.getCodeFixesAtPosition(
          fileName,
          transformedStart,
          transformedEnd,
          errorCodes,
          {},
          {}
        );

        for (const fix of fixes) {
          const changes: Record<string, Array<{ range: Range; newText: string }>> = {};

          for (const fileChange of fix.changes) {
            const fileMapper = getMapper(fileChange.fileName);
            const fileText = getOriginalContent(fileChange.fileName);
            if (!fileText) continue;

            const uri = fileNameToUri(fileChange.fileName);
            if (!changes[uri]) changes[uri] = [];

            for (const textChange of fileChange.textChanges) {
              const mappedSpan = mapTextSpanToOriginal(textChange.span, fileMapper);
              if (!mappedSpan) continue;

              changes[uri].push({
                range: textSpanToRange(mappedSpan, fileText),
                newText: textChange.newText,
              });
            }
          }

          actions.push({
            title: fix.description,
            kind: "quickfix",
            edit: { changes },
          });
        }
      }
    }

    // Add macro-specific code actions (expand, wrap-in-comptime)
    const startOff = positionToOffset(originalText, params.range.start);
    const endOff = positionToOffset(originalText, params.range.end);
    const macroActions = computeMacroCodeActions(
      originalText,
      fileName,
      manifest,
      startOff,
      endOff
    );
    for (const ma of macroActions) {
      const action: CodeAction = { title: ma.title, kind: CodeActionKind.Refactor };
      if (ma.kind === "expand-macro") {
        action.command = {
          title: ma.title,
          command: "typesugar.expandMacro",
          arguments: [params.textDocument.uri, ma.macroOffset],
        };
      } else if (ma.kind === "wrap-comptime" && ma.edit) {
        action.edit = {
          changes: {
            [params.textDocument.uri]: [
              {
                range: {
                  start: offsetToPosition(originalText, ma.edit.start),
                  end: offsetToPosition(originalText, ma.edit.start + ma.edit.length),
                },
                newText: ma.edit.newText,
              },
            ],
          },
        };
      } else {
        // tooling #23: "add-derive" used to carry a `typesugar.addDerive`
        // command that no server or client registers, so choosing it did
        // nothing. It isn't offered until it can be a real WorkspaceEdit.
        continue;
      }
      actions.push(action);
    }

    return actions;
  })
);

// ---------------------------------------------------------------------------
// textDocument/semanticTokens/full (Wave 2)
// ---------------------------------------------------------------------------

connection.languages.semanticTokens.on(
  safeHandler({ data: [] as number[] }, (params: any) => {
    const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
    const originalText = getOriginalContent(fileName);
    if (!originalText) return { data: [] };

    return computeSemanticTokens(originalText, fileName, manifest);
  })
);

// ---------------------------------------------------------------------------
// textDocument/codeLens (Wave 2)
// ---------------------------------------------------------------------------

connection.onCodeLens(
  safeHandler([] as any[], (params: any) => {
    const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
    const originalText = getOriginalContent(fileName);
    if (!originalText) return [];

    return computeCodeLenses(originalText, fileName, manifest, params.textDocument.uri);
  })
);

// ---------------------------------------------------------------------------
// textDocument/inlayHint (Wave 2)
// ---------------------------------------------------------------------------

connection.languages.inlayHint.on(
  safeHandler([] as any[], (params: any) => {
    const fileName = normalizeFileName(uriToFileName(params.textDocument.uri));
    const originalText = getOriginalContent(fileName);
    if (!originalText) return [];

    // Get expansion records for macro expansion hints
    const result = getTransformResult(fileName);
    const expansions = result?.expansions;

    return computeInlayHints(originalText, fileName, manifest, params.range, expansions);
  })
);

// ---------------------------------------------------------------------------
// workspace/executeCommand (Wave 2)
// ---------------------------------------------------------------------------

connection.onExecuteCommand(
  safeHandler(null, (params: any) => {
    switch (params.command) {
      case "typesugar.expandMacro": {
        if (!params.arguments || params.arguments.length < 2) return null;
        const [uri, offset] = params.arguments as [string, number];
        const fileName = normalizeFileName(uriToFileName(uri));
        const result = getTransformResult(fileName);
        if (!result?.expansions) return null;

        // Find expansion nearest to the offset
        let best: { macroName: string; expandedText: string } | null = null;
        let bestDist = Infinity;
        for (const exp of result.expansions) {
          if (offset >= exp.originalStart && offset <= exp.originalEnd) {
            return { macroName: exp.macroName, expandedText: exp.expandedText };
          }
          const dist = Math.min(
            Math.abs(offset - exp.originalStart),
            Math.abs(offset - exp.originalEnd)
          );
          if (dist < bestDist) {
            bestDist = dist;
            best = { macroName: exp.macroName, expandedText: exp.expandedText };
          }
        }
        return bestDist < 200 ? best : null;
      }

      case "typesugar.showTransformed": {
        if (!params.arguments || params.arguments.length < 1) return null;
        const [uri] = params.arguments as [string];
        const fileName = normalizeFileName(uriToFileName(uri));
        const result = getTransformResult(fileName);
        if (!result) return null;
        return { original: result.original, transformed: result.code, changed: result.changed };
      }

      case "typesugar.refreshManifest": {
        if (manifest.load(workspaceRoot)) {
          log("Manifest reloaded");
        }
        return null;
      }

      default:
        return null;
    }
  })
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

documents.listen(connection);
connection.listen();

log("typesugar LSP server starting...");
