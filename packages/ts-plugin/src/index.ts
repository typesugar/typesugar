/**
 * TypeScript Language Service Plugin for typesugar
 *
 * This plugin transforms source files before TypeScript processes them,
 * using the unified TransformationPipeline from @typesugar/transformer.
 *
 * Key features:
 * - Transforms custom syntax (|>, ::, F<_>) to valid TypeScript
 * - Expands macros (@derive, comptime, etc.)
 * - Maps diagnostics, completions, and definitions back to original positions
 * - Caches transformation results for performance
 */

import * as ts from "typescript";
import * as path from "path";
import {
  TransformationPipeline,
  type TransformResult,
  type PositionMapper,
  IdentityPositionMapper,
} from "@typesugar/transformer";

interface PluginConfig {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Syntax extensions to enable (default: all) */
  extensions?: ("hkt" | "pipeline" | "cons")[];
  /** Use legacy mode (error suppression instead of transformation) */
  legacyMode?: boolean;
}

function init(modules: { typescript: typeof ts }) {
  const typescript = modules.typescript;

  console.log("[typesugar] Language service plugin initializing...");

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const config: PluginConfig = info.config ?? {};
    const verbose = config.verbose ?? false;

    const log = (msg: string) => {
      if (verbose) {
        info.project.projectService.logger.info(`[typesugar] ${msg}`);
      }
    };

    log("Creating language service proxy");

    // If legacy mode is enabled, use the old error-suppression approach
    if (config.legacyMode) {
      log("Legacy mode enabled - using error suppression");
      return createLegacyProxy(info, typescript, log);
    }

    // Transform-first mode: use the pipeline
    return createTransformProxy(info, typescript, config, log);
  }

  return { create };
}

/**
 * Create a transform-first language service proxy
 *
 * This wraps the LanguageServiceHost to serve transformed content,
 * then maps positions back to original source.
 */
function createTransformProxy(
  info: ts.server.PluginCreateInfo,
  ts: typeof import("typescript"),
  config: PluginConfig,
  log: (msg: string) => void
): ts.LanguageService {
  const projectPath = info.project.getProjectName();
  log(`Transform mode for project: ${projectPath}`);

  // Initialize the pipeline lazily
  let pipeline: TransformationPipeline | null = null;
  const mappers = new Map<string, PositionMapper>();
  const transformResults = new Map<string, TransformResult>();

  // Lazy pipeline initialization
  function ensurePipeline(): TransformationPipeline | null {
    if (pipeline) return pipeline;

    try {
      // Find tsconfig.json for this project
      const tsconfigPath = findTsConfig(projectPath);
      if (!tsconfigPath) {
        log(`No tsconfig.json found for ${projectPath}`);
        return null;
      }

      // Import the pipeline dynamically to avoid blocking plugin load
      const { TransformationPipeline: PipelineCtor } = require("@typesugar/transformer");

      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (configFile.error) {
        log(`Error reading tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`);
        return null;
      }

      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfigPath)
      );

      pipeline = new PipelineCtor(parsed.options, parsed.fileNames, {
        verbose: config.verbose,
        extensions: config.extensions,
      });

      log(`Pipeline initialized with ${parsed.fileNames.length} files`);
      return pipeline;
    } catch (error) {
      log(`Failed to initialize pipeline: ${error}`);
      return null;
    }
  }

  // Get transform result for a file (cached)
  function getTransformResult(fileName: string): TransformResult | null {
    // Check cache first
    let result = transformResults.get(fileName);
    if (result) return result;

    const p = ensurePipeline();
    if (!p) return null;

    // Only transform TypeScript files
    if (!p.shouldTransform(fileName)) {
      return null;
    }

    try {
      result = p.transform(fileName);
      transformResults.set(fileName, result);
      mappers.set(fileName, result.mapper);
      return result;
    } catch (error) {
      log(`Transform error for ${fileName}: ${error}`);
      return null;
    }
  }

  // Get position mapper for a file
  function getMapper(fileName: string): PositionMapper {
    const existing = mappers.get(fileName);
    if (existing) return existing;

    const result = getTransformResult(fileName);
    if (result) return result.mapper;

    return new IdentityPositionMapper();
  }

  // Wrap the language service host to serve transformed content
  const originalHost = info.languageServiceHost;
  const wrappedHost: ts.LanguageServiceHost = {
    ...originalHost,

    getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
      const result = getTransformResult(fileName);
      if (result?.changed) {
        log(`Serving transformed content for ${fileName}`);
        return ts.ScriptSnapshot.fromString(result.code);
      }
      return originalHost.getScriptSnapshot(fileName);
    },

    getScriptVersion(fileName: string): string {
      // Include transform result in version to trigger re-check on transform change
      const result = getTransformResult(fileName);
      const baseVersion = originalHost.getScriptVersion(fileName);
      if (result?.changed) {
        // Use hash of transformed code to detect changes
        return `${baseVersion}-transformed`;
      }
      return baseVersion;
    },
  };

  // Create new language service with wrapped host
  const ls = ts.createLanguageService(wrappedHost);

  // Create proxy that maps positions back to original
  const proxy = Object.create(null) as ts.LanguageService;
  for (const k of Object.keys(ls) as (keyof ts.LanguageService)[]) {
    const method = ls[k];
    if (typeof method === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (proxy as any)[k] = method.bind(ls);
    }
  }

  // Override methods that return positions to map them back to original
  proxy.getSemanticDiagnostics = (fileName: string) => {
    const diags = ls.getSemanticDiagnostics(fileName);
    const mapper = getMapper(fileName);
    return diags.map((d) => mapper.mapDiagnostic(d));
  };

  proxy.getSyntacticDiagnostics = (fileName: string) => {
    const diags = ls.getSyntacticDiagnostics(fileName);
    const mapper = getMapper(fileName);
    return diags.map((d) => mapper.mapDiagnostic(d) as ts.DiagnosticWithLocation);
  };

  proxy.getSuggestionDiagnostics = (fileName: string) => {
    const diags = ls.getSuggestionDiagnostics(fileName);
    const mapper = getMapper(fileName);
    return diags.map((d) => mapper.mapDiagnostic(d) as ts.DiagnosticWithLocation);
  };

  proxy.getCompletionsAtPosition = (
    fileName: string,
    position: number,
    options?: ts.GetCompletionsAtPositionOptions
  ) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    return ls.getCompletionsAtPosition(fileName, transformedPos, options);
  };

  proxy.getCompletionEntryDetails = (
    fileName: string,
    position: number,
    entryName: string,
    formatOptions?: ts.FormatCodeOptions | ts.FormatCodeSettings,
    source?: string,
    preferences?: ts.UserPreferences,
    data?: ts.CompletionEntryData
  ) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    return ls.getCompletionEntryDetails(
      fileName,
      transformedPos,
      entryName,
      formatOptions,
      source,
      preferences,
      data
    );
  };

  proxy.getDefinitionAtPosition = (fileName: string, position: number) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    const definitions = ls.getDefinitionAtPosition(fileName, transformedPos);

    // Map definition positions back to original
    return definitions?.map((def) => {
      const defMapper = getMapper(def.fileName);
      if (def.textSpan) {
        const originalStart = defMapper.toOriginal(def.textSpan.start);
        if (originalStart !== null) {
          return {
            ...def,
            textSpan: { start: originalStart, length: def.textSpan.length },
          };
        }
      }
      return def;
    });
  };

  proxy.getDefinitionAndBoundSpan = (fileName: string, position: number) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    const result = ls.getDefinitionAndBoundSpan(fileName, transformedPos);

    if (result) {
      // Map the text span back to original
      const originalStart = mapper.toOriginal(result.textSpan.start);
      const mappedSpan = originalStart !== null
        ? { start: originalStart, length: result.textSpan.length }
        : result.textSpan;

      // Map definitions
      const definitions = result.definitions?.map((def) => {
        const defMapper = getMapper(def.fileName);
        if (def.textSpan) {
          const defOriginalStart = defMapper.toOriginal(def.textSpan.start);
          if (defOriginalStart !== null) {
            return {
              ...def,
              textSpan: { start: defOriginalStart, length: def.textSpan.length },
            };
          }
        }
        return def;
      });

      return {
        ...result,
        textSpan: mappedSpan,
        definitions,
      };
    }

    return result;
  };

  proxy.getQuickInfoAtPosition = (fileName: string, position: number) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    const info = ls.getQuickInfoAtPosition(fileName, transformedPos);

    if (info?.textSpan) {
      const originalStart = mapper.toOriginal(info.textSpan.start);
      if (originalStart !== null) {
        return {
          ...info,
          textSpan: { start: originalStart, length: info.textSpan.length },
        };
      }
    }

    return info;
  };

  proxy.getReferencesAtPosition = (fileName: string, position: number) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    const refs = ls.getReferencesAtPosition(fileName, transformedPos);

    return refs?.map((ref) => {
      const refMapper = getMapper(ref.fileName);
      const originalStart = refMapper.toOriginal(ref.textSpan.start);
      if (originalStart !== null) {
        return {
          ...ref,
          textSpan: { start: originalStart, length: ref.textSpan.length },
        };
      }
      return ref;
    });
  };

  proxy.findReferences = (fileName: string, position: number) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    const results = ls.findReferences(fileName, transformedPos);

    return results?.map((result) => ({
      ...result,
      references: result.references.map((ref) => {
        const refMapper = getMapper(ref.fileName);
        const originalStart = refMapper.toOriginal(ref.textSpan.start);
        if (originalStart !== null) {
          return {
            ...ref,
            textSpan: { start: originalStart, length: ref.textSpan.length },
          };
        }
        return ref;
      }),
    }));
  };

  proxy.getSignatureHelpItems = (
    fileName: string,
    position: number,
    options?: ts.SignatureHelpItemsOptions
  ) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    const items = ls.getSignatureHelpItems(fileName, transformedPos, options);

    if (items?.applicableSpan) {
      const originalStart = mapper.toOriginal(items.applicableSpan.start);
      if (originalStart !== null) {
        return {
          ...items,
          applicableSpan: { start: originalStart, length: items.applicableSpan.length },
        };
      }
    }

    return items;
  };

  proxy.getRenameInfo = (fileName: string, position: number, options?: ts.RenameInfoOptions) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    const info = ls.getRenameInfo(fileName, transformedPos, options);

    if (info.canRename && info.triggerSpan) {
      const originalStart = mapper.toOriginal(info.triggerSpan.start);
      if (originalStart !== null) {
        return {
          ...info,
          triggerSpan: { start: originalStart, length: info.triggerSpan.length },
        };
      }
    }

    return info;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (proxy as any).findRenameLocations = (
    fileName: string,
    position: number,
    findInStrings: boolean,
    findInComments: boolean,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    preferences?: any
  ) => {
    const mapper = getMapper(fileName);
    const transformedPos = mapper.toTransformed(position) ?? position;
    const locations = ls.findRenameLocations(
      fileName,
      transformedPos,
      findInStrings,
      findInComments,
      preferences
    );

    return locations?.map((loc) => {
      const locMapper = getMapper(loc.fileName);
      const originalStart = locMapper.toOriginal(loc.textSpan.start);
      if (originalStart !== null) {
        return {
          ...loc,
          textSpan: { start: originalStart, length: loc.textSpan.length },
        };
      }
      return loc;
    });
  };

  log("Transform proxy created");
  return proxy;
}

/**
 * Create a legacy error-suppression proxy
 *
 * This is the fallback mode that just suppresses errors for typesugar syntax.
 */
function createLegacyProxy(
  info: ts.server.PluginCreateInfo,
  ts: typeof import("typescript"),
  log: (msg: string) => void
): ts.LanguageService {
  // Import the legacy implementation
  // This is the existing error-suppression logic from language-service.ts
  const legacyPlugin = require("@typesugar/transformer/language-service");
  const init = legacyPlugin.default || legacyPlugin;

  // Create using the legacy init function
  return init({ typescript: ts }).create(info);
}

/**
 * Find tsconfig.json for a project
 */
function findTsConfig(projectPath: string): string | undefined {
  // Check if projectPath is already a tsconfig.json
  if (projectPath.endsWith("tsconfig.json")) {
    return projectPath;
  }

  // Search upward from project path
  let dir = projectPath;
  while (dir) {
    const candidate = path.join(dir, "tsconfig.json");
    if (ts.sys.fileExists(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

export = init;
