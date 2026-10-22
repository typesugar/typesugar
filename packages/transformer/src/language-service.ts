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
import * as fs from "fs";
import {
  TransformationPipeline,
  type TransformResult,
  type TransformDiagnostic,
} from "./pipeline.js";
import { IdentityPositionMapper, type PositionMapper } from "./position-mapper.js";
import {
  config as typesugarConfig,
  filterDiagnostics,
  getDiagnosticSuppressionRules,
  isDiagnosticSuppressionAuditEnabled,
  assertSupportedTypeScript,
  type PositionMapFn,
} from "@typesugar/core";
import {
  registerAllDiagnosticSuppressionRules,
  setComptimeEvaluationEnabled,
} from "@typesugar/macros";
import { hashContent } from "./cache.js";
import {
  mapTextSpanToOriginal,
  mapSourceSpanToOriginal,
  mapTextSpanToTransformed,
  computeMacroCodeActions,
  type MacroManifest,
} from "@typesugar/lsp-common";

/**
 * Cache entry for transformed files
 */
interface TransformCacheEntry {
  result: TransformResult;
  version: string;
  /**
   * Script versions of the file's (transitive) dependencies when it was
   * transformed. A changed dependency (e.g. an edited type a macro
   * inspects) re-transforms the dependent (review finding #17).
   */
  depVersions: Map<string, string>;
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

// ---------------------------------------------------------------------------
// Editor-facing surface beyond the LanguageService (PEP-060 D5: this plugin is
// the single editor engine for 1.0, so the VS Code extension's expansion views
// talk to it through custom tsserver requests instead of a separate LSP).
// ---------------------------------------------------------------------------

/**
 * Custom tsserver request: `{ file, position }` → `{ macroName, expandedText } | null`.
 * The leading `_` is what VS Code's `typescript.tsserverRequest` command
 * requires of a non-built-in request.
 */
export const EXPAND_MACRO_REQUEST = "_typesugar.expandMacro";
/** Custom tsserver request: `{ file }` → `{ original, transformed, changed } | null`. */
export const SHOW_TRANSFORMED_REQUEST = "_typesugar.showTransformed";

export interface ExpandMacroResponse {
  macroName: string;
  expandedText: string;
}
export interface ShowTransformedResponse {
  original: string;
  transformed: string;
  changed: boolean;
}

/**
 * What one live plugin instance (one project) exposes to the request handlers
 * and to a duplicate load of the plugin. Kept to plain methods so that two
 * copies of this module (the project's own `@typesugar/transformer` and the
 * one the VS Code extension bundles) can call each other's instances.
 */
interface PluginInstance {
  hasFile(fileName: string): boolean;
  showTransformed(fileName: string): ShowTransformedResponse | null;
  expandMacroAt(fileName: string, position: number): ExpandMacroResponse | null;
  applyEditorConfig(config: unknown): void;
}

/** Set on the project's LanguageServiceHost by the first load of the plugin. */
const ACTIVE_INSTANCE = Symbol.for("typesugar.languageService.activeInstance");
/** Per-session registry of live instances, shared across module copies. */
const SESSION_INSTANCES = Symbol.for("typesugar.languageService.sessionInstances");

interface ProtocolSession {
  addProtocolHandler(
    command: string,
    handler: (request: ts.server.protocol.Request) => ts.server.HandlerResponse
  ): void;
  [SESSION_INSTANCES]?: Set<PluginInstance>;
}

/**
 * Register the custom requests on tsserver's session once, and return the
 * session's instance registry. Every project's plugin instance adds itself to
 * the registry; a request is answered by the instance whose project has the
 * file. This is a live registry read at request time, not a snapshot.
 */
function registerSessionHandlers(
  session: ProtocolSession,
  log: (msg: string) => void
): Set<PluginInstance> {
  const existing = session[SESSION_INSTANCES];
  if (existing) return existing;
  const instances = new Set<PluginInstance>();
  session[SESSION_INSTANCES] = instances;

  const answer = (
    request: ts.server.protocol.Request,
    run: (inst: PluginInstance, file: string, args: Record<string, unknown>) => object | null
  ): ts.server.HandlerResponse => {
    const args = (request.arguments ?? {}) as Record<string, unknown>;
    const file = typeof args.file === "string" ? args.file : undefined;
    if (file) {
      for (const inst of instances) {
        if (inst.hasFile(file)) {
          // "No result" goes out as a response without a body.
          return { response: run(inst, file, args) ?? undefined, responseRequired: true };
        }
      }
    }
    return { response: undefined, responseRequired: true };
  };

  try {
    session.addProtocolHandler(SHOW_TRANSFORMED_REQUEST, (request) =>
      answer(request, (inst, file) => inst.showTransformed(file))
    );
    session.addProtocolHandler(EXPAND_MACRO_REQUEST, (request) =>
      answer(request, (inst, file, args) =>
        typeof args.position === "number" ? inst.expandMacroAt(file, args.position) : null
      )
    );
  } catch (error) {
    log(`Could not register typesugar tsserver requests: ${error}`);
  }
  return instances;
}

/** True when `comptimeInEditor` in the plugin config came from the editor, not the repo. */
function trustedComptimeOptIn(info: ts.server.PluginCreateInfo, log: (msg: string) => void) {
  const cfg = info.config as { comptimeInEditor?: unknown } | undefined;
  if (cfg?.comptimeInEditor !== true) return false;
  // tsserver merges an editor's `configurePlugin` override into the tsconfig
  // entry, so look at the tsconfig entries themselves: a repository must not be
  // able to switch on running its own comptime code in the editor.
  const tsconfigPlugins = (info.project.getCompilerOptions().plugins ?? []) as unknown[];
  const fromRepo = tsconfigPlugins.some(
    (p) => !!p && typeof p === "object" && "comptimeInEditor" in (p as object)
  );
  if (fromRepo) {
    log(
      "Ignoring `comptimeInEditor` from tsconfig.json: only the editor (VS Code setting " +
        "`typesugar.comptimeInEditor`) or TYPESUGAR_COMPTIME_IN_EDITOR=1 can enable it"
    );
    return false;
  }
  return true;
}

/**
 * Line starts of `text`, with TypeScript's line breaks (CR, LF, CRLF, U+2028,
 * U+2029), so line/column results match what tsserver computes for the file.
 */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 13 /* \r */) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    } else if (ch === 10 || ch === 0x2028 || ch === 0x2029) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineAndCharacterOf(lineStarts: number[], position: number): ts.LineAndCharacter {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= position) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: position - lineStarts[lo] };
}

/**
 * Is this tsserver project a dependency's: its tsconfig (or, for a
 * non-configured project, its directory) inside a node_modules directory,
 * by path or by real path?
 */
function isDependencyProject(projectName: string): boolean {
  const inNodeModules = (p: string) => p.split(/[\\/]/).includes("node_modules");
  if (inNodeModules(projectName)) return true;
  try {
    return inNodeModules(fs.realpathSync(projectName));
  } catch {
    return false;
  }
}

function init(modules: { typescript: typeof ts }) {
  console.log("[typesugar] Language service plugin v2 (transform-first) initializing...");
  const tsModule = modules.typescript;
  // PEP-060 item 1: tsserver hands us ITS TypeScript, which can differ from the
  // one in node_modules; reject anything without the JS compiler API up front.
  assertSupportedTypeScript(tsModule);

  /**
   * tsserver calls init() once per project and keeps the returned module per
   * project, so this is the instance `onConfigurationChanged` must reach: our
   * own, or (for a duplicate load that stood down) the one already active.
   */
  let configTarget: PluginInstance | undefined;

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
      /packages[\\/](transformer|core|macros|preprocessor|ts-plugin|eslint-plugin|prettier-plugin)[\\/]/;
    if (projectName.includes("/dev/null/inferredProject") || infraPattern.test(projectName)) {
      log(`Skipping typesugar plugin for non-user project: ${projectName}`);
      return info.languageService;
    }
    // 3. A dependency's own project. Opening a file inside node_modules gives
    //    it the dependency's tsconfig (node_modules/evil/tsconfig.json) as its
    //    project; expanding macros there would load that dependency's config
    //    and its macros as if it were the user's project (review 8). A
    //    dependency is not the project (SECURITY.md): the editor ignores it.
    if (isDependencyProject(projectName)) {
      log(`Skipping typesugar plugin for a project inside node_modules: ${projectName}`);
      return info.languageService;
    }

    // Loaded twice for one project — e.g. tsconfig lists
    // `@typesugar/transformer/language-service` and the VS Code extension adds
    // `@typesugar/ts-plugin` globally (tsserver only de-duplicates identical
    // names). A second wrap would transform already-transformed code, so the
    // later load stands down and forwards editor configuration to the first.
    const hostMarks = info.languageServiceHost as unknown as Record<symbol, unknown>;
    const alreadyActive = hostMarks[ACTIVE_INSTANCE] as PluginInstance | undefined;
    if (alreadyActive) {
      log("typesugar plugin is already active for this project; this second load does nothing");
      configTarget = alreadyActive;
      if (trustedComptimeOptIn(info, log)) {
        alreadyActive.applyEditorConfig({ comptimeInEditor: true });
      }
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

    /**
     * comptime in the editor runs the repository's code with the editor's
     * privileges, so it is off unless the user opted in: through the editor
     * (VS Code's `typesugar.comptimeInEditor`, sent with tsserver's
     * `configurePlugin`) or TYPESUGAR_COMPTIME_IN_EDITOR=1. Never via tsconfig.
     */
    let editorComptimeOptIn = trustedComptimeOptIn(info, log);
    const comptimeEnabled = () =>
      process.env.TYPESUGAR_COMPTIME_IN_EDITOR === "1" || editorComptimeOptIn;

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

        // Opening a repository in an editor must not run that repository's
        // comptime code unless the user opts in; disabled comptime calls are
        // left unexpanded with a warning.
        setComptimeEvaluationEnabled(comptimeEnabled());

        // Load the project's typesugar config from the project directory
        // (tsserver's cwd is unrelated to the project).
        // tsserver serves every open project from one process, and config
        // is read through one process-wide `config`: the pipeline keeps this
        // project's (`config` below) so another project's never applies here.
        const projectDir = projectName.endsWith(".json")
          ? path.dirname(projectName)
          : (info.project.getCurrentDirectory?.() ?? undefined);
        if (projectDir) typesugarConfig.load({ searchFrom: projectDir });

        pipeline = new TransformationPipeline(compilerOptions, fileNames, {
          config: projectDir ? typesugarConfig.capture() : undefined,
          // Opt-in (plugin config `"verbose": true` or TYPESUGAR_VERBOSE=1);
          // was hard-coded on, flooding the tsserver log (review #20).
          verbose:
            (info.config as { verbose?: boolean } | undefined)?.verbose === true ||
            process.env.TYPESUGAR_VERBOSE === "1",
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
     * The pipeline already maps their positions back to ORIGINAL-source
     * coordinates (through the HKT / comprehension rewrites), the same space
     * the mapped TS diagnostics are reported in.
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
        let depsUnchanged = true;
        for (const [dep, version] of cached.depVersions) {
          if (boundGetScriptVersion(dep) !== version) {
            p.invalidate(dep);
            depsUnchanged = false;
          }
        }
        if (depsUnchanged) return cached.result;
      }

      // Invalidate stale cache entry and clear associated diagnostic caches
      if (cached) {
        p.invalidate(normalizedFileName);
      }
      rawMacroDiagnosticCache.delete(normalizedFileName);
      suggestionCache.delete(normalizedFileName);

      try {
        // The comptime switch is process-global; set it from THIS project's
        // opt-in each time, since another project's plugin may have set it.
        setComptimeEvaluationEnabled(comptimeEnabled());
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

        const depVersions = new Map<string, string>();
        for (const dep of result.dependencies ?? []) {
          depVersions.set(dep, boundGetScriptVersion(dep));
        }
        // Cache unchanged results too, so we don't re-transform on every
        // getSemanticDiagnostics call.
        transformCache.set(normalizedFileName, {
          result,
          version: currentVersion,
          depVersions,
        });
        if (result.changed) {
          log(`Transformed ${normalizedFileName} (changed, ${result.code.length} chars)`);
        }

        return result;
      } catch (error) {
        log(`Transform error for ${normalizedFileName}: ${error}`);
        return null;
      }
    }

    /**
     * Get the position mapper for a file. A file the transform left unchanged
     * is served to TypeScript as written, so its positions map by identity
     * (whatever source map the pipeline produced is not for the text TS sees).
     */
    function getMapper(fileName: string): PositionMapper {
      const result = getTransformResult(fileName);
      return result?.changed ? result.mapper : new IdentityPositionMapper();
    }

    /** The transform result for a file TypeScript sees in expanded form, else null. */
    function expandedResult(fileName: string): TransformResult | null {
      const result = getTransformResult(path.normalize(fileName));
      return result?.changed ? result : null;
    }

    /**
     * Map a span TypeScript returned in `fileName` that must be the user's own
     * text (a rename location, a reference, an edit's range) to the source.
     * Null when it is in macro-generated code (see mapSourceSpanToOriginal):
     * the caller drops it, by design.
     */
    function toSourceSpan(fileName: string, span: ts.TextSpan): ts.TextSpan | null {
      const result = expandedResult(fileName);
      if (!result) return span;
      return mapSourceSpanToOriginal(span, result.mapper, {
        original: result.original,
        transformed: result.code,
      });
    }

    /**
     * Map edits TypeScript computed on the expanded code back to the source.
     * Null when any edit touches macro-generated code: applying part of a fix
     * or refactor would leave the user's file inconsistent.
     */
    function toSourceEdits(
      changes: readonly ts.FileTextChanges[],
      what: string
    ): ts.FileTextChanges[] | null {
      const mapped: ts.FileTextChanges[] = [];
      for (const fileChange of changes) {
        const textChanges: ts.TextChange[] = [];
        for (const change of fileChange.textChanges) {
          const span = toSourceSpan(fileChange.fileName, change.span);
          if (!span) {
            log(
              `${what} edits macro-generated code in ${path.basename(fileChange.fileName)} ` +
                `(${change.span.start}+${change.span.length}); not offered`
            );
            return null;
          }
          textChanges.push({ ...change, span });
        }
        mapped.push({ ...fileChange, textChanges });
      }
      return mapped;
    }

    /**
     * A request's source span as a range of the expanded code (see
     * mapTextSpanToTransformed): its ends may fall in comments, which have no
     * mapping of their own.
     */
    function toTransformedRange(fileName: string, span: ts.TextSpan): ts.TextSpan | null {
      const result = expandedResult(fileName);
      if (!result) return span;
      return mapTextSpanToTransformed(span, result.mapper, {
        original: result.original.length,
        transformed: result.code.length,
      });
    }

    /** Line starts of the source text, for toLineColumnOffset (cached per transform). */
    const sourceLineStarts = new WeakMap<TransformResult, number[]>();

    // ---------------------------------------------------------------------------
    // Register diagnostic suppression rules
    // ---------------------------------------------------------------------------

    // Register all built-in diagnostic suppression rules via the unified registration function
    // (PEP-034 Wave 1). This prevents drift between IDE paths.
    const positionMapFn: PositionMapFn = (
      fileName: string,
      transformedPos: number
    ): number | null => {
      const mapper = getMapper(fileName);
      return mapper.toOriginal(transformedPos);
    };
    {
      const registered = registerAllDiagnosticSuppressionRules({ positionMapFn });
      for (const name of registered) {
        log(`Registered ${name} diagnostic suppression rule`);
      }
    }

    if (isDiagnosticSuppressionAuditEnabled()) {
      log("Diagnostic suppression audit mode enabled (TYPESUGAR_SHOW_SUPPRESSED_DIAGNOSTICS=1)");
    }

    // ---------------------------------------------------------------------------
    // Intercept the original host to serve transformed content.
    // oldLS re-reads from the host when the version string changes.
    // ---------------------------------------------------------------------------

    const wrappedGetScriptSnapshot = (fileName: string): ts.IScriptSnapshot | undefined => {
      const normalizedFileName = path.normalize(fileName);

      // Try pipeline transformation first
      const result = getTransformResult(normalizedFileName);
      if (result && result.changed) {
        return tsModule.ScriptSnapshot.fromString(result.code);
      }

      return boundGetScriptSnapshot(fileName);
    };

    const wrappedGetScriptVersion = (fileName: string): string => {
      const normalizedFileName = path.normalize(fileName);
      const baseVersion = boundGetScriptVersion(normalizedFileName);
      const result = getTransformResult(normalizedFileName);
      if (result?.changed) {
        // Hash, not length: a re-transform (e.g. after a dependency edit)
        // that produces different code of the same length must still make
        // TS re-read the snapshot.
        return `${baseVersion}-ts-${hashContent(result.code)}`;
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
      const normalizedFileName = path.normalize(fileName);

      // Ensure transformation has run (populates rawMacroDiagnosticCache)
      getTransformResult(normalizedFileName);

      // Get TypeScript's own diagnostics (positions in transformed code)
      const diagnostics = oldLS.getSemanticDiagnostics(fileName);

      // Apply diagnostic suppression filtering before position mapping — this runs all
      // registered rules (including MacroGenerated) to suppress diagnostics
      // that typesugar's rewrite system handles.
      const program = oldLS.getProgram();
      let suppressionFiltered: readonly ts.Diagnostic[];
      if (program && getDiagnosticSuppressionRules().length > 0) {
        const checker = program.getTypeChecker();
        suppressionFiltered = filterDiagnostics(
          diagnostics,
          checker,
          (fn) => program.getSourceFile(fn),
          // This project's program + position map: without it the
          // OperatorOverload rule suppresses nothing and MacroGenerated uses
          // whichever project registered last.
          { program, positionMapFn }
        );
      } else {
        suppressionFiltered = diagnostics;
      }

      // Map remaining diagnostics back to original positions
      const mapped = mapDiagnostics(suppressionFiltered, fileName);

      // Convert raw macro diagnostics to ts.Diagnostic[] now that the program is available
      const rawDiags = rawMacroDiagnosticCache.get(normalizedFileName) ?? [];
      const macroDiags = convertMacroDiagnostics(rawDiags, normalizedFileName);
      const combined = [...mapped, ...macroDiags];

      if (combined.length > 0 || suppressionFiltered.length < diagnostics.length) {
        const suppressedCount = diagnostics.length - suppressionFiltered.length;
        log(
          `Semantic diagnostics for ${path.basename(fileName)}: ` +
            `${diagnostics.length} TS raw → ${suppressionFiltered.length} after diagnostic suppression (${suppressedCount} suppressed) → ` +
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

      // Apply diagnostic suppression filtering to suggestion diagnostics
      const program = oldLS.getProgram();
      let suppressionFiltered: readonly ts.DiagnosticWithLocation[];
      if (program && getDiagnosticSuppressionRules().length > 0) {
        const checker = program.getTypeChecker();
        suppressionFiltered = filterDiagnostics(
          diagnostics,
          checker,
          (fn) => program.getSourceFile(fn),
          // This project's program + position map: without it the
          // OperatorOverload rule suppresses nothing and MacroGenerated uses
          // whichever project registered last.
          { program, positionMapFn }
        ) as ts.DiagnosticWithLocation[];
      } else {
        suppressionFiltered = diagnostics;
      }

      return mapDiagnostics(suppressionFiltered, fileName);
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

      // TypeScript's own fixes: it finds the error in the EXPANDED code, so
      // the span goes in mapped, and the fixes' edits come back mapped (a fix
      // that would edit macro-generated code is not offered).
      const original: ts.CodeFixAction[] = [];
      const range = toTransformedRange(normalizedFileName, { start, length: end - start });
      if (range) {
        const tsFixes = oldLS.getCodeFixesAtPosition(
          fileName,
          range.start,
          range.start + range.length,
          errorCodes,
          formatOptions,
          preferences
        );
        for (const fix of tsFixes) {
          const changes = toSourceEdits(fix.changes, `Code fix ${fix.fixName}`);
          if (changes) original.push({ ...fix, changes });
        }
      } else {
        log(`getCodeFixesAtPosition: could not map ${start}-${end} in ${fileName}`);
      }

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

    proxy.getCombinedCodeFix = (
      scope: ts.CombinedCodeFixScope,
      fixId: {},
      formatOptions: ts.FormatCodeSettings,
      preferences: ts.UserPreferences
    ): ts.CombinedCodeActions => {
      // "Fix all in file": TypeScript computes the edits on the expanded code.
      const combined = oldLS.getCombinedCodeFix(scope, fixId, formatOptions, preferences);
      const changes = toSourceEdits(combined.changes, `Combined code fix ${String(fixId)}`);
      return { ...combined, changes: changes ?? [] };
    };

    // ---------------------------------------------------------------------------
    // Override: Position-based IDE features (map positions bidirectionally)
    // ---------------------------------------------------------------------------

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

      return definitions.flatMap((def) => {
        const targetMapper = getMapper(def.fileName);
        const mappedSpan = mapTextSpanToOriginal(def.textSpan, targetMapper);

        if (!mappedSpan) {
          log(`Definition in macro-generated code of ${path.basename(def.fileName)}; dropped`);
          return [];
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

      const mappedDefinitions = result.definitions?.flatMap((def) => {
        const targetMapper = getMapper(def.fileName);
        const mappedDefSpan = mapTextSpanToOriginal(def.textSpan, targetMapper);

        if (!mappedDefSpan) {
          log(`Definition in macro-generated code of ${path.basename(def.fileName)}; dropped`);
          return [];
        }

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

    /**
     * tsserver turns the offsets of definitions (and implementations) into
     * line/column with this, on whatever text the language service has, which
     * is the EXPANDED code. Our results are already source offsets, so convert
     * them on the source text, or a jump after a @derive companion lands lines
     * off (PEP-060 item 5).
     */
    if (typeof oldLS.toLineColumnOffset === "function") {
      proxy.toLineColumnOffset = (fileName: string, position: number): ts.LineAndCharacter => {
        const result = expandedResult(fileName);
        if (!result) return oldLS.toLineColumnOffset!(fileName, position);
        let lineStarts = sourceLineStarts.get(result);
        if (!lineStarts) {
          lineStarts = computeLineStarts(result.original);
          sourceLineStarts.set(result, lineStarts);
        }
        return lineAndCharacterOf(lineStarts, position);
      };
    }

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

      return definitions.flatMap((def) => {
        const targetMapper = getMapper(def.fileName);
        const mappedSpan = mapTextSpanToOriginal(def.textSpan, targetMapper);

        if (!mappedSpan) {
          log(`Type definition in macro-generated code of ${path.basename(def.fileName)}; dropped`);
          return [];
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

    proxy.getImplementationAtPosition = (
      fileName: string,
      position: number
    ): readonly ts.ImplementationLocation[] | undefined => {
      const transformedPosition = getMapper(fileName).toTransformed(position);
      if (transformedPosition === null) return undefined;

      const implementations = oldLS.getImplementationAtPosition(fileName, transformedPosition);
      if (!implementations) return implementations;

      return implementations.flatMap((impl) => {
        const targetMapper = getMapper(impl.fileName);
        const textSpan = mapTextSpanToOriginal(impl.textSpan, targetMapper);
        if (!textSpan) {
          log(`Implementation in macro-generated code of ${path.basename(impl.fileName)}; dropped`);
          return [];
        }
        const contextSpan = impl.contextSpan
          ? (mapTextSpanToOriginal(impl.contextSpan, targetMapper) ?? undefined)
          : undefined;
        return [{ ...impl, textSpan, contextSpan }];
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
        // A reference must be the user's own text: one in generated code
        // (attributed to the macro call by the source map) is dropped.
        const mappedSpan = toSourceSpan(ref.fileName, ref.textSpan);

        if (!mappedSpan) continue;

        const result: ts.ReferenceEntry = {
          ...ref,
          textSpan: mappedSpan,
        };

        if (ref.contextSpan) {
          result.contextSpan = mapTextSpanToOriginal(ref.contextSpan, targetMapper) ?? undefined;
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
          const mappedRefSpan = toSourceSpan(ref.fileName, ref.textSpan);

          if (!mappedRefSpan) continue;

          const mappedRef: ts.ReferencedSymbolEntry = {
            ...ref,
            textSpan: mappedRefSpan,
          };

          if (ref.contextSpan) {
            mappedRef.contextSpan = mapTextSpanToOriginal(ref.contextSpan, refMapper) ?? undefined;
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
      let generatedLocations = 0;
      for (const loc of locations) {
        const targetMapper = getMapper(loc.fileName);
        // Rename edits the user's text: a location in macro-generated code
        // (e.g. a @derive companion naming the type, which the source map
        // attributes to the @derive tag) is dropped, not mapped onto the tag.
        const mappedSpan = toSourceSpan(loc.fileName, loc.textSpan);

        if (!mappedSpan) {
          generatedLocations++;
          continue;
        }

        const result: ts.RenameLocation = {
          ...loc,
          textSpan: mappedSpan,
        };

        if (loc.contextSpan) {
          result.contextSpan = mapTextSpanToOriginal(loc.contextSpan, targetMapper) ?? undefined;
        }

        mapped.push(result);
      }

      if (generatedLocations > 0) {
        log(
          `Rename: skipped ${generatedLocations} location(s) in macro-generated code ` +
            `(${path.basename(fileName)})`
        );
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
          const mappedTextSpan = toSourceSpan(docHighlight.fileName, span.textSpan);
          if (!mappedTextSpan) continue;

          const result: ts.HighlightSpan = {
            ...span,
            textSpan: mappedTextSpan,
          };

          if (span.contextSpan) {
            result.contextSpan = mapTextSpanToOriginal(span.contextSpan, targetMapper) ?? undefined;
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
    // ---------------------------------------------------------------------------
    // Macro code actions via refactoring API (PEP-034 Wave 2B)
    // ---------------------------------------------------------------------------

    /**
     * Lazily load the macro manifest from typesugar.manifest.json.
     * Returns null if no manifest is found (macro code actions won't be offered).
     */
    let cachedManifest: MacroManifest | null | undefined;
    function getMacroManifest(): MacroManifest | null {
      if (cachedManifest !== undefined) return cachedManifest;

      try {
        const projectDir = info.project.getCurrentDirectory();
        const manifestPath = path.join(projectDir, "typesugar.manifest.json");
        if (fs.existsSync(manifestPath)) {
          const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          cachedManifest = {
            expressionMacroNames: new Set(Object.keys(raw.macros?.expression ?? {})),
            taggedTemplateMacroNames: new Set(Object.keys(raw.macros?.taggedTemplate ?? {})),
            decoratorMacroNames: new Set(Object.keys(raw.macros?.decorator ?? {})),
          };
          log(
            `Loaded macro manifest: ${cachedManifest.expressionMacroNames.size} expression, ${cachedManifest.decoratorMacroNames.size} decorator macros`
          );
        } else {
          cachedManifest = null;
        }
      } catch {
        cachedManifest = null;
      }
      return cachedManifest;
    }

    const TYPESUGAR_REFACTOR_NAME = "typesugar-macro";

    /**
     * Macro actions that can actually be applied as an edit. "Expand …" and
     * "Add @derive(...)" have no edit a refactor can return (TS refactors
     * can't run an editor command), so offering them left a menu entry that
     * did nothing; macro expansion is the editor's "Expand Macro at Cursor"
     * command (the `_typesugar.expandMacro` request) instead.
     */
    function applicableMacroActions(
      fileName: string,
      positionOrRange: number | ts.TextRange
    ): ReturnType<typeof computeMacroCodeActions> {
      const manifest = getMacroManifest();
      if (!manifest) return [];
      const originalText = readOriginalFile(fileName);
      if (!originalText) return [];
      const start = typeof positionOrRange === "number" ? positionOrRange : positionOrRange.pos;
      const end = typeof positionOrRange === "number" ? positionOrRange : positionOrRange.end;
      return computeMacroCodeActions(originalText, fileName, manifest, start, end).filter(
        (ma) => ma.kind === "wrap-comptime" && ma.edit !== undefined
      );
    }

    /** Original-source position/range → the transformed program's, or null if unmappable. */
    function toTransformedPositionOrRange(
      fileName: string,
      positionOrRange: number | ts.TextRange
    ): number | ts.TextRange | null {
      const mapper = getMapper(fileName);
      if (typeof positionOrRange === "number") return mapper.toTransformed(positionOrRange);
      const pos = mapper.toTransformed(positionOrRange.pos);
      const end = mapper.toTransformed(positionOrRange.end);
      return pos === null || end === null ? null : { pos, end };
    }

    proxy.getApplicableRefactors = (
      fileName: string,
      positionOrRange: number | ts.TextRange,
      preferences: ts.UserPreferences | undefined,
      triggerReason?: ts.RefactorTriggerReason,
      kind?: string
    ): ts.ApplicableRefactorInfo[] => {
      const normalizedFileName = path.normalize(fileName);

      // TypeScript's own refactors run on the TRANSFORMED program, so the
      // position has to be mapped in (an unmapped original offset can land in
      // the middle of generated code and crash TS's refactor providers).
      let original: ts.ApplicableRefactorInfo[] = [];
      const transformed = toTransformedPositionOrRange(normalizedFileName, positionOrRange);
      if (transformed !== null) {
        try {
          original = oldLS.getApplicableRefactors(
            fileName,
            transformed,
            preferences,
            triggerReason,
            kind
          );
        } catch (error) {
          log(`getApplicableRefactors failed in ${path.basename(fileName)}: ${error}`);
        }
      }

      const macroActions = applicableMacroActions(normalizedFileName, positionOrRange);
      if (macroActions.length === 0) return original;

      const actions: ts.RefactorActionInfo[] = macroActions.map((ma, i) => ({
        name: `${TYPESUGAR_REFACTOR_NAME}-${i}`,
        description: ma.title,
        kind: "refactor.rewrite",
      }));

      return [
        ...original,
        {
          name: TYPESUGAR_REFACTOR_NAME,
          description: "typesugar",
          actions,
        },
      ];
    };

    proxy.getEditsForRefactor = (
      fileName: string,
      formatOptions: ts.FormatCodeSettings,
      positionOrRange: number | ts.TextRange,
      refactorName: string,
      actionName: string,
      preferences: ts.UserPreferences | undefined
    ): ts.RefactorEditInfo | undefined => {
      const normalizedFileName = path.normalize(fileName);

      if (refactorName !== TYPESUGAR_REFACTOR_NAME) {
        const transformed = toTransformedPositionOrRange(normalizedFileName, positionOrRange);
        if (transformed === null) return undefined;
        const result = oldLS.getEditsForRefactor(
          fileName,
          formatOptions,
          transformed,
          refactorName,
          actionName,
          preferences
        );
        if (!result) return result;
        // Map the edits back to original-source coordinates; a refactor that
        // would edit macro-generated text can't be applied to the user's file.
        const edits = toSourceEdits(result.edits, `Refactor ${refactorName}`);
        if (!edits) return undefined;
        const renameLocation =
          result.renameFilename !== undefined && result.renameLocation !== undefined
            ? (getMapper(result.renameFilename).toOriginal(result.renameLocation) ?? undefined)
            : result.renameLocation;
        return { ...result, edits, renameLocation };
      }

      const idx = parseInt(actionName.replace(`${TYPESUGAR_REFACTOR_NAME}-`, ""), 10);
      const action = applicableMacroActions(normalizedFileName, positionOrRange)[idx];
      if (!action?.edit) return undefined;

      return {
        edits: [
          {
            fileName: normalizedFileName,
            textChanges: [
              {
                span: { start: action.edit.start, length: action.edit.length },
                newText: action.edit.newText,
              },
            ],
          },
        ],
      };
    };

    // ---------------------------------------------------------------------------
    // Override: getCompletionEntryDetails (PEP-034 Wave 2C)
    // Map positions to transformed coordinates before resolving completion details.
    // ---------------------------------------------------------------------------

    proxy.getCompletionEntryDetails = (
      fileName: string,
      position: number,
      entryName: string,
      formatOptions: ts.FormatCodeOptions | ts.FormatCodeSettings | undefined,
      source: string | undefined,
      preferences: ts.UserPreferences | undefined,
      data: ts.CompletionEntryData | undefined
    ): ts.CompletionEntryDetails | undefined => {
      const mapper = getMapper(fileName);
      const transformedPosition = mapper.toTransformed(position);

      if (transformedPosition === null) {
        return undefined;
      }

      return oldLS.getCompletionEntryDetails(
        fileName,
        transformedPosition,
        entryName,
        formatOptions,
        source,
        preferences,
        data
      );
    };

    // ---------------------------------------------------------------------------
    // Override: inlay hints — TypeScript's own hints mapped back to original
    // positions, plus a preview of each expression macro's expansion
    // (`fieldNames<User>()  = ["id", "name"]`). The editor decides whether to
    // ask at all (VS Code: only when some `typescript.inlayHints.*` is on).
    // ---------------------------------------------------------------------------

    if (typeof oldLS.provideInlayHints === "function") {
      proxy.provideInlayHints = (
        fileName: string,
        span: ts.TextSpan,
        preferences: ts.UserPreferences | undefined
      ): ts.InlayHint[] => {
        const normalizedFileName = path.normalize(fileName);
        const result = getTransformResult(normalizedFileName);
        if (!result?.changed) return oldLS.provideInlayHints(fileName, span, preferences);

        // TypeScript's own hints. The span is mapped as a range: an editor
        // asks for the whole file or the visible lines, whose ends are often
        // in a comment (no mapping of their own), and mapping only exact ends
        // dropped every hint.
        const hints: ts.InlayHint[] = [];
        const range = toTransformedRange(normalizedFileName, span);
        const spanEnd = span.start + span.length;
        if (range) {
          try {
            for (const hint of oldLS.provideInlayHints(fileName, range, preferences)) {
              // A hint must sit in the user's code: one in generated code
              // (e.g. after a @derive companion's name, attributed to the tag)
              // is dropped, and the range may reach a little past the span.
              const at = toSourceSpan(normalizedFileName, { start: hint.position, length: 0 });
              if (!at || at.start < span.start || at.start > spanEnd) continue;
              hints.push({
                ...hint,
                position: at.start,
                displayParts: hint.displayParts?.map((part) => mapDisplayPart(part)),
              });
            }
          } catch (error) {
            log(`provideInlayHints failed in ${path.basename(fileName)}: ${error}`);
          }
        }

        hints.push(...expansionHints(result, normalizedFileName, span));
        return hints.sort((a, b) => a.position - b.position);
      };
    }

    /** An interactive inlay hint part links to a declaration: map its span too. */
    function mapDisplayPart(part: ts.InlayHintDisplayPart): ts.InlayHintDisplayPart {
      if (!part.span || !part.file) return part;
      const span = mapTextSpanToOriginal(part.span, getMapper(part.file));
      if (span) return { ...part, span };
      const { span: _generated, file: _file, ...rest } = part;
      return rest;
    }

    function expansionHints(
      result: TransformResult,
      fileName: string,
      span: ts.TextSpan
    ): ts.InlayHint[] {
      if (!result.expansions?.length) return [];
      // Expansion records carry the macro call's offsets; only show a hint
      // where the original text really has a call / tagged template there
      // (decorator and block macros would be noise as an inline hint).
      const sf = tsModule.createSourceFile(
        fileName,
        result.original,
        tsModule.ScriptTarget.Latest,
        true,
        fileName.endsWith("x") ? tsModule.ScriptKind.TSX : tsModule.ScriptKind.TS
      );
      const callEnds = new Map<number, number>();
      const visit = (node: ts.Node): void => {
        if (tsModule.isCallExpression(node) || tsModule.isTaggedTemplateExpression(node)) {
          callEnds.set(node.getStart(sf), node.getEnd());
        }
        tsModule.forEachChild(node, visit);
      };
      visit(sf);

      const spanEnd = span.start + span.length;
      const hints: ts.InlayHint[] = [];
      for (const exp of result.expansions) {
        const end = callEnds.get(exp.originalStart);
        if (end === undefined || end < span.start || end > spanEnd) continue;
        const flat = exp.expandedText.replace(/\s+/g, " ").trim();
        hints.push({
          text: `= ${flat.length <= 60 ? flat : flat.slice(0, 59) + "…"}`,
          position: end,
          kind: tsModule.InlayHintKind.Type,
          whitespaceBefore: true,
        });
      }
      return hints;
    }

    // ---------------------------------------------------------------------------
    // This project's instance: answers the custom tsserver requests and takes
    // editor configuration (see PluginInstance).
    // ---------------------------------------------------------------------------

    function findExpansionAt(fileName: string, position: number): ExpandMacroResponse | null {
      const expansions = getTransformResult(path.normalize(fileName))?.expansions;
      if (!expansions) return null;
      let best: ExpandMacroResponse | null = null;
      let bestDist = Infinity;
      for (const exp of expansions) {
        if (position >= exp.originalStart && position <= exp.originalEnd) {
          return { macroName: exp.macroName, expandedText: exp.expandedText };
        }
        const dist = Math.min(
          Math.abs(position - exp.originalStart),
          Math.abs(position - exp.originalEnd)
        );
        if (dist < bestDist) {
          bestDist = dist;
          best = { macroName: exp.macroName, expandedText: exp.expandedText };
        }
      }
      // Same tolerance the LSP's expandMacro used: a cursor just next to a call.
      return bestDist < 200 ? best : null;
    }

    const instance: PluginInstance = {
      hasFile(fileName: string): boolean {
        const toNormalizedPath = tsModule.server?.toNormalizedPath;
        if (typeof info.project.containsFile === "function" && toNormalizedPath) {
          return info.project.containsFile(toNormalizedPath(fileName));
        }
        const wanted = path.normalize(fileName);
        return info.project.getFileNames().some((f) => path.normalize(f) === wanted);
      },
      showTransformed(fileName: string): ShowTransformedResponse | null {
        const normalizedFileName = path.normalize(fileName);
        const result = getTransformResult(normalizedFileName);
        if (result) {
          return { original: result.original, transformed: result.code, changed: result.changed };
        }
        const text = readOriginalFile(normalizedFileName);
        return text === undefined ? null : { original: text, transformed: text, changed: false };
      },
      expandMacroAt: findExpansionAt,
      applyEditorConfig(config: unknown): void {
        const next = (config as { comptimeInEditor?: unknown } | null)?.comptimeInEditor === true;
        if (next === editorComptimeOptIn) return;
        editorComptimeOptIn = next;
        log(`comptime evaluation in the editor ${next ? "enabled" : "disabled"} by the editor`);
        // Every cached expansion was made under the old setting.
        transformCache.clear();
        rawMacroDiagnosticCache.clear();
        suggestionCache.clear();
        pipeline = null;
        const project = info.project as { markAsDirty?: () => void };
        project.markAsDirty?.();
      },
    };
    hostMarks[ACTIVE_INSTANCE] = instance;
    configTarget = instance;

    const session = (info as { session?: ProtocolSession }).session;
    const sessionInstances =
      session && typeof session.addProtocolHandler === "function"
        ? registerSessionHandlers(session, log)
        : undefined;
    sessionInstances?.add(instance);

    proxy.dispose = (): void => {
      sessionInstances?.delete(instance);
      if (hostMarks[ACTIVE_INSTANCE] === instance) delete hostMarks[ACTIVE_INSTANCE];
      oldLS.dispose();
    };

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

  return {
    create,
    /** tsserver `configurePlugin` (VS Code: the extension's settings). */
    onConfigurationChanged(config: unknown): void {
      configTarget?.applyEditorConfig(config);
    },
  };
}

export default init;
