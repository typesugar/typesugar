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
 * 4. Applies SFINAE rules to suppress diagnostics in macro-generated code
 *
 * Usage: typesugar-lsp --stdio
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
  offsetToPosition,
  positionToOffset,
  textSpanToRange,
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
import { preprocess } from "@typesugar/preprocessor";
import {
  filterDiagnostics,
  registerSfinaeRuleOnce,
  getSfinaeRules,
  createMacroGeneratedRule,
  type PositionMapFn,
} from "@typesugar/core";
import {
  createExtensionMethodCallRule,
  createNewtypeAssignmentRule,
  createTypeRewriteAssignmentRule,
} from "@typesugar/macros";
import { ManifestState } from "./manifest.js";
import { computeSemanticTokens, getSemanticTokensLegend } from "./semantic-tokens.js";
import { computeCodeLenses } from "./codelens.js";
import { computeInlayHints } from "./inlay-hints.js";
import { computeExtraCodeActions } from "./code-actions-extra.js";

// ---------------------------------------------------------------------------
// Connection setup (fix #9: always let vscode-languageserver auto-detect
// transport from argv; the bin script ensures --stdio is present)
// ---------------------------------------------------------------------------

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceRoot = "";
let languageService: ts.LanguageService | null = null;
let pipeline: TransformationPipeline | null = null;
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

function discoverStsFiles(dir: string): string[] {
  const stsFiles: string[] = [];

  function scan(d: string) {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name === "node_modules" ||
            entry.name.startsWith(".") ||
            entry.name === "dist"
          ) {
            continue;
          }
          scan(fullPath);
        } else if (entry.isFile() && /\.stsx?$/.test(entry.name)) {
          stsFiles.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  scan(dir);
  return stsFiles;
}

function loadTsConfig(rootDir: string): {
  compilerOptions: ts.CompilerOptions;
  fileNames: string[];
} {
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
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
    fileNames: parsed.fileNames,
  };
}

// ---------------------------------------------------------------------------
// Document content helpers (fix #2: use proper URI-based document lookup)
// ---------------------------------------------------------------------------

function getOriginalContent(fileName: string): string | undefined {
  const normalizedFileName = path.normalize(fileName);
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
  const normalizedFileName = path.normalize(fileName);
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

function preprocessStsFile(fileName: string, content: string): string {
  try {
    const result = preprocess(content, {
      fileName,
      extensions: ["hkt", "pipeline", "cons", "decorator-rewrite"],
    });
    return result.changed ? result.code : content;
  } catch {
    return content;
  }
}

// ---------------------------------------------------------------------------
// Pipeline lifecycle
// ---------------------------------------------------------------------------

function createPipeline(compilerOptions: ts.CompilerOptions): void {
  currentCompilerOptions = compilerOptions;
  pipeline = new TransformationPipeline(compilerOptions, projectFileNames, {
    verbose: false,
    readFile: (f: string) => getOriginalContent(f),
    fileExists: (f: string) => {
      if (ts.sys.fileExists(f)) return true;
      if (/\.stsx?$/.test(f)) return fs.existsSync(f);
      return false;
    },
  });
  // Clear transform caches when pipeline is recreated
  transformCache.clear();
  rawMacroDiagnosticCache.clear();
  suggestionCache.clear();
}

/** Track which files have been added to the pipeline's file list */
const pipelineFileSet = new Set<string>();

function ensureFileInPipeline(normalizedFileName: string): void {
  if (pipelineFileSet.has(normalizedFileName)) return;
  pipelineFileSet.add(normalizedFileName);

  if (!projectFileNames.includes(normalizedFileName)) {
    projectFileNames.push(normalizedFileName);
    // Recreate the pipeline so the TS program includes this file
    createPipeline(currentCompilerOptions);
    log(`Recreated pipeline to include ${path.basename(normalizedFileName)}`);
  }
}

// ---------------------------------------------------------------------------
// Transform layer (fix #3: getTransformResult uses getFileVersion which is
// independent of the host's getScriptVersion, avoiding recursion)
// ---------------------------------------------------------------------------

function getTransformResult(fileName: string): TransformResult | null {
  const normalizedFileName = path.normalize(fileName);

  if (!pipeline) return null;

  // Ensure the file is in the pipeline's program before transforming
  ensureFileInPipeline(normalizedFileName);

  if (!pipeline.shouldTransform(normalizedFileName)) return null;

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

    if (result.diagnostics.length > 0) {
      rawMacroDiagnosticCache.set(normalizedFileName, result.diagnostics);
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

function mapTextSpanToOriginal(span: ts.TextSpan, mapper: PositionMapper): ts.TextSpan | null {
  const originalStart = mapper.toOriginal(span.start);
  if (originalStart === null) return null;

  const originalEnd = mapper.toOriginal(span.start + span.length);
  const originalLength =
    originalEnd !== null ? Math.max(1, originalEnd - originalStart) : span.length;

  return { start: originalStart, length: originalLength };
}

// ---------------------------------------------------------------------------
// LanguageServiceHost (fix #3: getScriptVersion does NOT call
// getTransformResult — it uses a separate version scheme to avoid recursion.
// The transform cache is keyed on getFileVersion which is independent.)
// ---------------------------------------------------------------------------

function createLanguageServiceHost(compilerOptions: ts.CompilerOptions): ts.LanguageServiceHost {
  const stsPreprocessCache = new Map<string, { code: string; version: string }>();

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => projectFileNames,

    getScriptVersion: (fileName: string) => {
      const normalizedFileName = path.normalize(fileName);
      // Use getFileVersion (doc version or mtime) as the base.
      // When the file has been transformed, append transform code length
      // to bust the TS cache. Crucially, we check the transformCache
      // directly instead of calling getTransformResult to avoid a
      // transform → getScriptVersion → transform loop.
      const baseVersion = getFileVersion(normalizedFileName);
      const cached = transformCache.get(normalizedFileName);
      if (cached && cached.result.changed && cached.version === baseVersion) {
        return `${baseVersion}-ts-${cached.result.code.length}`;
      }

      if (/\.stsx?$/.test(normalizedFileName)) {
        try {
          const mtime = fs.statSync(normalizedFileName).mtimeMs;
          return `${baseVersion}-sts-${mtime}`;
        } catch {
          // File might not exist
        }
      }

      return baseVersion;
    },

    getScriptSnapshot: (fileName: string) => {
      const normalizedFileName = path.normalize(fileName);

      // Try pipeline transformation first
      const result = getTransformResult(normalizedFileName);
      if (result?.changed) {
        return ts.ScriptSnapshot.fromString(result.code);
      }

      // For .sts files not in the pipeline, preprocess directly
      if (/\.stsx?$/.test(normalizedFileName)) {
        const currentVersion = getFileVersion(normalizedFileName);
        const cached = stsPreprocessCache.get(normalizedFileName);

        if (cached && cached.version === currentVersion) {
          return ts.ScriptSnapshot.fromString(cached.code);
        }

        const content = getOriginalContent(normalizedFileName);
        if (content) {
          const preprocessed = preprocessStsFile(normalizedFileName, content);
          stsPreprocessCache.set(normalizedFileName, {
            code: preprocessed,
            version: currentVersion,
          });
          return ts.ScriptSnapshot.fromString(preprocessed);
        }
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

    fileExists: (fileName: string) => {
      if (ts.sys.fileExists(fileName)) return true;
      if (/\.stsx?$/.test(fileName)) return fs.existsSync(fileName);
      return false;
    },

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

        if (result.resolvedModule) {
          return result.resolvedModule;
        }

        // Try .sts/.stsx extensions for relative imports
        if (moduleName.startsWith(".") || moduleName.startsWith("/")) {
          const baseDir = path.dirname(containingFile);
          const basePath = path.resolve(baseDir, moduleName);

          for (const ext of [".sts", ".stsx"]) {
            const candidate = basePath + ext;
            if (fs.existsSync(candidate)) {
              return {
                resolvedFileName: candidate,
                isExternalLibraryImport: false,
                extension: ext === ".stsx" ? ts.Extension.Tsx : ts.Extension.Ts,
              };
            }

            const indexCandidate = path.join(basePath, "index" + ext);
            if (fs.existsSync(indexCandidate)) {
              return {
                resolvedFileName: indexCandidate,
                isExternalLibraryImport: false,
                extension: ext === ".stsx" ? ts.Extension.Tsx : ts.Extension.Ts,
              };
            }
          }
        }

        return undefined;
      });
    },
  };

  return host;
}

// ---------------------------------------------------------------------------
// SFINAE registration
// ---------------------------------------------------------------------------

function registerSfinaeRules(): void {
  const positionMapFn: PositionMapFn = (
    fileName: string,
    transformedPos: number
  ): number | null => {
    const mapper = getMapper(fileName);
    return mapper.toOriginal(transformedPos);
  };

  registerSfinaeRuleOnce(createMacroGeneratedRule(positionMapFn));
  registerSfinaeRuleOnce(createExtensionMethodCallRule());
  registerSfinaeRuleOnce(createNewtypeAssignmentRule());
  registerSfinaeRuleOnce(createTypeRewriteAssignmentRule());
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

function mapTsDiagnostic(diag: ts.Diagnostic, mapper: PositionMapper): ts.Diagnostic | null {
  if (diag.start === undefined) return diag;

  const originalStart = mapper.toOriginal(diag.start);
  if (originalStart === null) return null;

  let originalLength = diag.length;
  if (diag.length !== undefined) {
    const originalEnd = mapper.toOriginal(diag.start + diag.length);
    if (originalEnd !== null) {
      originalLength = Math.max(1, originalEnd - originalStart);
    }
  }

  return { ...diag, start: originalStart, length: originalLength };
}

function getDiagnosticsForFile(fileName: string): Diagnostic[] {
  if (!languageService) return [];

  const normalizedFileName = path.normalize(fileName);
  const originalText = getOriginalContent(normalizedFileName);
  if (!originalText) return [];

  // Ensure transformation has run
  getTransformResult(normalizedFileName);

  const mapper = getMapper(normalizedFileName);
  const diagnostics: Diagnostic[] = [];

  // Get TS diagnostics and map them back
  const semanticDiags = languageService.getSemanticDiagnostics(normalizedFileName);
  const syntacticDiags = languageService.getSyntacticDiagnostics(normalizedFileName);
  const allTsDiags = [...syntacticDiags, ...semanticDiags];

  // Apply SFINAE filtering
  const program = languageService.getProgram();
  let filtered: readonly ts.Diagnostic[];
  if (program && getSfinaeRules().length > 0) {
    const checker = program.getTypeChecker();
    filtered = filterDiagnostics(allTsDiags, checker, (fn) => program.getSourceFile(fn));
  } else {
    filtered = allTsDiags;
  }

  // Map positions back and convert to LSP format
  for (const diag of filtered) {
    const mapped = mapTsDiagnostic(diag, mapper);
    if (!mapped || mapped.start === undefined) continue;

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

  // Add macro diagnostics
  const rawDiags = rawMacroDiagnosticCache.get(normalizedFileName) ?? [];
  const suggestions: StoredSuggestion[] = [];

  for (const diag of rawDiags) {
    if (path.normalize(diag.file) !== normalizedFileName) continue;
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
      const fileName = uriToFileName(uri);
      const diagnostics = getDiagnosticsForFile(fileName);
      connection.sendDiagnostics({ uri, diagnostics });
    }, DIAGNOSTIC_DELAY_MS)
  );
}

// Immediate publish (for onDidOpen — user expects results right away)
function publishDiagnosticsImmediate(uri: string): void {
  const existing = diagnosticTimers.get(uri);
  if (existing) clearTimeout(existing);
  diagnosticTimers.delete(uri);

  const fileName = uriToFileName(uri);
  const diagnostics = getDiagnosticsForFile(fileName);
  connection.sendDiagnostics({ uri, diagnostics });
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

  // Load tsconfig
  const { compilerOptions, fileNames: tsFileNames } = loadTsConfig(workspaceRoot);

  // Discover .sts/.stsx files
  const stsFiles = discoverStsFiles(workspaceRoot);
  log(`Found ${stsFiles.length} .sts/.stsx files`);

  // Combine file lists
  projectFileNames = [...new Set([...tsFileNames, ...stsFiles])];

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

  // Register SFINAE rules
  registerSfinaeRules();

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
  // Ensure file is in project list
  const fileName = uriToFileName(event.document.uri);
  const normalized = path.normalize(fileName);
  if (!projectFileNames.includes(normalized)) {
    projectFileNames.push(normalized);
  }
  // Immediate diagnostics on open (no debounce)
  publishDiagnosticsImmediate(event.document.uri);
});

documents.onDidChangeContent((event) => {
  // Invalidate transform cache for changed file
  const fileName = path.normalize(uriToFileName(event.document.uri));
  if (pipeline) {
    pipeline.invalidate(fileName);
  }
  transformCache.delete(fileName);
  rawMacroDiagnosticCache.delete(fileName);
  suggestionCache.delete(fileName);

  // fix #6: debounced diagnostics — don't block the message loop on every keystroke
  publishDiagnostics(event.document.uri);
});

// fix #13: on save, re-check dependents — other open files may have stale diagnostics
documents.onDidSave((event) => {
  const savedFileName = path.normalize(uriToFileName(event.document.uri));

  // Re-publish diagnostics for all OTHER open documents, since saving file A
  // can change the diagnostics in file B if B imports A.
  for (const doc of documents.all()) {
    const docFileName = path.normalize(uriToFileName(doc.uri));
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

    const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

    const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

      const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

      const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

    const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

      const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

      const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

    const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

    const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

    const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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

    // Add macro-specific code actions (expand, wrap-in-comptime, add-derive)
    const extraActions = computeExtraCodeActions(
      originalText,
      fileName,
      manifest,
      params.range,
      params.textDocument.uri
    );
    actions.push(...extraActions);

    return actions;
  })
);

// ---------------------------------------------------------------------------
// textDocument/semanticTokens/full (Wave 2)
// ---------------------------------------------------------------------------

connection.languages.semanticTokens.on(
  safeHandler({ data: [] as number[] }, (params: any) => {
    const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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
    const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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
    const fileName = path.normalize(uriToFileName(params.textDocument.uri));
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
        const fileName = path.normalize(uriToFileName(uri));
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
        const fileName = path.normalize(uriToFileName(uri));
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
