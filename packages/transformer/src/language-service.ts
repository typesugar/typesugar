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
import { TransformationPipeline, type TransformResult } from "./pipeline.js";
import { IdentityPositionMapper, type PositionMapper } from "./position-mapper.js";


/**
 * Cache entry for transformed files
 */
interface TransformCacheEntry {
  result: TransformResult;
  version: string;
}

function init(modules: { typescript: typeof ts }) {
  console.log("[typesugar] Language service plugin v2 (transform-first) initializing...");
  const tsModule = modules.typescript;

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    console.log(
      "[typesugar] Creating language service proxy for project:",
      info.project.getProjectName()
    );

    const log = (msg: string) => {
      info.project.projectService.logger.info(`[typesugar] ${msg}`);
    };

    log("typesugar language service plugin v2 initialized");

    // ---------------------------------------------------------------------------
    // Transform cache and pipeline
    // ---------------------------------------------------------------------------
    const transformCache = new Map<string, TransformCacheEntry>();
    let pipeline: TransformationPipeline | null = null;

    // Store original host methods BEFORE we modify them
    const originalHost = info.languageServiceHost;
    const boundGetScriptSnapshot = originalHost.getScriptSnapshot.bind(originalHost);
    const boundGetScriptVersion = originalHost.getScriptVersion.bind(originalHost);

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

      // Invalidate stale cache entry
      if (cached) {
        p.invalidate(normalizedFileName);
      }

      try {
        const result = p.transform(normalizedFileName);

        if (result.diagnostics.length > 0) {
          log(`Pipeline diagnostics for ${normalizedFileName}: ${result.diagnostics.length}`);
          for (const d of result.diagnostics) {
            log(`  [${d.severity}] ${d.message} (at ${d.start})`);
          }
        }

        if (result.changed) {
          transformCache.set(normalizedFileName, {
            result,
            version: currentVersion,
          });
          log(`Transformed ${normalizedFileName} (changed, ${result.code.length} chars)`);
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
    // Intercept the original host to serve transformed content.
    // oldLS re-reads from the host when the version string changes.
    // ---------------------------------------------------------------------------

    const wrappedGetScriptSnapshot = (fileName: string): ts.IScriptSnapshot | undefined => {
      const result = getTransformResult(fileName);

      if (result && result.changed) {
        return tsModule.ScriptSnapshot.fromString(result.code);
      }

      return boundGetScriptSnapshot(fileName);
    };

    const wrappedGetScriptVersion = (fileName: string): string => {
      const baseVersion = boundGetScriptVersion(fileName);
      const result = getTransformResult(fileName);
      if (result?.changed) {
        return `${baseVersion}-ts-${result.code.length}`;
      }
      return baseVersion;
    };

    // Modify the original host (for the existing LS)
    originalHost.getScriptSnapshot = wrappedGetScriptSnapshot;
    originalHost.getScriptVersion = wrappedGetScriptVersion;

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
      const diagnostics = oldLS.getSemanticDiagnostics(fileName);
      const mapped = mapDiagnostics(diagnostics, fileName);
      if (mapped.length > 0) {
        log(
          `Semantic diagnostics for ${path.basename(fileName)}: ${diagnostics.length} raw → ${mapped.length} mapped`
        );
      }
      return mapped;
    };

    proxy.getSyntacticDiagnostics = (fileName: string): ts.DiagnosticWithLocation[] => {
      const diagnostics = oldLS.getSyntacticDiagnostics(fileName);
      return mapDiagnostics(diagnostics, fileName);
    };

    proxy.getSuggestionDiagnostics = (fileName: string): ts.DiagnosticWithLocation[] => {
      const diagnostics = oldLS.getSuggestionDiagnostics(fileName);
      return mapDiagnostics(diagnostics, fileName);
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

      if (!result) return result;

      // Map replacement spans back to original coordinates
      const mappedEntries = result.entries.map((entry) => {
        if (entry.replacementSpan) {
          const mappedSpan = mapTextSpanToOriginal(entry.replacementSpan, mapper);
          if (mappedSpan) {
            return { ...entry, replacementSpan: mappedSpan };
          }
        }
        return entry;
      });

      return {
        ...result,
        entries: mappedEntries,
      };
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

  return { create };
}

export default init;
