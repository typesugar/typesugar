/**
 * typesugar TypeScript Language Service Plugin (v2 - Transform-First)
 *
 * This plugin intercepts file reads and serves transformed code to TypeScript,
 * enabling full IDE support (completions, hover, go-to-definition) for
 * macro-generated code.
 *
 * Architecture:
 * 1. Intercept the original LanguageServiceHost methods
 * 2. Serve transformed code through getScriptSnapshot
 * 3. Use modified script versions to trigger TS re-analysis
 * 4. Map diagnostic positions back to original coordinates
 * 5. Include .sts files via getExternalFiles() for TypeScript to recognize
 *
 * Configure in tsconfig.json:
 * {
 *   "compilerOptions": {
 *     "plugins": [{ "name": "@typesugar/transformer/language-service" }]
 *   }
 * }
 */

import type * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import {
  TransformationPipeline,
  type TransformResult,
  type TransformDiagnostic,
} from "./pipeline.js";
import { IdentityPositionMapper, type PositionMapper } from "./position-mapper.js";
import { preprocess } from "@typesugar/preprocessor";
import {
  filterDiagnostics,
  registerSfinaeRule,
  getSfinaeRules,
  isSfinaeAuditEnabled,
  createMacroGeneratedRule,
  type PositionMapFn,
} from "@typesugar/core";

/**
 * Cache entry for transformed files
 */
interface TransformCacheEntry {
  result: TransformResult;
  version: string;
}

/**
 * Stored suggestion keyed by "fileName:start" for Quick Fix lookup
 */
interface StoredSuggestion {
  description: string;
  start: number;
  length: number;
  replacement: string;
}

function init(modules: { typescript: typeof ts }) {
  console.log("[typesugar] Language service plugin v2 (transform-first) initializing...");
  const tsModule = modules.typescript;

  /**
   * Get .sts and .stsx files from the project directory.
   *
   * This is called by TypeScript to discover external files that should be
   * included in the project. Without this, .sts files are invisible to the
   * type checker and language service.
   */
  function getExternalFiles(project: ts.server.Project): string[] {
    const projectName = project.getProjectName();

    // Skip inferred projects (virtual, no real directory)
    // These are created for virtual files and have currentDirectory: "/"
    if (projectName.includes("inferredProject")) {
      return [];
    }

    const projectDir = project.getCurrentDirectory();

    // Skip filesystem roots — scanning from "/" or "C:\" is never intentional
    // and takes 4+ minutes
    if (projectDir === "/" || /^[A-Z]:\\?$/i.test(projectDir)) {
      return [];
    }

    // Skip directories that aren't real project roots to avoid scanning
    // unrelated directory trees (typesugar projects always have tsconfig or package.json)
    if (
      !fs.existsSync(path.join(projectDir, "tsconfig.json")) &&
      !fs.existsSync(path.join(projectDir, "package.json"))
    ) {
      return [];
    }

    const stsFiles: string[] = [];

    function scanDirectory(dir: string) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Skip node_modules and hidden directories
            if (entry.name === "node_modules" || entry.name.startsWith(".")) {
              continue;
            }
            scanDirectory(fullPath);
          } else if (entry.isFile()) {
            if (/\.stsx?$/.test(entry.name)) {
              stsFiles.push(fullPath);
            }
          }
        }
      } catch {
        // Ignore permission errors, etc.
      }
    }

    scanDirectory(projectDir);

    if (stsFiles.length > 0) {
      console.log(`[typesugar] Found ${stsFiles.length} .sts/.stsx files in project`);
    }

    return stsFiles;
  }

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const projectName = info.project.getProjectName();
    console.log("[typesugar] Creating language service proxy for project:", projectName);

    const log = (msg: string) => {
      info.project.projectService.logger.info(`[typesugar] ${msg}`);
    };

    // Skip entirely for:
    // 1. InferredProjects (virtual projects for files without tsconfig, e.g. macro-generated virtual files)
    // 2. Build infrastructure packages (don't use typesugar macros)
    // Processing these wastes TS server resources and causes multi-minute hangs.
    const infraPattern =
      /packages[\\/](transformer|core|macros|preprocessor|ts-plugin|oxc-engine|eslint-plugin|prettier-plugin)[\\/]/;
    if (projectName.includes("/dev/null/inferredProject") || infraPattern.test(projectName)) {
      log(`Skipping typesugar plugin for non-user project: ${projectName}`);
      return info.languageService;
    }

    log("typesugar language service plugin v2 initialized");

    // ---------------------------------------------------------------------------
    // Transform cache and pipeline
    // ---------------------------------------------------------------------------
    const transformCache = new Map<string, TransformCacheEntry>();
    /** Per-file raw macro diagnostic cache — converted to ts.Diagnostic[] lazily in getSemanticDiagnostics */
    const rawMacroDiagnosticCache = new Map<string, TransformDiagnostic[]>();
    /** Per-file suggestion cache for Quick Fix code actions */
    const suggestionCache = new Map<string, StoredSuggestion[]>();
    let pipeline: TransformationPipeline | null = null;

    // Store original host methods BEFORE we modify them
    const originalHost = info.languageServiceHost;
    const boundGetScriptSnapshot = originalHost.getScriptSnapshot.bind(originalHost);
    const boundGetScriptVersion = originalHost.getScriptVersion.bind(originalHost);
    const boundFileExists = originalHost.fileExists?.bind(originalHost);

    /**
     * Read file content from original host (bypass our interception)
     */
    function readOriginalFile(fileName: string): string | undefined {
      const snapshot = boundGetScriptSnapshot(fileName);
      if (snapshot) {
        return snapshot.getText(0, snapshot.getLength());
      }
      return undefined;
    }

    /**
     * Get or create the transformation pipeline
     */
    function getPipeline(): TransformationPipeline {
      if (!pipeline) {
        const compilerOptions = info.project.getCompilerOptions();
        const fileNames = info.project.getFileNames();

        log(`Initializing pipeline with ${fileNames.length} files`);

        pipeline = new TransformationPipeline(compilerOptions, fileNames, {
          verbose: true,
          readFile: (fileName: string): string | undefined => {
            return readOriginalFile(fileName) ?? tsModule.sys?.readFile(fileName);
          },
          fileExists: (fileName: string): boolean => {
            return originalHost.fileExists?.(fileName) ?? tsModule.sys.fileExists(fileName);
          },
        });
      }
      return pipeline;
    }

    /**
     * Extract typesugar error code from [TS9XXX] prefix in a message string.
     * Falls back to 9999 if no code is found.
     */
    function extractErrorCode(message: string): number {
      const match = message.match(/\[TS(\d{4})\]/);
      return match ? parseInt(match[1], 10) : 9999;
    }

    /**
     * Convert pipeline TransformDiagnostics to ts.Diagnostic[] for a given file.
     * Positions are in preprocessed space which equals original space for .ts files.
     */
    function convertMacroDiagnostics(
      transformDiags: TransformDiagnostic[],
      fileName: string
    ): ts.Diagnostic[] {
      const program = oldLS.getProgram();
      let sourceFile = program?.getSourceFile(fileName);

      if (!sourceFile) {
        // Try normalized path variants — the program may store files
        // under a different path format (e.g., with or without symlink resolution)
        const normalized = path.normalize(fileName);
        for (const sf of program?.getSourceFiles() ?? []) {
          if (path.normalize(sf.fileName) === normalized) {
            sourceFile = sf;
            break;
          }
        }
      }

      if (!sourceFile) {
        log(`convertMacroDiagnostics: sourceFile not found for ${fileName}`);
      } else {
        log(`convertMacroDiagnostics: sourceFile.fileName = ${sourceFile.fileName}`);
      }

      const tsDiags: ts.Diagnostic[] = [];
      const suggestions: StoredSuggestion[] = [];

      for (const diag of transformDiags) {
        // Only include diagnostics for this file
        if (path.normalize(diag.file) !== path.normalize(fileName)) continue;

        const code = diag.code ?? extractErrorCode(diag.message);

        // TS server filters semantic diagnostics by d.file.fileName === requestedFile.
        // If the sourceFile path doesn't match exactly, the diagnostic is dropped.
        // We pass the sourceFile when available so that positions can be computed,
        // but fall back to undefined (passes the !d.file filter) if there's a
        // risk of path mismatch.
        tsDiags.push({
          file: sourceFile,
          start: diag.start,
          length: diag.length,
          messageText: diag.message,
          category:
            diag.severity === "error"
              ? tsModule.DiagnosticCategory.Error
              : tsModule.DiagnosticCategory.Warning,
          code,
          source: "typesugar",
        });

        if (diag.suggestion) {
          suggestions.push(diag.suggestion);
        }
      }

      // Cache suggestions for Quick Fix lookup
      if (suggestions.length > 0) {
        suggestionCache.set(path.normalize(fileName), suggestions);
      } else {
        suggestionCache.delete(path.normalize(fileName));
      }

      return tsDiags;
    }

    /**
     * Transform a file and cache the result
     */
    function getTransformResult(fileName: string): TransformResult | null {
      const normalizedFileName = path.normalize(fileName);

      // Check if we should transform this file
      const p = getPipeline();
      if (!p.shouldTransform(normalizedFileName)) {
        return null;
      }

      // Check cache validity using original version
      const currentVersion = boundGetScriptVersion(normalizedFileName);
      const cached = transformCache.get(normalizedFileName);

      if (cached && cached.version === currentVersion) {
        return cached.result;
      }

      // Invalidate stale cache entry and clear associated diagnostic caches
      if (cached) {
        p.invalidate(normalizedFileName);
      }
      rawMacroDiagnosticCache.delete(normalizedFileName);
      suggestionCache.delete(normalizedFileName);

      try {
        const result = p.transform(normalizedFileName);

        if (result.diagnostics.length > 0) {
          log(`Pipeline diagnostics for ${normalizedFileName}: ${result.diagnostics.length}`);
          for (const d of result.diagnostics) {
            log(`  [${d.severity}] ${d.message} (at ${d.start})`);
          }
        }

        // Cache raw diagnostics — they'll be converted to ts.Diagnostic lazily
        // in getSemanticDiagnostics when the program/sourceFile is available
        if (result.diagnostics.length > 0) {
          rawMacroDiagnosticCache.set(normalizedFileName, result.diagnostics);
          log(
            `Cached ${result.diagnostics.length} raw macro diagnostics for ${path.basename(normalizedFileName)}`
          );
        } else {
          rawMacroDiagnosticCache.delete(normalizedFileName);
        }

        if (result.changed) {
          transformCache.set(normalizedFileName, {
            result,
            version: currentVersion,
          });
          log(`Transformed ${normalizedFileName} (changed, ${result.code.length} chars)`);
        } else {
          // Even for unchanged files, cache the result if there are diagnostics
          // so we don't re-transform on every getSemanticDiagnostics call
          transformCache.set(normalizedFileName, {
            result,
            version: currentVersion,
          });
        }

        return result;
      } catch (error) {
        log(`Transform error for ${normalizedFileName}: ${error}`);
        return null;
      }
    }

    /**
     * Get the position mapper for a file
     */
    function getMapper(fileName: string): PositionMapper {
      const result = getTransformResult(fileName);
      return result?.mapper ?? new IdentityPositionMapper();
    }

    // ---------------------------------------------------------------------------
    // Register SFINAE rules
    // ---------------------------------------------------------------------------

    // Register MacroGenerated rule (Rule 4) — suppresses diagnostics in
    // macro-generated code whose positions can't map back to original source.
    // This formalizes the ad-hoc suppression previously handled only by
    // mapDiagnostic returning null.
    const alreadyRegistered = getSfinaeRules().some((r) => r.name === "MacroGenerated");
    if (!alreadyRegistered) {
      const positionMapFn: PositionMapFn = (
        fileName: string,
        transformedPos: number
      ): number | null => {
        const mapper = getMapper(fileName);
        return mapper.toOriginal(transformedPos);
      };

      registerSfinaeRule(createMacroGeneratedRule(positionMapFn));
      log("Registered MacroGenerated SFINAE rule");
    }

    if (isSfinaeAuditEnabled()) {
      log("SFINAE audit mode enabled (TYPESUGAR_SHOW_SFINAE=1)");
    }

    // ---------------------------------------------------------------------------
    // Intercept the original host to serve transformed content.
    // oldLS re-reads from the host when the version string changes.
    // ---------------------------------------------------------------------------

    /**
     * Cache for preprocessed .sts files that aren't in the project yet
     */
    const stsPreprocessCache = new Map<string, { code: string; version: string }>();

    /**
     * Preprocess an .sts file directly (for files not yet in the pipeline)
     */
    function preprocessStsFile(fileName: string): string | undefined {
      try {
        const content = fs.readFileSync(fileName, "utf-8");
        const result = preprocess(content, {
          fileName,
          extensions: ["hkt", "pipeline", "cons", "decorator-rewrite"],
        });
        return result.changed ? result.code : content;
      } catch {
        return undefined;
      }
    }

    const wrappedGetScriptSnapshot = (fileName: string): ts.IScriptSnapshot | undefined => {
      const normalizedFileName = path.normalize(fileName);

      // Try pipeline transformation first
      const result = getTransformResult(normalizedFileName);
      if (result && result.changed) {
        return tsModule.ScriptSnapshot.fromString(result.code);
      }

      // For .sts files not in the pipeline, preprocess directly
      if (/\.stsx?$/.test(normalizedFileName)) {
        const cached = stsPreprocessCache.get(normalizedFileName);
        const currentMtime = fs.existsSync(normalizedFileName)
          ? fs.statSync(normalizedFileName).mtimeMs.toString()
          : "";

        if (cached && cached.version === currentMtime) {
          return tsModule.ScriptSnapshot.fromString(cached.code);
        }

        const preprocessed = preprocessStsFile(normalizedFileName);
        if (preprocessed) {
          stsPreprocessCache.set(normalizedFileName, {
            code: preprocessed,
            version: currentMtime,
          });
          log(`Preprocessed .sts file: ${normalizedFileName}`);
          return tsModule.ScriptSnapshot.fromString(preprocessed);
        }
      }

      return boundGetScriptSnapshot(fileName);
    };

    const wrappedGetScriptVersion = (fileName: string): string => {
      const normalizedFileName = path.normalize(fileName);
      const baseVersion = boundGetScriptVersion(normalizedFileName);
      const result = getTransformResult(normalizedFileName);
      if (result?.changed) {
        return `${baseVersion}-ts-${result.code.length}`;
      }

      // For .sts files, include mtime in version to trigger re-reads
      if (/\.stsx?$/.test(normalizedFileName)) {
        try {
          const mtime = fs.statSync(normalizedFileName).mtimeMs;
          return `${baseVersion}-sts-${mtime}`;
        } catch {
          // File might not exist
        }
      }

      return baseVersion;
    };

    /**
     * Check if a file exists, including .sts files
     */
    const wrappedFileExists = (fileName: string): boolean => {
      // Use the bound original method to avoid infinite recursion
      if (boundFileExists?.(fileName)) {
        return true;
      }
      // Check filesystem directly for .sts files
      if (/\.stsx?$/.test(fileName)) {
        return fs.existsSync(fileName);
      }
      return false;
    };

    /**
     * Resolve modules with .sts fallback
     */
    const wrappedResolveModuleNames = (
      moduleNames: string[],
      containingFile: string,
      _reusedNames: string[] | undefined,
      redirectedReference: ts.ResolvedProjectReference | undefined,
      options: ts.CompilerOptions,
      _containingSourceFile?: ts.SourceFile
    ): (ts.ResolvedModule | undefined)[] => {
      return moduleNames.map((moduleName) => {
        // Try TypeScript's default resolution first
        const result = tsModule.resolveModuleName(
          moduleName,
          containingFile,
          options,
          {
            fileExists: wrappedFileExists,
            readFile: (f) =>
              boundGetScriptSnapshot(f)?.getText(0, boundGetScriptSnapshot(f)!.getLength()),
            directoryExists: originalHost.directoryExists?.bind(originalHost),
            getCurrentDirectory: () => originalHost.getCurrentDirectory(),
            getDirectories: originalHost.getDirectories?.bind(originalHost),
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
          const stsExtensions = [".sts", ".stsx"];

          for (const ext of stsExtensions) {
            const candidate = basePath + ext;
            if (fs.existsSync(candidate)) {
              log(`Resolved ${moduleName} → ${candidate}`);
              return {
                resolvedFileName: candidate,
                isExternalLibraryImport: false,
                extension: ext === ".stsx" ? tsModule.Extension.Tsx : tsModule.Extension.Ts,
              };
            }

            // Try index file
            const indexCandidate = path.join(basePath, "index" + ext);
            if (fs.existsSync(indexCandidate)) {
              log(`Resolved ${moduleName} → ${indexCandidate}`);
              return {
                resolvedFileName: indexCandidate,
                isExternalLibraryImport: false,
                extension: ext === ".stsx" ? tsModule.Extension.Tsx : tsModule.Extension.Ts,
              };
            }
          }
        }

        return undefined;
      });
    };

    // Modify the original host (for the existing LS)
    originalHost.getScriptSnapshot = wrappedGetScriptSnapshot;
    originalHost.getScriptVersion = wrappedGetScriptVersion;
    originalHost.fileExists = wrappedFileExists;

    // Add module resolution if host supports it
    const hostWithResolution = originalHost as ts.LanguageServiceHost & {
      resolveModuleNames?: typeof wrappedResolveModuleNames;
    };
    hostWithResolution.resolveModuleNames = wrappedResolveModuleNames;

    // ---------------------------------------------------------------------------
    // Create proxy for the LanguageService
    // The original host is already modified above, so oldLS will re-read
    // transformed content when the version string changes.
    // ---------------------------------------------------------------------------
    const proxy = Object.create(null) as ts.LanguageService;
    const oldLS = info.languageService;

    // Copy all methods from the original language service
    // These are fallbacks for operations we don't explicitly handle
    for (const k of Object.keys(oldLS)) {
      const prop = (oldLS as unknown as Record<string, unknown>)[k];
      if (typeof prop === "function") {
        (proxy as unknown as Record<string, unknown>)[k] = (...args: unknown[]): unknown => {
          return (prop as Function).apply(oldLS, args);
        };
      }
    }

    // ---------------------------------------------------------------------------
    // Override: Diagnostic methods (map positions back to original)
    // ---------------------------------------------------------------------------

    /**
     * Map a single diagnostic's positions back to original source
     */
    function mapDiagnostic(diag: ts.Diagnostic, mapper: PositionMapper): ts.Diagnostic | null {
      if (diag.start === undefined) return diag;

      const originalStart = mapper.toOriginal(diag.start);

      // If we can't map the position, it's in macro-generated code — suppress it
      if (originalStart === null) {
        return null;
      }

      // Map the length as well
      let originalLength = diag.length;
      if (diag.length !== undefined) {
        const originalEnd = mapper.toOriginal(diag.start + diag.length);
        if (originalEnd !== null) {
          originalLength = Math.max(1, originalEnd - originalStart);
        }
      }

      return {
        ...diag,
        start: originalStart,
        length: originalLength,
      };
    }

    /**
     * Map an array of diagnostics
     */
    function mapDiagnostics<T extends ts.Diagnostic>(
      diagnostics: readonly T[],
      fileName: string
    ): T[] {
      const mapper = getMapper(fileName);
      const mapped: T[] = [];

      for (const diag of diagnostics) {
        const mappedDiag = mapDiagnostic(diag, mapper);
        if (mappedDiag !== null) {
          mapped.push(mappedDiag as T);
        }
      }

      return mapped;
    }

    proxy.getSemanticDiagnostics = (fileName: string): ts.Diagnostic[] => {
      const normalizedFileName = path.normalize(fileName);

      // Ensure transformation has run (populates rawMacroDiagnosticCache)
      getTransformResult(normalizedFileName);

      // Get TypeScript's own diagnostics (positions in transformed code)
      const diagnostics = oldLS.getSemanticDiagnostics(fileName);

      // Apply SFINAE filtering before position mapping — this runs all
      // registered rules (including MacroGenerated) to suppress diagnostics
      // that typesugar's rewrite system handles.
      const program = oldLS.getProgram();
      let sfinaeFiltered: readonly ts.Diagnostic[];
      if (program && getSfinaeRules().length > 0) {
        const checker = program.getTypeChecker();
        sfinaeFiltered = filterDiagnostics(diagnostics, checker, (fn) => program.getSourceFile(fn));
      } else {
        sfinaeFiltered = diagnostics;
      }

      // Map remaining diagnostics back to original positions
      const mapped = mapDiagnostics(sfinaeFiltered, fileName);

      // Convert raw macro diagnostics to ts.Diagnostic[] now that the program is available
      const rawDiags = rawMacroDiagnosticCache.get(normalizedFileName) ?? [];
      const macroDiags = convertMacroDiagnostics(rawDiags, normalizedFileName);
      const combined = [...mapped, ...macroDiags];

      if (combined.length > 0 || sfinaeFiltered.length < diagnostics.length) {
        const suppressedCount = diagnostics.length - sfinaeFiltered.length;
        log(
          `Semantic diagnostics for ${path.basename(fileName)}: ` +
            `${diagnostics.length} TS raw → ${sfinaeFiltered.length} after SFINAE (${suppressedCount} suppressed) → ` +
            `${mapped.length} mapped + ${macroDiags.length} macro = ${combined.length} total`
        );
      }
      return combined;
    };

    proxy.getSyntacticDiagnostics = (fileName: string): ts.DiagnosticWithLocation[] => {
      const diagnostics = oldLS.getSyntacticDiagnostics(fileName);
      return mapDiagnostics(diagnostics, fileName);
    };

    proxy.getSuggestionDiagnostics = (fileName: string): ts.DiagnosticWithLocation[] => {
      const diagnostics = oldLS.getSuggestionDiagnostics(fileName);

      // Apply SFINAE filtering to suggestion diagnostics
      const program = oldLS.getProgram();
      let sfinaeFiltered: readonly ts.DiagnosticWithLocation[];
      if (program && getSfinaeRules().length > 0) {
        const checker = program.getTypeChecker();
        sfinaeFiltered = filterDiagnostics(diagnostics, checker, (fn) =>
          program.getSourceFile(fn)
        ) as ts.DiagnosticWithLocation[];
      } else {
        sfinaeFiltered = diagnostics;
      }

      return mapDiagnostics(sfinaeFiltered, fileName);
    };

    // ---------------------------------------------------------------------------
    // Override: Code fixes for macro diagnostics (Quick Fix menu)
    // ---------------------------------------------------------------------------

    proxy.getCodeFixesAtPosition = (
      fileName: string,
      start: number,
      end: number,
      errorCodes: readonly number[],
      formatOptions: ts.FormatCodeSettings,
      preferences: ts.UserPreferences
    ): readonly ts.CodeFixAction[] => {
      const normalizedFileName = path.normalize(fileName);

      // Get TS's own code fixes
      const original = oldLS.getCodeFixesAtPosition(
        fileName,
        start,
        end,
        errorCodes,
        formatOptions,
        preferences
      );

      // Check if any of the error codes are in the typesugar range (9001-9999)
      const hasTypesugarCodes = errorCodes.some((c) => c >= 9001 && c <= 9999);
      if (!hasTypesugarCodes) {
        return original;
      }

      // Look for typesugar diagnostics with suggestions at this position
      const fileSuggestions = suggestionCache.get(normalizedFileName);
      if (!fileSuggestions || fileSuggestions.length === 0) {
        return original;
      }

      const fixes: ts.CodeFixAction[] = [];
      for (const suggestion of fileSuggestions) {
        // Check if the suggestion overlaps with the requested range
        const suggestionEnd = suggestion.start + suggestion.length;
        if (suggestion.start <= end && suggestionEnd >= start) {
          fixes.push({
            fixName: "typesugar-fix",
            description: suggestion.description,
            changes: [
              {
                fileName: normalizedFileName,
                textChanges: [
                  {
                    span: { start: suggestion.start, length: suggestion.length },
                    newText: suggestion.replacement,
                  },
                ],
              },
            ],
            fixId: "typesugar-fix",
            fixAllDescription: suggestion.description,
          });
        }
      }

      if (fixes.length > 0) {
        log(`Providing ${fixes.length} typesugar Quick Fix(es) for ${path.basename(fileName)}`);
      }

      return [...original, ...fixes];
    };

    // ---------------------------------------------------------------------------
    // Override: Position-based IDE features (map positions bidirectionally)
    // ---------------------------------------------------------------------------

    /**
     * Map a TextSpan back to original coordinates
     */
    function mapTextSpanToOriginal(span: ts.TextSpan, mapper: PositionMapper): ts.TextSpan | null {
      const originalStart = mapper.toOriginal(span.start);
      if (originalStart === null) return null;

      const originalEnd = mapper.toOriginal(span.start + span.length);
      const originalLength =
        originalEnd !== null ? Math.max(1, originalEnd - originalStart) : span.length;

      return { start: originalStart, length: originalLength };
    }

    /**
     * Check if a function's first parameter type is compatible with a target type
     */
    function isFirstParamCompatible(
      checker: ts.TypeChecker,
      fnSymbol: ts.Symbol,
      targetType: ts.Type
    ): boolean {
      const decl = fnSymbol.getDeclarations()?.[0];
      if (
        !decl ||
        (!tsModule.isFunctionDeclaration(decl) &&
          !tsModule.isArrowFunction(decl) &&
          !tsModule.isFunctionExpression(decl) &&
          !tsModule.isMethodDeclaration(decl))
      ) {
        return false;
      }

      const signature = checker.getSignatureFromDeclaration(decl as ts.SignatureDeclaration);
      if (!signature) return false;

      const params = signature.getParameters();
      if (params.length === 0) return false;

      const firstParam = params[0];
      const firstParamDecl = firstParam.getDeclarations()?.[0];
      if (!firstParamDecl || !tsModule.isParameter(firstParamDecl)) return false;

      const firstParamType = checker.getTypeAtLocation(firstParamDecl);

      // Check if targetType is assignable to firstParamType
      return checker.isTypeAssignableTo(targetType, firstParamType);
    }

    /**
     * Get extension method completions for a given receiver type
     */
    function getExtensionCompletions(
      sourceFile: ts.SourceFile,
      receiverType: ts.Type,
      checker: ts.TypeChecker
    ): ts.CompletionEntry[] {
      const extensions: ts.CompletionEntry[] = [];
      const seen = new Set<string>();

      // Scan import declarations for potential extension functions
      for (const stmt of sourceFile.statements) {
        if (!tsModule.isImportDeclaration(stmt)) continue;

        const clause = stmt.importClause;
        if (!clause) continue;

        // Handle named imports: import { foo, bar } from "module"
        if (clause.namedBindings && tsModule.isNamedImports(clause.namedBindings)) {
          for (const spec of clause.namedBindings.elements) {
            const name = spec.name.text;
            if (seen.has(name)) continue;

            const symbol = checker.getSymbolAtLocation(spec.name);
            if (!symbol) continue;

            // Resolve alias if necessary
            const resolved = checker.getAliasedSymbol(symbol);
            const targetSymbol = resolved ?? symbol;

            if (isFirstParamCompatible(checker, targetSymbol, receiverType)) {
              seen.add(name);
              extensions.push({
                name,
                kind: tsModule.ScriptElementKind.functionElement,
                sortText: "1" + name, // Sort after native methods
                insertText: `${name}()`,
                labelDetails: {
                  description: "(extension)",
                },
              });
            }
          }
        }

        // Handle namespace imports: import * as Ext from "module"
        if (clause.namedBindings && tsModule.isNamespaceImport(clause.namedBindings)) {
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
                kind: tsModule.ScriptElementKind.functionElement,
                sortText: "1" + name,
                insertText: `${name}()`,
                labelDetails: {
                  description: `(extension from ${clause.namedBindings.name.text})`,
                },
              });
            }
          }
        }
      }

      return extensions;
    }

    /**
     * Detect if we're in a property access context (after a dot)
     */
    function getReceiverTypeAtPosition(
      sourceFile: ts.SourceFile,
      position: number,
      checker: ts.TypeChecker
    ): ts.Type | null {
      // Find the node at this position
      function findNodeAtPosition(node: ts.Node): ts.Node | undefined {
        if (position >= node.getStart() && position <= node.getEnd()) {
          return tsModule.forEachChild(node, findNodeAtPosition) || node;
        }
        return undefined;
      }

      const node = findNodeAtPosition(sourceFile);
      if (!node) return null;

      // Check if we're in a property access expression
      let current: ts.Node | undefined = node;
      while (current) {
        if (tsModule.isPropertyAccessExpression(current)) {
          // Get the type of the expression being accessed
          return checker.getTypeAtLocation(current.expression);
        }
        // Check if cursor is right after a dot by looking at parent
        if (current.parent && tsModule.isPropertyAccessExpression(current.parent)) {
          if (
            current === current.parent.name ||
            (position > current.parent.expression.getEnd() &&
              position <= current.parent.name.getEnd())
          ) {
            return checker.getTypeAtLocation(current.parent.expression);
          }
        }
        current = current.parent;
      }

      return null;
    }

    proxy.getCompletionsAtPosition = (
      fileName: string,
      position: number,
      options: ts.GetCompletionsAtPositionOptions | undefined
    ): ts.WithMetadata<ts.CompletionInfo> | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        log(`getCompletionsAtPosition: could not map position ${position} in ${fileName}`);
        return undefined;
      }

      const result = oldLS.getCompletionsAtPosition(fileName, transformedPosition, options);

      // Map replacement spans back to original coordinates
      const mappedEntries =
        result?.entries.map((entry) => {
          if (entry.replacementSpan) {
            const mappedSpan = mapTextSpanToOriginal(entry.replacementSpan, mapper);
            if (mappedSpan) {
              return { ...entry, replacementSpan: mappedSpan };
            }
          }
          return entry;
        }) ?? [];

      // Try to add extension method completions
      try {
        const program = oldLS.getProgram();
        if (program) {
          const checker = program.getTypeChecker();
          const sourceFile = program.getSourceFile(fileName);

          if (sourceFile) {
            const receiverType = getReceiverTypeAtPosition(
              sourceFile,
              transformedPosition,
              checker
            );

            if (receiverType) {
              const extensionCompletions = getExtensionCompletions(
                sourceFile,
                receiverType,
                checker
              );

              if (extensionCompletions.length > 0) {
                log(
                  `Adding ${extensionCompletions.length} extension completions for ${checker.typeToString(receiverType)}`
                );

                // Filter out extensions that duplicate existing entries
                const existingNames = new Set(mappedEntries.map((e) => e.name));
                const newExtensions = extensionCompletions.filter(
                  (e) => !existingNames.has(e.name)
                );

                mappedEntries.push(...newExtensions);
              }
            }
          }
        }
      } catch (error) {
        log(`Error getting extension completions: ${error}`);
      }

      if (mappedEntries.length === 0 && !result) {
        return undefined;
      }

      return {
        ...result,
        isGlobalCompletion: result?.isGlobalCompletion ?? false,
        isMemberCompletion: result?.isMemberCompletion ?? true,
        isNewIdentifierLocation: result?.isNewIdentifierLocation ?? false,
        entries: mappedEntries,
      } as ts.WithMetadata<ts.CompletionInfo>;
    };

    proxy.getQuickInfoAtPosition = (
      fileName: string,
      position: number
    ): ts.QuickInfo | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        log(`getQuickInfoAtPosition: could not map position ${position} in ${fileName}`);
        return undefined;
      }

      const result = oldLS.getQuickInfoAtPosition(fileName, transformedPosition);

      if (!result) return result;

      // Map the textSpan back to original coordinates
      const mappedSpan = mapTextSpanToOriginal(result.textSpan, mapper);
      if (!mappedSpan) return undefined;

      return {
        ...result,
        textSpan: mappedSpan,
      };
    };

    proxy.getDefinitionAtPosition = (
      fileName: string,
      position: number
    ): readonly ts.DefinitionInfo[] | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        log(`getDefinitionAtPosition: could not map position ${position} in ${fileName}`);
        return undefined;
      }

      const definitions = oldLS.getDefinitionAtPosition(fileName, transformedPosition);

      if (!definitions) return definitions;

      return definitions.map((def) => {
        const targetMapper = getMapper(def.fileName);
        const mappedSpan = mapTextSpanToOriginal(def.textSpan, targetMapper);

        if (!mappedSpan) {
          return def;
        }

        let mappedContextSpan = def.contextSpan;
        if (def.contextSpan) {
          mappedContextSpan =
            mapTextSpanToOriginal(def.contextSpan, targetMapper) ?? def.contextSpan;
        }

        return {
          ...def,
          textSpan: mappedSpan,
          contextSpan: mappedContextSpan,
        };
      });
    };

    proxy.getDefinitionAndBoundSpan = (
      fileName: string,
      position: number
    ): ts.DefinitionInfoAndBoundSpan | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        log(`getDefinitionAndBoundSpan: could not map position ${position} in ${fileName}`);
        return undefined;
      }

      const result = oldLS.getDefinitionAndBoundSpan(fileName, transformedPosition);

      if (!result) return result;

      const mappedTextSpan = mapTextSpanToOriginal(result.textSpan, mapper);
      if (!mappedTextSpan) return undefined;

      const mappedDefinitions = result.definitions?.map((def) => {
        const targetMapper = getMapper(def.fileName);
        const mappedDefSpan = mapTextSpanToOriginal(def.textSpan, targetMapper);

        if (!mappedDefSpan) return def;

        let mappedContextSpan = def.contextSpan;
        if (def.contextSpan) {
          mappedContextSpan =
            mapTextSpanToOriginal(def.contextSpan, targetMapper) ?? def.contextSpan;
        }

        return {
          ...def,
          textSpan: mappedDefSpan,
          contextSpan: mappedContextSpan,
        };
      });

      return {
        textSpan: mappedTextSpan,
        definitions: mappedDefinitions,
      };
    };

    proxy.getTypeDefinitionAtPosition = (
      fileName: string,
      position: number
    ): readonly ts.DefinitionInfo[] | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        return undefined;
      }

      const definitions = oldLS.getTypeDefinitionAtPosition(fileName, transformedPosition);

      if (!definitions) return definitions;

      return definitions.map((def) => {
        const targetMapper = getMapper(def.fileName);
        const mappedSpan = mapTextSpanToOriginal(def.textSpan, targetMapper);

        if (!mappedSpan) return def;

        let mappedContextSpan = def.contextSpan;
        if (def.contextSpan) {
          mappedContextSpan =
            mapTextSpanToOriginal(def.contextSpan, targetMapper) ?? def.contextSpan;
        }

        return {
          ...def,
          textSpan: mappedSpan,
          contextSpan: mappedContextSpan,
        };
      });
    };

    proxy.getReferencesAtPosition = (
      fileName: string,
      position: number
    ): ts.ReferenceEntry[] | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        return undefined;
      }

      const references = oldLS.getReferencesAtPosition(fileName, transformedPosition);

      if (!references) return references;

      const mapped: ts.ReferenceEntry[] = [];
      for (const ref of references) {
        const targetMapper = getMapper(ref.fileName);
        const mappedSpan = mapTextSpanToOriginal(ref.textSpan, targetMapper);

        if (!mappedSpan) continue;

        const result: ts.ReferenceEntry = {
          ...ref,
          textSpan: mappedSpan,
        };

        if (ref.contextSpan) {
          result.contextSpan =
            mapTextSpanToOriginal(ref.contextSpan, targetMapper) ?? ref.contextSpan;
        }

        mapped.push(result);
      }

      return mapped;
    };

    proxy.findReferences = (
      fileName: string,
      position: number
    ): ts.ReferencedSymbol[] | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        return undefined;
      }

      const symbols = oldLS.findReferences(fileName, transformedPosition);

      if (!symbols) return symbols;

      return symbols.map((symbol) => {
        const defMapper = getMapper(symbol.definition.fileName);
        const mappedDefSpan = mapTextSpanToOriginal(symbol.definition.textSpan, defMapper);

        const mappedDef: ts.ReferencedSymbolDefinitionInfo = {
          ...symbol.definition,
          textSpan: mappedDefSpan ?? symbol.definition.textSpan,
        };

        if (symbol.definition.contextSpan) {
          mappedDef.contextSpan =
            mapTextSpanToOriginal(symbol.definition.contextSpan, defMapper) ??
            symbol.definition.contextSpan;
        }

        const mappedReferences: ts.ReferencedSymbolEntry[] = [];
        for (const ref of symbol.references) {
          const refMapper = getMapper(ref.fileName);
          const mappedRefSpan = mapTextSpanToOriginal(ref.textSpan, refMapper);

          if (!mappedRefSpan) continue;

          const mappedRef: ts.ReferencedSymbolEntry = {
            ...ref,
            textSpan: mappedRefSpan,
          };

          if (ref.contextSpan) {
            mappedRef.contextSpan =
              mapTextSpanToOriginal(ref.contextSpan, refMapper) ?? ref.contextSpan;
          }

          mappedReferences.push(mappedRef);
        }

        return {
          definition: mappedDef,
          references: mappedReferences,
        };
      });
    };

    proxy.getSignatureHelpItems = (
      fileName: string,
      position: number,
      options: ts.SignatureHelpItemsOptions | undefined
    ): ts.SignatureHelpItems | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        return undefined;
      }

      const result = oldLS.getSignatureHelpItems(fileName, transformedPosition, options);

      if (!result) return result;

      const mappedApplicableSpan = mapTextSpanToOriginal(result.applicableSpan, mapper);

      return {
        ...result,
        applicableSpan: mappedApplicableSpan ?? result.applicableSpan,
      };
    };

    proxy.getRenameInfo = (
      fileName: string,
      position: number,
      options?: ts.RenameInfoOptions
    ): ts.RenameInfo => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        return {
          canRename: false,
          localizedErrorMessage: "Cannot rename in macro-generated code",
        };
      }

      const result = oldLS.getRenameInfo(fileName, transformedPosition, options);

      if (!result.canRename) return result;

      const mappedTriggerSpan = mapTextSpanToOriginal(result.triggerSpan, mapper);

      if (!mappedTriggerSpan) {
        return {
          canRename: false,
          localizedErrorMessage: "Cannot rename macro-generated identifier",
        };
      }

      return {
        ...result,
        triggerSpan: mappedTriggerSpan,
      };
    };

    proxy.findRenameLocations = (
      fileName: string,
      position: number,
      findInStrings: boolean,
      findInComments: boolean,
      preferences?: boolean | ts.UserPreferences
    ): readonly ts.RenameLocation[] | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        return undefined;
      }

      const locations =
        typeof preferences === "object"
          ? oldLS.findRenameLocations(
              fileName,
              transformedPosition,
              findInStrings,
              findInComments,
              preferences
            )
          : oldLS.findRenameLocations(
              fileName,
              transformedPosition,
              findInStrings,
              findInComments,
              preferences as boolean | undefined
            );

      if (!locations) return locations;

      const mapped: ts.RenameLocation[] = [];
      for (const loc of locations) {
        const targetMapper = getMapper(loc.fileName);
        const mappedSpan = mapTextSpanToOriginal(loc.textSpan, targetMapper);

        if (!mappedSpan) continue;

        const result: ts.RenameLocation = {
          ...loc,
          textSpan: mappedSpan,
        };

        if (loc.contextSpan) {
          result.contextSpan =
            mapTextSpanToOriginal(loc.contextSpan, targetMapper) ?? loc.contextSpan;
        }

        mapped.push(result);
      }

      return mapped;
    };

    proxy.getDocumentHighlights = (
      fileName: string,
      position: number,
      filesToSearch: string[]
    ): ts.DocumentHighlights[] | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        return undefined;
      }

      const highlights = oldLS.getDocumentHighlights(fileName, transformedPosition, filesToSearch);

      if (!highlights) return highlights;

      return highlights.map((docHighlight) => {
        const targetMapper = getMapper(docHighlight.fileName);

        const mappedSpans: ts.HighlightSpan[] = [];
        for (const span of docHighlight.highlightSpans) {
          const mappedTextSpan = mapTextSpanToOriginal(span.textSpan, targetMapper);
          if (!mappedTextSpan) continue;

          const result: ts.HighlightSpan = {
            ...span,
            textSpan: mappedTextSpan,
          };

          if (span.contextSpan) {
            result.contextSpan =
              mapTextSpanToOriginal(span.contextSpan, targetMapper) ?? span.contextSpan;
          }

          mappedSpans.push(result);
        }

        return {
          fileName: docHighlight.fileName,
          highlightSpans: mappedSpans,
        };
      });
    };

    log("Language service proxy created with transform-first architecture");

    // ---------------------------------------------------------------------------
    // CRITICAL: Force the TS server to re-read files through our modified host
    // The tsserver may have cached file content before our plugin loaded.
    // We need to trigger a re-sync of all project files.
    // ---------------------------------------------------------------------------

    // Mark the project as needing a program update
    // This is a workaround for the fact that the TS server caches content
    // before plugins have a chance to modify the host.
    try {
      const project = info.project as unknown as Record<string, unknown>;
      if (project && typeof project.markAsDirty === "function") {
        log("Marking project as dirty to force re-read of files");
        (project.markAsDirty as () => void)();
      }

      // Also try to update the project graph if available
      if (project && typeof project.updateGraph === "function") {
        log("Requesting project graph update");
        (project.updateGraph as () => void)();
      }
    } catch (error) {
      log(`Error forcing project refresh: ${error}`);
    }

    return proxy;
  }

  return { create, getExternalFiles };
}

export default init;
