/**
 * TransformationPipeline - Unified transformation orchestration
 *
 * This is the single source of truth for all typesugar transformation.
 * Used by: unplugin-typesugar, ts-patch, ts-plugin.
 */

import * as ts from "typescript";
import * as path from "path";
import {
  globalExpansionTracker,
  globalRegistry,
  globalResolutionScope,
  scanImportsForScope,
  createMacroContext,
  HygieneContext,
  MacroExpansionCache,
  type ExpansionRecord,
  type RawSourceMap,
  profiler,
  PROFILING_ENABLED,
  type FileTimings,
  config,
  assertSupportedTypeScript,
  opaqueTypesAsUnderlying,
} from "@typesugar/core";
import { setCfgConfig, clearDerivationCaches } from "@typesugar/macros";
import { MacroTransformer, discoverOpaqueTypesFromImports } from "@typesugar/transformer-core";
import { loadMacroPackages, loadMacroPackagesFromFile } from "./macro-loader.js";
import { VirtualCompilerHost, type PreprocessedFile } from "./virtual-host.js";
import { composeSourceMaps, composeSourceMapChain } from "./source-map-utils.js";
import {
  createPositionMapper,
  IdentityPositionMapper,
  type PositionMapper,
} from "./position-mapper.js";
import {
  TransformCache,
  hashContent,
  DiskTransformCache,
  initHasher,
  computeCacheConfigKey,
} from "./cache.js";
import {
  preprocessExpressionComprehensions,
  type PreprocessResult,
} from "./arrow-comprehension-preprocess.js";

// ---------------------------------------------------------------------------
// Node-host macro transformer factory (PEP-056 Wave 4)
//
// This is the single source of truth for standing up transformer-core's
// shared MacroTransformer class in a real Node.js/ts.Program environment --
// package loading from disk, .d.ts @opaque discovery, file-level opt-out,
// and TS-diagnostic-pipeline wiring, none of which belong in transformer-core
// itself (browser-compatible, zero Node deps). Replaces legacy
// `@typesugar/transformer`'s now-deleted `macroTransformerFactory`, which
// wrapped a private, duplicate copy of the same dispatch engine.
// ---------------------------------------------------------------------------

/**
 * Configuration for the Node-host macro transformer factory.
 */
export interface MacroTransformerConfig {
  /** Enable verbose logging */
  verbose?: boolean;

  // `macroModules` (documented as "custom macro module paths to load") was
  // removed before 1.0: nothing ever read it. Macro packages are discovered
  // through their package.json `typesugar.macros` field (PEP-055).

  /** Conditional compilation configuration (for cfg/cfgAttr macros) */
  cfgConfig?: Record<string, unknown>;

  /** Enable expansion tracking for source maps and diagnostics */
  trackExpansions?: boolean;

  /**
   * Directory for the disk-backed macro expansion cache.
   * Set to `false` to disable caching entirely.
   * Defaults to `.typesugar-cache`.
   */
  cacheDir?: string | false;

  /**
   * Called with every macro diagnostic (error or warning) the transformer
   * reports, as a fully-formed `ts.Diagnostic`.
   *
   * This is the diagnostics side channel: TypeScript DISCARDS diagnostics a
   * `before` transformer pushes via `context.addDiagnostic` during
   * `program.emit()` (they never reach `emitResult.diagnostics`), so a host
   * that drives emit itself (the CLI's build/watch) must collect them here
   * and merge them into its own error count. `ts.transform()` callers get
   * them in `result.diagnostics` as well.
   */
  onDiagnostic?: (diagnostic: ts.Diagnostic) => void;
}

/**
 * The third argument ts-patch passes to a `type: "program"` transformer
 * factory (`factory(program, pluginConfig, extras)`) -- see ts-patch's
 * `resources/module-patch.js`. Diagnostics added via `addDiagnostic` are
 * merged by ts-patch into `program.emit()`'s result, so patched `tsc`
 * reports them and exits non-zero.
 */
export interface TsPatchTransformerExtras {
  ts?: typeof ts;
  library?: string;
  addDiagnostic: (diagnostic: ts.Diagnostic) => number | void;
  removeDiagnostic?: (index: number) => void;
  diagnostics?: readonly ts.Diagnostic[];
}

/**
 * Duck-typed (not `instanceof`): tsup builds each entry point with
 * `splitting: false`, so `@typesugar/transformer` and
 * `@typesugar/transformer/pipeline` each carry their OWN copy of the
 * `TransformerState` class, and a state built from one would fail an
 * `instanceof` check in the other.
 */
function isTransformerState(value: unknown): value is TransformerState {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TransformerState).hasLoadedMacroPackages === "function" &&
    typeof (value as TransformerState).markMacroPackagesLoaded === "function"
  );
}

function isTsPatchExtras(value: unknown): value is TsPatchTransformerExtras {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TsPatchTransformerExtras).addDiagnostic === "function"
  );
}

/**
 * Where the macro expansion cache for this configuration lives: a
 * subdirectory of `cacheDir` keyed on typesugar version, compiler options and
 * cfg config (review finding #3), so a cache written under one configuration
 * is never read under another.
 */
function expansionCacheDir(
  cacheDir: string | undefined,
  compilerOptions: ts.CompilerOptions | undefined,
  cfgConfig: Record<string, unknown> | undefined
): string {
  const key = computeCacheConfigKey({ compilerOptions, cfgConfig, kind: "macro-expansions" });
  return path.join(cacheDir ?? ".typesugar-cache", `expansions-${key}`);
}

/**
 * The most recently created expansion cache.
 * Used by saveExpansionCache() to persist cache at cleanup time.
 */
let activeExpansionCache: MacroExpansionCache | undefined;

/**
 * Save the macro expansion cache to disk.
 * Call this at cleanup time (buildEnd, CLI exit, etc.) to persist
 * expansion results for future builds.
 */
export function saveExpansionCache(): void {
  if (activeExpansionCache) {
    activeExpansionCache.save();
  }
}

/**
 * Get statistics about the expansion cache for diagnostics.
 */
export function getExpansionCacheStats(): string | undefined {
  return activeExpansionCache?.getStatsString();
}

/**
 * Holds state that can be reused across multiple factory invocations.
 *
 * In watch mode, creating a new factory on each rebuild discards all caches.
 * By passing a TransformerState to subsequent factory calls, expensive setup
 * work is preserved: hygiene context (alias generation), expansion cache
 * (disk-backed), and macro packages already loaded per program.
 */
export class TransformerState {
  /** Shared hygiene context for alias management */
  readonly hygiene: HygieneContext;

  /** Disk-backed expansion cache */
  readonly expansionCache: MacroExpansionCache | undefined;

  /** Track which programs have had macro packages loaded */
  private loadedPrograms = new WeakSet<ts.Program>();

  /**
   * Macro diagnostics collected by every factory built with this state (the
   * diagnostics side channel -- see `MacroTransformerConfig.onDiagnostic`).
   * Drain with `takeDiagnostics()` after each emit.
   */
  private collectedDiagnostics: ts.Diagnostic[] = [];

  constructor(
    options: {
      cacheDir?: string | false;
      verbose?: boolean;
      /** Compiler options / cfg config the cache entries depend on (part of the key). */
      compilerOptions?: ts.CompilerOptions;
      cfgConfig?: Record<string, unknown>;
    } = {}
  ) {
    this.hygiene = new HygieneContext();
    this.expansionCache =
      options.cacheDir !== false
        ? new MacroExpansionCache(
            expansionCacheDir(options.cacheDir, options.compilerOptions, options.cfgConfig)
          )
        : undefined;

    if (options.verbose) {
      console.log("[typesugar] Created TransformerState");
      if (this.expansionCache) {
        console.log("[typesugar] Expansion cache loaded: " + this.expansionCache.size + " entries");
      }
    }
  }

  /** Check if macro packages have been loaded for this program. */
  hasLoadedMacroPackages(program: ts.Program): boolean {
    return this.loadedPrograms.has(program);
  }

  /** Mark that macro packages have been loaded for this program. */
  markMacroPackagesLoaded(program: ts.Program): void {
    this.loadedPrograms.add(program);
  }

  /** Record a macro diagnostic (called by the transformer factory). */
  recordDiagnostic(diagnostic: ts.Diagnostic): void {
    this.collectedDiagnostics.push(diagnostic);
  }

  /** Return and clear the macro diagnostics collected since the last call. */
  takeDiagnostics(): ts.Diagnostic[] {
    const out = this.collectedDiagnostics;
    this.collectedDiagnostics = [];
    return out;
  }

  /** Save the expansion cache to disk. */
  save(): void {
    this.expansionCache?.save();
  }

  /** Get cache statistics. */
  getStats(): { expansionCacheSize: number } {
    return { expansionCacheSize: this.expansionCache?.size ?? 0 };
  }
}

/**
 * Safety net: clamp any negative source positions to 0.
 *
 * Synthetic nodes created by macro expansion have pos = -1 (set by
 * stripPositions). This is fine for the printer, but TypeScript's emitter
 * crashes in createTextSpan when it encounters negative positions during
 * program.emit(). Walking the tree once after transformation prevents that.
 */
function clampSyntheticPositions<T extends ts.Node>(node: T): T {
  if ((node as unknown as { pos: number }).pos < 0) {
    (node as unknown as { pos: number }).pos = 0;
  }
  if ((node as unknown as { end: number }).end < 0) {
    (node as unknown as { end: number }).end = 0;
  }
  // NOTE: forEachChild stops at the first child for which the callback
  // returns a truthy value, and this returns `node` -- so only the first
  // child at each level is visited. Visiting every child (clamping every
  // synthetic node to 0) makes the printer read source text/comments for
  // them and corrupts output; the existing behaviour is kept deliberately.
  ts.forEachChild(node, clampSyntheticPositions);
  return node;
}

/**
 * Detach scratch-file `=>` tokens from synthetic arrow functions.
 *
 * A macro that parsed a code template (`ctx.parseStatements`) gets nodes back
 * via `stripPositions`, which uses visitEachChild without a token visitor and
 * so never reaches an arrow's `equalsGreaterThanToken`: the token keeps its
 * offset in the scratch file. The printer then emits the CURRENT file's
 * comments found at that offset between `)` and `=>` -- a syntax error
 * ("Line terminator not permitted before arrow"). This is the AST-level
 * replacement for the old line-regex `stripLeakedArrowComments` pass over
 * printed output (review finding #5), which corrupted string/template
 * literals.
 */
function detachScratchArrowTokens(node: ts.Node): void {
  if (ts.isArrowFunction(node) && node.pos < 0 && node.equalsGreaterThanToken.pos >= 0) {
    ts.setTextRange(node.equalsGreaterThanToken, { pos: -1, end: -1 });
  }
  ts.forEachChild(node, (child) => {
    detachScratchArrowTokens(child);
  });
}

/**
 * Create the TypeScript transformer factory backed by transformer-core's
 * shared MacroTransformer class. This is the entry point called by ts-patch,
 * unplugin-typesugar, and cli.ts's build/watch/expand/run commands.
 *
 * The signature is ts-patch-compatible: ts-patch (`type: "program"`) calls
 * `factory(program, pluginConfig, extras)` with its own extras object as the
 * third argument, so that argument is EITHER a reusable `TransformerState`
 * OR ts-patch's extras (whose `addDiagnostic` then receives every macro
 * diagnostic, so patched `tsc` fails on macro errors).
 *
 * @param program - The TypeScript program to transform
 * @param config - Configuration options (for ts-patch: the plugin entry's options)
 * @param stateOrExtras - Reusable state for watch mode (caches, hygiene
 *   context, diagnostics collector), or ts-patch's extras object
 */
export function macroTransformerFactory(
  program: ts.Program,
  config?: MacroTransformerConfig,
  stateOrExtras?: TransformerState | TsPatchTransformerExtras
): ts.TransformerFactory<ts.SourceFile> {
  // PEP-060 item 1: reject TypeScript 7 with one clear message (memoized).
  assertSupportedTypeScript(ts);
  const state = isTransformerState(stateOrExtras) ? stateOrExtras : undefined;
  const tsPatchExtras = !state && isTsPatchExtras(stateOrExtras) ? stateOrExtras : undefined;
  const reportDiagnostic = (diag: ts.Diagnostic): void => {
    state?.recordDiagnostic(diag);
    config?.onDiagnostic?.(diag);
    tsPatchExtras?.addDiagnostic(diag);
  };
  const verbose = config?.verbose ?? false;
  const trackExpansions = config?.trackExpansions ?? false;

  if (config?.cfgConfig) {
    setCfgConfig(config.cfgConfig);
  }

  let hygiene: HygieneContext;
  let expansionCache: MacroExpansionCache | undefined;

  if (state) {
    hygiene = state.hygiene;
    expansionCache = state.expansionCache;
    activeExpansionCache = expansionCache;

    if (!state.hasLoadedMacroPackages(program)) {
      // A new program (e.g. a watch rebuild reusing this state): derivation
      // results cached for the previous program may describe types that have
      // since been edited, so they must not survive into this one
      // (macros-typeclass review #6).
      clearDerivationCaches();
      loadMacroPackages(program, verbose);
      state.markMacroPackagesLoaded(program);
    }

    if (verbose) {
      console.log("[typesugar] Reusing TransformerState from previous build");
    }
  } else {
    clearDerivationCaches();

    hygiene = new HygieneContext();

    const cacheDir = config?.cacheDir;
    expansionCache =
      cacheDir !== false
        ? new MacroExpansionCache(
            expansionCacheDir(cacheDir, program.getCompilerOptions(), config?.cfgConfig)
          )
        : undefined;
    activeExpansionCache = expansionCache;

    loadMacroPackages(program, verbose);
  }

  const expansionTracker = trackExpansions ? globalExpansionTracker : undefined;

  if (verbose) {
    console.log(
      state
        ? "[typesugar] Initializing transformer (reusing state)"
        : "[typesugar] Initializing transformer (fresh state)"
    );
    console.log(
      `[typesugar] Registered macros: ${globalRegistry
        .getAll()
        .map((m) => m.name)
        .join(", ")}`
    );
  }

  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      if (verbose) {
        console.log(`[typesugar] Processing: ${sourceFile.fileName}`);
      }

      // Load macro packages based on this file's imports, BEFORE scanning for
      // activation scope below -- a provider's registerSyntaxMarkerFallback
      // side effect must be registered before scanImportsForScope's lookups
      // depend on it. Safe to run first: loadPackage is idempotent.
      // A macro package the file imports but whose macros could not be
      // loaded (unresolvable from the project, or its macro entry threw)
      // would otherwise leave its calls unexpanded with no trace, so each
      // one becomes a warning on the import (docs review 2026-10).
      for (const w of loadMacroPackagesFromFile(sourceFile, verbose)) {
        const start = w.node.getStart(sourceFile);
        const warning: ts.Diagnostic = {
          file: sourceFile,
          start,
          length: w.node.end - start,
          messageText: `[typesugar] ${w.message}`,
          category: ts.DiagnosticCategory.Warning,
          code: 9999,
          source: "typesugar",
        };
        (
          context as ts.TransformationContext & { addDiagnostic?: (d: ts.Diagnostic) => void }
        ).addDiagnostic?.(warning);
        reportDiagnostic(warning);
      }

      // Scan for imports and opt-out directives
      scanImportsForScope(sourceFile, globalResolutionScope, program);

      // Discover @opaque types from imported .d.ts files (external libraries).
      discoverOpaqueTypesFromImports(sourceFile, program, verbose);

      // Check for file-level opt-out
      const fileScope = globalResolutionScope.getScope(sourceFile.fileName);
      if (fileScope.optedOut) {
        if (verbose) {
          console.log(`[typesugar] Skipping: ${sourceFile.fileName} (opted out)`);
        }
        return sourceFile;
      }

      const ctx = createMacroContext(program, sourceFile, context, hygiene);
      const transformer = new MacroTransformer(ctx, verbose, expansionTracker, expansionCache);

      const result = ts.visitNode(sourceFile, transformer.visit.bind(transformer));

      // Report diagnostics through the TS diagnostic pipeline
      const macroDiagnostics = ctx.getDiagnostics();
      for (const diag of macroDiagnostics) {
        // Safely get start position - synthetic nodes throw on getStart
        let start = 0;
        let length = 0;
        if (diag.node) {
          if (diag.node.pos >= 0 && diag.node.end > diag.node.pos) {
            start = diag.node.pos;
            length = diag.node.end - diag.node.pos;
            try {
              const nodeSourceFile = diag.node.getSourceFile?.();
              if (nodeSourceFile) {
                const textStart = diag.node.getStart(nodeSourceFile);
                if (textStart >= start && textStart < diag.node.end) {
                  start = textStart;
                  length = diag.node.end - textStart;
                }
              }
            } catch {
              // Keep the pos/end values if getStart fails
            }
          } else {
            try {
              start = diag.node.getStart(sourceFile);
              length = diag.node.getWidth(sourceFile);
            } catch {
              // Keep zero values
            }
          }
        }
        // A synthetic node (a JSDoc tag's parsed arguments) has no position:
        // getStart() returns -1, and a negative start crashed the CLI's
        // diagnostic printer ("position cannot precede the beginning of the
        // file") instead of reporting the error.
        if (start < 0 || length < 0) {
          start = 0;
          length = 0;
        }

        const errorCode =
          diag.code ??
          (() => {
            const m = diag.message.match(/\[TS(\d{4})\]/);
            return m ? parseInt(m[1], 10) : 9999;
          })();

        const tsDiag: ts.Diagnostic & { __typesugarSuggestion?: string } = {
          file: sourceFile,
          start,
          length,
          messageText: `[typesugar] ${diag.message}`,
          category:
            diag.severity === "error" ? ts.DiagnosticCategory.Error : ts.DiagnosticCategory.Warning,
          code: errorCode,
          source: "typesugar",
        };
        if (diag.suggestion) {
          tsDiag.__typesugarSuggestion = diag.suggestion;
        }

        const ctxWithDiag = context as ts.TransformationContext & {
          addDiagnostic?: (diag: ts.Diagnostic) => void;
        };
        if (ctxWithDiag.addDiagnostic) {
          ctxWithDiag.addDiagnostic(tsDiag);
        }
        // Side channel: program.emit() drops context.addDiagnostic output.
        reportDiagnostic(tsDiag);

        if (verbose) {
          const prefix = diag.severity === "error" ? "ERROR" : "WARNING";
          const loc = diag.node
            ? ` at ${sourceFile.fileName}:${sourceFile.getLineAndCharacterOfPosition(start).line + 1}`
            : "";
          console.log(`[typesugar ${prefix}]${loc} ${diag.message}`);
        }
      }

      detachScratchArrowTokens(result as ts.SourceFile);

      // Safety net: clamp negative positions so program.emit() doesn't crash
      clampSyntheticPositions(result as ts.SourceFile);

      return result as ts.SourceFile;
    };
  };
}

/**
 * Diagnostic from macro expansion
 */
export interface TransformDiagnostic {
  file: string;
  start: number;
  length: number;
  message: string;
  severity: "error" | "warning";
  /** typesugar error code (9001-9999), extracted from message [TS9XXX] prefix */
  code?: number;
  /** Optional code fix suggestion (replacement text) */
  suggestion?: {
    description: string;
    start: number;
    length: number;
    replacement: string;
  };
}

/**
 * Result of transforming a single file
 */
export interface TransformResult {
  /** Original source content */
  original: string;
  /** Transformed code (valid TypeScript) */
  code: string;
  /** Transpiled JavaScript (when emitJs is enabled) */
  js?: string;
  /** Composed source map (original → transformed TS) */
  sourceMap: RawSourceMap | null;
  /** Composed source map (original → transpiled JS, when emitJs is enabled) */
  jsSourceMap?: RawSourceMap | null;
  /** Position mapper for IDE features */
  mapper: PositionMapper;
  /** Whether the file was modified */
  changed: boolean;
  /** Macro expansion diagnostics */
  diagnostics: TransformDiagnostic[];
  /** Dependencies (files this file imports) */
  dependencies?: Set<string>;
  /** Individual expansion records (populated when trackExpansions is enabled) */
  expansions?: ExpansionRecord[];
}

/**
 * Options for the transformation pipeline
 */
export interface PipelineOptions {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Macro transformer config */
  transformerConfig?: MacroTransformerConfig;
  /** Custom file reader (defaults to ts.sys.readFile) */
  readFile?: (fileName: string) => string | undefined;
  /** Custom file existence checker (defaults to ts.sys.fileExists) */
  fileExists?: (fileName: string) => boolean;
  /** Maximum cache size (default: 1000) */
  maxCacheSize?: number;
  /** Enable disk-backed transform cache (defaults to false) */
  diskCache?: boolean | string;
  /**
   * Directory for the macro EXPANSION cache, forwarded to the transformer
   * factory (overrides `transformerConfig.cacheDir`). `false` disables it.
   */
  cacheDir?: string | false;
  /**
   * Enable strict mode — typecheck expanded output for macro bugs.
   *
   * - `true`: Full typecheck of all files on every build
   * - `"incremental"`: Only typecheck files whose expanded output changed
   *   (+ their dependents). Falls back to full on first build.
   * - `false` / `undefined`: No strict typecheck
   */
  strict?: boolean | "incremental";
  /**
   * Preserve original formatting in the output.
   *
   * When true, uses surgical text replacement (MagicString) to only
   * modify macro call sites, keeping everything else — blank lines,
   * comments, indentation — byte-for-byte identical to the original.
   * This produces clean diffs that show only the actual expansions.
   *
   * @deprecated Removed in PEP-032 Wave 10. Blank line restoration will be
   * reimplemented using source maps. This option is now ignored.
   */
  preserveBlankLines?: boolean;
  /**
   * Typecheck the transformer's output and report any TypeScript errors
   * as diagnostics with severity "warning".
   *
   * Use this to verify that macro expansion produces valid TypeScript.
   * Intended for playground / CI validation — not recommended in hot
   * build paths since it adds a typecheck pass per file.
   */
  strictOutput?: boolean;
  /**
   * Transpile expanded TypeScript to JavaScript using ts.transpileModule().
   *
   * When enabled, the result includes `js` and `jsSourceMap` fields containing
   * portable JavaScript that works with esbuild, swc, and other tools that
   * don't support the full TypeScript language (namespaces, const enums, etc.).
   */
  emitJs?: boolean;
}

/** Leaf token classes `generateASTSourceMap` matches between the AST and the output. */
type LeafKind = "identifier" | "string" | "template" | "literal" | "keyword";

/**
 * A leaf token for source-map matching: its class and its cooked text (the
 * identifier name, a string's contents), or undefined for an inner node.
 * String-like literals share a class because the printer may change quotes.
 */
function leafOf(node: ts.Node): { kind: LeafKind; text: string } | undefined {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return { kind: "identifier", text: node.text };
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { kind: "string", text: node.text };
  }
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return { kind: "template", text: `${node.kind}:${node.text}` };
  }
  if (
    ts.isNumericLiteral(node) ||
    ts.isBigIntLiteral(node) ||
    ts.isRegularExpressionLiteral(node)
  ) {
    return { kind: "literal", text: node.text };
  }
  switch (node.kind) {
    case ts.SyntaxKind.ThisKeyword:
      return { kind: "keyword", text: "this" };
    case ts.SyntaxKind.SuperKeyword:
      return { kind: "keyword", text: "super" };
    case ts.SyntaxKind.TrueKeyword:
      return { kind: "keyword", text: "true" };
    case ts.SyntaxKind.FalseKeyword:
      return { kind: "keyword", text: "false" };
    case ts.SyntaxKind.NullKeyword:
      return { kind: "keyword", text: "null" };
    case ts.SyntaxKind.UndefinedKeyword:
      return { kind: "keyword", text: "undefined" };
  }
  return undefined;
}

/**
 * Generate a source map by walking the transformed AST and reading
 * `getSourceMapRange()` from each node. Correlates AST nodes with output
 * positions using TypeScript's scanner for token-boundary precision.
 *
 * This approach is:
 * - **Complete**: handles all transform types (macros, operators, erasure, etc.)
 *   without requiring each transform to opt in via recordExpansion()
 * - **Precise**: token-level granularity (not line-level like the diff fallback)
 * - **No fallbacks**: single code path for all cases
 *
 * Algorithm:
 * 1. Parse the output and collect its leaf tokens (identifiers, literals,
 *    template parts, `this`/`true`/...) in document order, with positions
 * 2. Walk the transformed AST depth-first in source order
 * 3. Match each leaf node to the next output leaf of the same kind and text
 * 4. Read getSourceMapRange(node) for the original source position
 * 5. Encode the collected mappings as a VLQ source map
 *
 * Step 1 parses rather than running a bare scanner over the output: a scanner
 * without the parser's context reads the `}` that ends a template
 * substitution as a brace and the next backtick as the start of a new
 * template, swallowing the rest of the file into one bogus token (and a
 * regular expression can do the same). Every position after the first
 * `${...}` was then unmapped (PEP-060 item 5).
 */
function generateASTSourceMap(
  originalCode: string,
  transformedSF: ts.SourceFile,
  outputCode: string,
  fileName: string
): RawSourceMap | null {
  if (originalCode === outputCode) return null;

  // The output's leaves, in document order. `text` is the cooked value
  // (identifier name, string contents), so matching doesn't depend on the
  // quote style or escapes the printer chose.
  const outputTokens: Array<{ kind: LeafKind; text: string; pos: number }> = [];
  const outputSF = ts.createSourceFile(fileName, outputCode, ts.ScriptTarget.Latest, false);
  const collectLeaves = (node: ts.Node): void => {
    const leaf = leafOf(node);
    if (leaf) {
      outputTokens.push({ ...leaf, pos: node.getStart(outputSF) });
      return;
    }
    ts.forEachChild(node, collectLeaves);
  };
  collectLeaves(outputSF);

  if (outputTokens.length === 0) return null;

  // Precompute line starts for both original and output
  function computeLineStarts(text: string): number[] {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
  }

  function offsetToLineCol(lineStarts: number[], pos: number): { line: number; col: number } {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, col: pos - lineStarts[lo] };
  }

  const origLineStarts = computeLineStarts(originalCode);
  const outLineStarts = computeLineStarts(outputCode);

  // Collect mappings: output position → original position
  const mappings: Array<{
    genLine: number;
    genCol: number;
    origLine: number;
    origCol: number;
  }> = [];

  // Token cursor — advances as we match AST nodes to output tokens
  let tokenCursor = 0;

  function findNextToken(kind: LeafKind, text: string): { pos: number } | null {
    for (let i = tokenCursor; i < outputTokens.length; i++) {
      if (outputTokens[i].kind === kind && outputTokens[i].text === text) {
        tokenCursor = i + 1;
        return outputTokens[i];
      }
    }
    return null;
  }

  function addMapping(outPos: number, origPos: number): void {
    if (origPos < 0 || origPos >= originalCode.length) return;
    const gen = offsetToLineCol(outLineStarts, outPos);
    const orig = offsetToLineCol(origLineStarts, origPos);
    mappings.push({ genLine: gen.line, genCol: gen.col, origLine: orig.line, origCol: orig.col });
  }

  // Skip trivia (whitespace, comments) to find the actual token start.
  // This mirrors TypeScript's emitter which calls skipSourceTrivia() on
  // sourceMapRange.pos before recording the mapping.
  function skipTrivia(pos: number): number {
    if (pos < 0 || pos >= originalCode.length) return pos;
    let i = pos;
    while (i < originalCode.length) {
      const ch = originalCode.charCodeAt(i);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        // space, tab, newline, carriage return
        i++;
      } else if (ch === 47) {
        // '/' — possible comment
        if (i + 1 < originalCode.length && originalCode.charCodeAt(i + 1) === 47) {
          // // line comment — skip to end of line
          i += 2;
          while (i < originalCode.length && originalCode.charCodeAt(i) !== 10) i++;
        } else if (i + 1 < originalCode.length && originalCode.charCodeAt(i + 1) === 42) {
          // /* block comment */ — skip to */
          i += 2;
          while (i + 1 < originalCode.length) {
            if (originalCode.charCodeAt(i) === 42 && originalCode.charCodeAt(i + 1) === 47) {
              i += 2;
              break;
            }
            i++;
          }
        } else {
          break;
        }
      } else {
        break;
      }
    }
    return i;
  }

  // Walk the transformed AST depth-first, matching leaves to output tokens.
  // For statements, also emit a statement-level mapping at the start so that
  // positions between tokens (whitespace, operators) map to the correct line.
  function walkNode(node: ts.Node): void {
    const range = ts.getSourceMapRange(node);

    const leaf = leafOf(node);
    if (leaf) {
      // Only map nodes that have a valid source position
      if (range.pos < 0 || range.end < 0) return;

      // Skip leading trivia to get the actual token start in the original
      const origPos = skipTrivia(range.pos);

      const token = findNextToken(leaf.kind, leaf.text);
      if (token) {
        addMapping(token.pos, origPos);
      }
      return;
    }

    // Non-leaf: recurse into children (forEachChild visits in source order)
    ts.forEachChild(node, walkNode);
  }

  // Walk the full AST for token-level precision
  walkNode(transformedSF);

  // Add line-start mappings: for each output line that has at least one
  // token mapping, add a col-0 mapping pointing to the same original line.
  // This ensures positions between tokens (whitespace, keywords like 'const')
  // map correctly for the PositionMapper.
  const lineHasMapping = new Map<number, number>(); // genLine → origLine
  for (const m of mappings) {
    if (!lineHasMapping.has(m.genLine)) {
      lineHasMapping.set(m.genLine, m.origLine);
    }
  }
  for (const [genLine, origLine] of lineHasMapping) {
    mappings.push({ genLine, genCol: 0, origLine, origCol: 0 });
  }

  if (mappings.length === 0) return null;

  // Sort mappings by generated position (required for VLQ encoding)
  mappings.sort((a, b) => a.genLine - b.genLine || a.genCol - b.genCol);

  // Deduplicate: remove consecutive mappings that point to the same generated position
  const deduped: typeof mappings = [];
  for (const m of mappings) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.genLine === m.genLine && prev.genCol === m.genCol) continue;
    deduped.push(m);
  }

  // Encode as VLQ source map
  let vlqMappings = "";
  let prevGenLine = 0;
  let prevGenCol = 0;
  let prevOrigLine = 0;
  let prevOrigCol = 0;

  for (const m of deduped) {
    // Emit semicolons for new lines
    while (prevGenLine < m.genLine) {
      vlqMappings += ";";
      prevGenLine++;
      prevGenCol = 0;
    }

    // Comma separator between segments on the same line
    if (vlqMappings.length > 0 && !vlqMappings.endsWith(";")) {
      vlqMappings += ",";
    }

    // VLQ-encode: genCol, sourceIdx(0), origLine, origCol
    vlqMappings += vlqEncode(m.genCol - prevGenCol);
    vlqMappings += vlqEncode(0); // source index (always 0 — single file)
    vlqMappings += vlqEncode(m.origLine - prevOrigLine);
    vlqMappings += vlqEncode(m.origCol - prevOrigCol);

    prevGenCol = m.genCol;
    prevOrigLine = m.origLine;
    prevOrigCol = m.origCol;
  }

  return {
    version: 3,
    file: fileName.replace(/\.ts$/, ".js"),
    sourceRoot: "",
    sources: [fileName],
    sourcesContent: [originalCode],
    names: [],
    mappings: vlqMappings,
  };
}

/** Base64 VLQ encoding (source map v3 format) */
const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlqEncode(value: number): string {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = "";
  do {
    let digit = vlq & 0x1f;
    vlq >>>= 5;
    if (vlq > 0) digit |= 0x20; // continuation bit
    encoded += VLQ_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

/**
 * TransformationPipeline - Orchestrates preprocessing and macro transformation
 *
 * This class provides:
 * 1. A unified pipeline that works for all consumers (build tools, IDE, ts-patch)
 * 2. Proper type-aware transformation via VirtualCompilerHost
 * 3. Source map composition for accurate error locations
 * 4. Layered caching for performance
 *
 * Usage:
 * ```typescript
 * const pipeline = createPipeline('./tsconfig.json');
 * const result = pipeline.transform('src/app.ts');
 * console.log(result.code);
 * ```
 */
export function transpileExpanded(
  code: string,
  fileName: string,
  compilerOptions: ts.CompilerOptions,
  options?: {
    sourceMap?: boolean;
    jsx?: ts.JsxEmit;
    /** Module system to emit (default ESNext: imports/exports kept). */
    module?: ts.ModuleKind;
  }
): {
  outputText: string;
  sourceMapText?: string;
  /**
   * @deprecated Always null. The legacy companion-const regex rewrite this
   * described (`const X: Record<string, any> = {}` → `var X = {}`) was
   * removed: derive has not emitted that pattern since PEP-033, and a
   * line-regex rewrite of code is what CLAUDE.md forbids (review #20).
   */
  fixMap?: RawSourceMap | null;
} {
  const emitSourceMap = options?.sourceMap ?? true;
  // `code` is already expanded. Leave out the project's `plugins`: a
  // ts-patched TypeScript applies each `{ "transform": ... }` entry in
  // transpileModule too, which would run the typesugar transformer a second
  // time over its own output (a @typeclass companion emitted twice).
  const { plugins: _plugins, ...transpileOptions } = compilerOptions;

  const result = ts.transpileModule(code, {
    compilerOptions: {
      ...transpileOptions,
      module: options?.module ?? ts.ModuleKind.ESNext,
      target: compilerOptions.target ?? ts.ScriptTarget.ESNext,
      sourceMap: emitSourceMap,
      declaration: false,
      declarationMap: false,
      isolatedModules: false,
      jsx: options?.jsx,
    },
    fileName,
  });
  return {
    outputText: result.outputText,
    sourceMapText: result.sourceMapText ?? undefined,
    fixMap: null,
  };
}

/**
 * Cache for incremental strict typechecking.
 * Stores per-file results from the previous strict typecheck run so
 * only changed files (and their dependents) need re-checking.
 */
interface StrictTypecheckCache {
  /** Hash of effective content (expanded or original) per file from last run */
  effectiveHashes: Map<string, string>;
  /** Per-file diagnostics (syntactic + semantic) from last run */
  fileDiagnostics: Map<string, readonly ts.Diagnostic[]>;
  /** Previous expanded program for ts.createProgram structural reuse */
  expandedProgram: ts.Program | null;
}

export class TransformationPipeline {
  private host: VirtualCompilerHost;
  private program: ts.Program | null = null;
  private cache: TransformCache;
  private diskCache: DiskTransformCache | null = null;
  private verbose: boolean;
  private transformerConfig: MacroTransformerConfig;
  private customReadFile: (fileName: string) => string | undefined;
  private fileNames: string[];
  /** Content hash cache for dependency validation */
  private contentHashes = new Map<string, string>();
  /** Side pipeline for files outside this pipeline's Program. */
  private outOfProject: TransformationPipeline | undefined;
  /** True for such a side pipeline (it never spawns further ones). */
  private isOutOfProjectPipeline = false;
  /** Cached transformer factory - reused across all file transforms */
  private cachedTransformerFactory: ts.TransformerFactory<ts.SourceFile> | null = null;
  /** Cache for incremental strict typechecking */
  private strictCache: StrictTypecheckCache = {
    effectiveHashes: new Map(),
    fileDiagnostics: new Map(),
    expandedProgram: null,
  };

  constructor(
    private compilerOptions: ts.CompilerOptions,
    fileNames: string[],
    private options: PipelineOptions = {}
  ) {
    // PEP-060 item 1: reject TypeScript 7 with one clear message (memoized).
    assertSupportedTypeScript(ts);
    this.verbose = options.verbose ?? false;
    this.transformerConfig = {
      verbose: this.verbose,
      trackExpansions: true, // Always track — needed for CodeLens, inlay hints, expand preview
      ...options.transformerConfig,
    };
    // `cacheDir` (top-level) wins over transformerConfig.cacheDir; `false`
    // disables the macro expansion cache entirely.
    if (options.cacheDir !== undefined) {
      this.transformerConfig.cacheDir = options.cacheDir;
    }
    this.customReadFile = options.readFile ?? ts.sys.readFile;
    this.fileNames = fileNames;

    // Create layered cache with dependency tracking
    this.cache = new TransformCache({ maxSize: options.maxCacheSize ?? 1000 });

    // Create disk cache if enabled
    if (options.diskCache) {
      const cacheDir =
        typeof options.diskCache === "string" ? options.diskCache : ".typesugar-cache/transforms";
      // Key on everything besides file contents that changes the output
      // (review finding #3/#15): typesugar version, compiler options, cfg
      // config. Kind "expanded-ts": this cache stores expanded TypeScript,
      // never emitted JS, so a host storing JS must use another kind.
      this.diskCache = new DiskTransformCache(cacheDir, {
        configKey: computeCacheConfigKey({
          compilerOptions,
          cfgConfig: this.transformerConfig.cfgConfig,
          kind: "expanded-ts",
        }),
      });
      if (this.verbose) {
        console.log(`[typesugar] Disk cache enabled at ${cacheDir}`);
      }
    }

    // Create virtual host that serves preprocessed content
    this.host = new VirtualCompilerHost({
      compilerOptions,
      readFile: this.customReadFile,
      fileExists: options.fileExists,
    });

    // Fire-and-forget hasher init (fallback works fine if not ready)
    initHasher().catch(() => {
      /* ignore - fallback available */
    });
  }

  /**
   * Create a pipeline with async initialization.
   * Use this for optimal hashing performance (xxhash64 vs DJB2 fallback).
   */
  static async create(
    compilerOptions: ts.CompilerOptions,
    fileNames: string[],
    options: PipelineOptions = {}
  ): Promise<TransformationPipeline> {
    await initHasher();
    return new TransformationPipeline(compilerOptions, fileNames, options);
  }

  /**
   * Transform a single file
   */
  transform(fileName: string): TransformResult {
    const transformStart = PROFILING_ENABLED ? performance.now() : 0;
    profiler.start("transform");

    const normalizedFileName = path.normalize(fileName);

    // Read original content
    const readStart = PROFILING_ENABLED ? performance.now() : 0;
    const original = this.customReadFile(normalizedFileName);
    const readMs = PROFILING_ENABLED ? performance.now() - readStart : 0;

    if (!original) {
      profiler.end("transform");
      return this.createEmptyResult(normalizedFileName);
    }

    // Update content hash
    const hashStart = PROFILING_ENABLED ? performance.now() : 0;
    const contentHash = hashContent(original);
    const hashMs = PROFILING_ENABLED ? performance.now() - hashStart : 0;
    this.contentHashes.set(normalizedFileName, contentHash);

    // Check cache with dependency validation
    const cacheCheckStart = PROFILING_ENABLED ? performance.now() : 0;
    const cached = this.checkCache(normalizedFileName, contentHash);
    const cacheCheckMs = PROFILING_ENABLED ? performance.now() - cacheCheckStart : 0;

    if (cached) {
      if (this.verbose) {
        console.log(`[typesugar] Cache hit for ${normalizedFileName}`);
      }
      profiler.end("transform");
      return cached;
    }

    // Check disk cache if in-memory missed
    if (this.diskCache) {
      const diskCached = this.diskCache.get(normalizedFileName, contentHash, (dep) =>
        this.contentHashes.get(dep)
      );
      if (diskCached) {
        // Restore dependencies from disk cache
        const dependencies = new Set(diskCached.dependencies);
        // Parse source map from JSON string
        const sourceMap: RawSourceMap | null = diskCached.sourceMap
          ? (JSON.parse(diskCached.sourceMap) as RawSourceMap)
          : null;
        const changed = diskCached.code.trimEnd() !== original.trimEnd();
        const result: TransformResult = {
          original,
          code: diskCached.code,
          sourceMap,
          mapper: sourceMap
            ? createPositionMapper(sourceMap, original, diskCached.code)
            : new IdentityPositionMapper(),
          changed,
          // Replay the diagnostics recorded with the entry -- a cache hit
          // must not silently drop a macro error (review finding #15).
          diagnostics: (diskCached.diagnostics ?? []) as TransformDiagnostic[],
          dependencies,
        };

        // Transpile cached TS to JS if requested
        if (this.options.emitJs && changed) {
          this.applyTranspileStep(result, normalizedFileName, sourceMap);
        }

        // Populate in-memory cache (don't write back to disk)
        this.cacheResult(normalizedFileName, result, contentHash, dependencies, false);
        if (this.verbose) {
          console.log(`[typesugar] Disk cache hit for ${normalizedFileName}`);
        }
        profiler.end("transform");
        return result;
      }
    }

    // Ensure program exists (lazy creation)
    this.ensureProgram();

    // The file changed since the Program was built (no invalidate() call):
    // rebuild, or the transformer would see the old AST and types.
    const programText = this.program?.getSourceFile(normalizedFileName)?.text;
    if (
      programText !== undefined &&
      programText !== (this.host.getPreprocessedFile(normalizedFileName)?.code ?? original)
    ) {
      this.resetProgram();
      this.ensureProgram();
    }

    // Get preprocessed content from host
    const preprocessStart = PROFILING_ENABLED ? performance.now() : 0;
    const preprocessed = this.host.getPreprocessedFile(normalizedFileName);
    const preprocessMs = PROFILING_ENABLED ? performance.now() - preprocessStart : 0;
    const preprocessMap = preprocessed?.map ?? null;
    let codeForTransform = preprocessed?.code ?? original;

    // Expression-position comprehension preprocessing: rewrite arrow-body,
    // `return`, and `export default` uses of `let:/yield:` into shapes the
    // `const x = let;`-merge path can handle, and emit TS9223 for `yield:`
    // inside generator functions. See arrow-comprehension-preprocess.ts.
    //
    // PEP-052 gate: the text rewrite commits to do-notation before the AST
    // gate can run — in a file that never activates the comprehension macros
    // the gated merge would refuse to repair the rewrite, emitting mangled
    // synthetic code instead of leaving the source untouched. Scan activation
    // first (the scan re-runs later in the transformer; it is idempotent) and
    // skip the rewrite when neither comprehension macro is activated.
    const compResult: PreprocessResult = this.isComprehensionSyntaxActivated(
      normalizedFileName,
      codeForTransform
    )
      ? preprocessExpressionComprehensions(codeForTransform, normalizedFileName)
      : { source: codeForTransform, changed: false, diagnostics: [] };
    let compMap: RawSourceMap | null = null;
    if (compResult.changed) {
      codeForTransform = compResult.source;
      compMap = compResult.sourceMap ?? null;
    }
    // Comprehension-preprocessor diagnostics are positioned in the
    // HKT-preprocessed text: map them back through the HKT map only.
    const hktMapper =
      preprocessed && preprocessMap
        ? createPositionMapper(preprocessMap, original, preprocessed.code)
        : null;
    const compDiagnostics: TransformDiagnostic[] = compResult.diagnostics.map((d) =>
      mapDiagnosticToOriginal(
        {
          file: normalizedFileName,
          start: d.start,
          length: d.length,
          message: d.message,
          severity: d.severity,
          code: d.code,
        },
        hktMapper
      )
    );

    // The comprehension rewrite must also be what the CHECKER sees: macros
    // (e.g. do-notation inferring a bind's type constructor) query types of
    // the rewritten nodes. Serve it through the host and rebuild once.
    const currentProgramText = this.program?.getSourceFile(normalizedFileName)?.text;
    if (compResult.changed) {
      if (currentProgramText !== undefined && currentProgramText !== codeForTransform) {
        this.host.setContentOverride(normalizedFileName, codeForTransform);
        this.resetProgram();
        this.ensureProgram();
      }
    } else if (this.host.getContentOverride(normalizedFileName) !== undefined) {
      this.host.setContentOverride(normalizedFileName, undefined);
      this.resetProgram();
      this.ensureProgram();
    }

    // A file outside the Program (not in tsconfig's file list and not
    // imported by it -- a test file next to the project, a bundler handing
    // us some dist/*.js). Running macros on a detached SourceFile makes every
    // checker call throw (CLAUDE.md "Calling the type checker on
    // macro-generated nodes"), so either give it a Program of its own or
    // leave it untouched.
    if (!this.program?.getSourceFile(normalizedFileName)) {
      const isJs = /\.[cm]?jsx?$/.test(normalizedFileName);
      if (!this.isOutOfProjectPipeline && !(isJs && !this.compilerOptions.allowJs)) {
        // One side pipeline for all such files (its roots grow as they
        // arrive): real types, without growing -- and rebuilding -- the
        // project's own Program for every stray file.
        if (!this.outOfProject) {
          this.outOfProject = new TransformationPipeline(this.compilerOptions, [], {
            ...this.options,
            readFile: this.customReadFile,
            // One manifest per cache dir: only the main pipeline writes it.
            diskCache: false,
          });
          this.outOfProject.isOutOfProjectPipeline = true;
        }
        this.outOfProject.addRootFile(normalizedFileName);
        profiler.end("transform");
        return this.outOfProject.transform(normalizedFileName);
      }
      if (this.verbose) {
        console.log(
          `[typesugar] Skipping ${normalizedFileName}: not part of the TypeScript program`
        );
      }
      profiler.end("transform");
      return {
        original,
        code: original,
        sourceMap: null,
        mapper: new IdentityPositionMapper(),
        changed: false,
        diagnostics: [],
        dependencies: new Set(),
      };
    }

    // Get or create source file
    const sourceFile = this.getSourceFile(normalizedFileName, codeForTransform);
    if (!sourceFile) {
      profiler.end("transform");
      return this.createEmptyResult(normalizedFileName);
    }

    // Extract dependencies from source file
    const dependencies = this.extractDependencies(sourceFile, normalizedFileName);

    // Run macro transformer
    const transformerStart = PROFILING_ENABLED ? performance.now() : 0;
    const {
      code: transformed,
      map: transformMap,
      diagnostics: rawMacroDiagnostics,
      printMs,
      expansions,
    } = this.runMacroTransformer(sourceFile, codeForTransform);

    // Macro diagnostics are positioned in `codeForTransform` (after the HKT
    // and comprehension rewrites, which shift text: +6 chars per `F<A>`,
    // more for an injected import). Map them back to the ORIGINAL source
    // (review finding #12).
    const preMap = compMap ? composeSourceMapChain([compMap, preprocessMap]) : preprocessMap;
    const preMapper =
      preMap && codeForTransform !== original
        ? createPositionMapper(preMap, original, codeForTransform)
        : null;
    const diagnostics = rawMacroDiagnostics.map((d) => mapDiagnosticToOriginal(d, preMapper));
    const transformerMs = PROFILING_ENABLED ? performance.now() - transformerStart : 0;

    // Compose source maps
    // Chain: original → (preprocess) → (expr-comp rewrite) → transform.
    // composeSourceMapChain expects outermost first (closest to final).
    const composedMap = compMap
      ? composeSourceMapChain([transformMap, compMap, preprocessMap])
      : composeSourceMaps(preprocessMap, transformMap);

    // Create position mapper
    const mapper = createPositionMapper(composedMap, original, transformed);

    // Determine if file changed (normalize trailing whitespace — the TS printer
    // always adds a trailing newline, causing false-positive diffs for unchanged files)
    const changed = transformed.trimEnd() !== original.trimEnd();

    const result: TransformResult = {
      original,
      code: transformed,
      sourceMap: composedMap,
      mapper,
      changed,
      diagnostics: compDiagnostics.length > 0 ? [...compDiagnostics, ...diagnostics] : diagnostics,
      dependencies,
      expansions,
    };

    // Transpile to JS if requested
    if (this.options.emitJs && changed) {
      this.applyTranspileStep(result, normalizedFileName, composedMap);
    }

    // Cache the result with dependencies
    this.cacheResult(normalizedFileName, result, contentHash, dependencies);

    const totalMs = PROFILING_ENABLED ? performance.now() - transformStart : 0;

    // Record per-file timing breakdown
    if (PROFILING_ENABLED) {
      const fileTimings: FileTimings = {
        fileName: normalizedFileName,
        readMs,
        hashMs,
        cacheCheckMs,
        preprocessMs,
        transformMs: transformerMs,
        printMs: printMs ?? 0,
        totalMs,
      };
      profiler.recordFileTimings(fileTimings);
    }

    profiler.end("transform");

    if (this.verbose) {
      console.log(`[typesugar] Transformed ${normalizedFileName} (changed: ${changed})`);
      if (preprocessed) {
        console.log(`[typesugar]   Preprocessed: yes`);
      }
      console.log(`[typesugar]   Dependencies: ${dependencies.size}`);
      console.log(`[typesugar]   Diagnostics: ${diagnostics.length}`);
    }

    return result;
  }

  /**
   * Transform all files in the project
   */
  transformAll(): Map<string, TransformResult> {
    const results = new Map<string, TransformResult>();
    for (const fileName of this.fileNames) {
      results.set(fileName, this.transform(fileName));
    }
    return results;
  }

  /**
   * Invalidate cache for a file and its dependents
   */
  invalidate(fileName: string): void {
    const normalizedFileName = path.normalize(fileName);
    this.host.invalidate(normalizedFileName);
    this.contentHashes.delete(normalizedFileName);
    this.outOfProject?.invalidate(normalizedFileName);

    // Invalidate this file and all files that depend on it
    this.cache.invalidate(normalizedFileName);

    // The ts.Program (and the transformer factory, which captures it) holds
    // the PRE-edit SourceFile; keeping it would serve the old AST to the
    // macro transformer (and old types to the checker). Rebuild lazily,
    // passing the old program for structural reuse of unchanged files
    // (review finding #4).
    this.resetProgram();

    // Also invalidate disk cache for this file
    if (this.diskCache) {
      this.diskCache.invalidate(normalizedFileName);
    }

    if (this.verbose) {
      const dependents = this.cache.getTransitiveDependents(normalizedFileName);
      if (dependents.size > 0) {
        console.log(
          `[typesugar] Invalidated ${normalizedFileName} and ${dependents.size} dependents`
        );
      }
    }
  }

  /** Add a root file to this pipeline's Program (rebuilt lazily). */
  addRootFile(fileName: string): void {
    const normalized = path.normalize(fileName);
    if (this.fileNames.includes(normalized)) return;
    this.fileNames = [...this.fileNames, normalized];
    this.resetProgram();
  }

  /**
   * Files whose cached transform depends (transitively) on `fileName` -- the
   * ones a host must re-request after `fileName` changes (e.g. Vite HMR).
   */
  getDependents(fileName: string): Set<string> {
    return this.cache.getTransitiveDependents(path.normalize(fileName));
  }

  /**
   * Full invalidation (e.g., tsconfig change)
   */
  invalidateAll(): void {
    this.outOfProject = undefined;
    this.host.invalidateAll();
    this.cache.clear();
    this.contentHashes.clear();
    // Save old program for incremental recompilation
    this.oldProgram = this.program;
    this.program = null;
    this.cachedTransformerFactory = null;
    // Note: We don't clear disk cache on invalidateAll() since it's project-wide
    // and expensive to rebuild. The disk cache has its own versioning.
  }

  /**
   * Lightweight invalidation for single-file content changes (e.g., playground).
   * Resets the TypeScript program for incremental recompilation but preserves
   * the cached transformer factory, which is expensive to recreate.
   */
  invalidateContent(fileName: string): void {
    const normalizedFileName = path.normalize(fileName);
    this.host.invalidate(normalizedFileName);
    this.contentHashes.delete(normalizedFileName);
    this.cache.invalidate(normalizedFileName);
    // Reset program and transformer factory — the factory captures a reference
    // to the program at creation time, so it must be recreated when the program changes.
    this.oldProgram = this.program;
    this.program = null;
    this.cachedTransformerFactory = null;
  }

  /**
   * Get cache statistics for debugging
   */
  getCacheStats(): {
    preprocessedCount: number;
    transformedCount: number;
    accessOrderLength: number;
  } {
    return this.cache.getStats();
  }

  /**
   * Print profiling report (if TYPESUGAR_PROFILE=1)
   */
  printProfilingReport(): void {
    profiler.printReport();
  }

  /**
   * Get profiling report as string (if TYPESUGAR_PROFILE=1)
   */
  getProfilingReport(): string {
    return profiler.generateReport();
  }

  /**
   * Reset profiling data
   */
  resetProfiling(): void {
    profiler.reset();
  }

  /**
   * Cleanup method - saves caches to disk and prints profiling report.
   * Call this when the pipeline is done (e.g., in unplugin's buildEnd hook).
   */
  cleanup(): void {
    // Save expansion cache to disk for future builds
    saveExpansionCache();

    // Save disk transform cache if enabled
    if (this.diskCache) {
      this.diskCache.save();
      if (this.verbose) {
        console.log(`[typesugar] ${this.diskCache.getStatsString()}`);
      }
    }

    // Print profiling report if enabled
    this.printProfilingReport();

    // Log cache stats if verbose
    if (this.verbose) {
      const stats = getExpansionCacheStats();
      if (stats) {
        console.log(`[typesugar] ${stats}`);
      }
    }
  }

  /**
   * Typecheck expanded output (strict mode).
   * Transforms all files and typechecks the result to catch macro bugs.
   *
   * Respects `options.strict`:
   * - `true`: Full typecheck of all files every time
   * - `"incremental"`: Only re-check files whose expanded output changed
   * - `false`/`undefined`: Returns empty (caller should not call in this case)
   *
   * @returns Array of diagnostics from typechecking expanded code
   */
  strictTypecheck(): ts.Diagnostic[] {
    const mode = this.options.strict;
    if (!mode) return [];

    if (mode === "incremental") {
      return this.incrementalStrictTypecheck();
    }

    return this.fullStrictTypecheck();
  }

  /**
   * Full strict typecheck — checks every file. Used when `strict: true`.
   */
  private fullStrictTypecheck(): ts.Diagnostic[] {
    profiler.start("strictTypecheck");

    this.ensureProgram();

    const expandedFiles = new Map<string, string>();

    for (const fileName of this.fileNames) {
      const result = this.transform(fileName);
      if (result.changed) {
        expandedFiles.set(path.normalize(fileName), result.code);
      }
    }

    const expandedHost = ts.createCompilerHost(this.compilerOptions);
    const origExpandedReadFile = expandedHost.readFile.bind(expandedHost);
    expandedHost.readFile = (fileName) => {
      const normalized = path.normalize(fileName);
      const expanded = expandedFiles.get(normalized);
      if (expanded !== undefined) {
        return expanded;
      }
      return origExpandedReadFile(fileName);
    };

    const expandedProgram = ts.createProgram(
      this.fileNames,
      { ...this.compilerOptions, noEmit: true },
      expandedHost,
      this.program ?? undefined
    );

    const diagnostics = [...ts.getPreEmitDiagnostics(expandedProgram)];

    const elapsed = profiler.end("strictTypecheck");
    if (this.verbose) {
      console.log(
        `[typesugar] Strict typecheck: ${diagnostics.length} diagnostics, ` +
          `${this.fileNames.length} files (${elapsed.toFixed(0)}ms)`
      );
    }

    return diagnostics;
  }

  /**
   * Incremental strict typecheck — only re-checks files whose effective
   * content (expanded or original) changed since the last run, plus their
   * transitive dependents. Falls back to full check on first invocation.
   */
  private incrementalStrictTypecheck(): ts.Diagnostic[] {
    profiler.start("strictTypecheck");

    this.ensureProgram();

    // 1. Transform all files, collect expanded code + effective hashes
    const expandedFiles = new Map<string, string>();
    const currentEffectiveHashes = new Map<string, string>();

    for (const fileName of this.fileNames) {
      const result = this.transform(fileName);
      const normalized = path.normalize(fileName);
      const effectiveContent = result.changed ? result.code : result.original;

      if (result.changed) {
        expandedFiles.set(normalized, result.code);
      }
      currentEffectiveHashes.set(normalized, hashContent(effectiveContent));
    }

    // 2. Determine which files changed since the last strict typecheck
    const isFirstRun = this.strictCache.effectiveHashes.size === 0;
    const changedFiles = new Set<string>();

    if (!isFirstRun) {
      for (const [normalized, currentHash] of currentEffectiveHashes) {
        const previousHash = this.strictCache.effectiveHashes.get(normalized);
        if (previousHash !== currentHash) {
          changedFiles.add(normalized);
        }
      }
      // Files removed since last run
      for (const prev of this.strictCache.effectiveHashes.keys()) {
        if (!currentEffectiveHashes.has(prev)) {
          changedFiles.add(prev);
        }
      }
    }

    // 3. Expand to include transitive dependents
    const filesToCheck = new Set(changedFiles);
    for (const changed of changedFiles) {
      for (const dep of this.cache.getTransitiveDependents(changed)) {
        filesToCheck.add(dep);
      }
    }

    // 4. Create expanded host
    const expandedHost = ts.createCompilerHost(this.compilerOptions);
    const origExpandedReadFile = expandedHost.readFile.bind(expandedHost);
    expandedHost.readFile = (fileName) => {
      const normalized = path.normalize(fileName);
      const expanded = expandedFiles.get(normalized);
      if (expanded !== undefined) return expanded;
      return origExpandedReadFile(fileName);
    };

    // 5. Create expanded program (reuse previous for structural sharing)
    const expandedProgram = ts.createProgram(
      this.fileNames,
      { ...this.compilerOptions, noEmit: true },
      expandedHost,
      this.strictCache.expandedProgram ?? this.program ?? undefined
    );

    // 6. Collect diagnostics — re-check changed+dependent files, reuse cache for rest
    const allDiagnostics: ts.Diagnostic[] = [];
    const newFileDiagnostics = new Map<string, readonly ts.Diagnostic[]>();

    for (const fileName of this.fileNames) {
      const normalized = path.normalize(fileName);

      if (isFirstRun || filesToCheck.has(normalized)) {
        const sourceFile = expandedProgram.getSourceFile(normalized);
        if (sourceFile) {
          const fileDiags = [
            ...expandedProgram.getSyntacticDiagnostics(sourceFile),
            ...expandedProgram.getSemanticDiagnostics(sourceFile),
          ];
          newFileDiagnostics.set(normalized, fileDiags);
          allDiagnostics.push(...fileDiags);
        }
      } else {
        const cached = this.strictCache.fileDiagnostics.get(normalized);
        if (cached && cached.length > 0) {
          newFileDiagnostics.set(normalized, cached);
          allDiagnostics.push(...cached);
        }
      }
    }

    // Global + options diagnostics always included
    allDiagnostics.push(...expandedProgram.getGlobalDiagnostics());
    allDiagnostics.push(...expandedProgram.getOptionsDiagnostics());

    // 7. Update cache
    this.strictCache.effectiveHashes = currentEffectiveHashes;
    this.strictCache.fileDiagnostics = newFileDiagnostics;
    this.strictCache.expandedProgram = expandedProgram;

    const checkedCount = isFirstRun ? this.fileNames.length : filesToCheck.size;
    const elapsed = profiler.end("strictTypecheck");
    if (this.verbose) {
      console.log(
        `[typesugar] Strict typecheck (incremental): ${checkedCount} of ${this.fileNames.length} files, ` +
          `${allDiagnostics.length} diagnostics (${elapsed.toFixed(0)}ms)`
      );
    }

    return allDiagnostics;
  }

  /**
   * Get the current ts.Program (creates if needed)
   */
  getProgram(): ts.Program {
    this.ensureProgram();
    return this.program!;
  }

  /**
   * Get preprocessed file info (for debugging/IDE features)
   */
  getPreprocessedFile(fileName: string): PreprocessedFile | undefined {
    return this.host.getPreprocessedFile(fileName);
  }

  /**
   * Get all file names in the project
   */
  getFileNames(): string[] {
    return this.fileNames;
  }

  /** The compiler options this pipeline's Program is built with. */
  getCompilerOptions(): ts.CompilerOptions {
    return this.compilerOptions;
  }

  /**
   * Check if a file should be transformed (based on extensions)
   */
  shouldTransform(fileName: string): boolean {
    // Skip node_modules and declaration files
    if (fileName.includes("node_modules")) return false;
    if (fileName.endsWith(".d.ts")) return false;

    if (/\.d\.[cm]?ts$/.test(fileName)) return false;

    // Transform TS/TSX/JS/JSX, including the .mts/.cts/.mjs/.cjs module
    // variants. (A former path regex excluding `packages/{core,macros,...}/src`
    // -- meant for typesugar's own monorepo -- also excluded USER files at
    // such paths; tooling review #11.)
    return /\.[cm]?[tj]sx?$/.test(fileName);
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Old program reference for incremental compilation.
   * Allows ts.createProgram to reuse unchanged ASTs.
   */
  private oldProgram: ts.Program | null = null;

  /**
   * PEP-052: whether either do-notation comprehension macro (`let:`/`par:`)
   * has its label syntax activated in the file. Used to gate the
   * expression-comprehension TEXT preprocessor, which otherwise commits to
   * do-notation before the AST-level activation gate can run. Scans the
   * program's copy of the file (falling back to a detached parse when the
   * file is not in the program — the registry `syntaxModule` text fallback
   * still applies there). The scan re-runs later in the transformer and is
   * idempotent.
   */
  private isComprehensionSyntaxActivated(fileName: string, code: string): boolean {
    // Cheap text pre-filter: the activation scan (a full import walk, which
    // the transformer repeats later) is only worth paying for files that can
    // possibly contain a comprehension label. Everything else skips both the
    // scan AND the preprocessor.
    if (!/\b(?:let|seq|par|all)\s*:/.test(code)) return false;
    const scanFile =
      this.program?.getSourceFile(fileName) ??
      ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false);
    // The comprehension macros live in a macro package (@typesugar/std)
    // that is normally loaded lazily by the transformer factory / per-file
    // import scan -- AFTER this gate on the first file, which then saw an
    // empty registry and skipped the rewrite (review finding #9). Load
    // packages first; both calls are idempotent.
    this.ensureTransformerFactory();
    loadMacroPackagesFromFile(scanFile, this.verbose);
    const letMacro = globalRegistry.getLabeledBlock("let")?.name;
    const parMacro = globalRegistry.getLabeledBlock("par")?.name;
    if (!letMacro && !parMacro) return false;
    scanImportsForScope(scanFile, globalResolutionScope, this.program ?? undefined);
    return [letMacro, parMacro].some(
      (name) => name && globalResolutionScope.isLabelSyntaxActivated(fileName, name)
    );
  }

  /** Drop the Program (and the factory bound to it); rebuilt lazily. */
  private resetProgram(): void {
    if (this.program) this.oldProgram = this.program;
    this.program = null;
    this.cachedTransformerFactory = null;
  }

  private ensureProgram(): void {
    if (!this.program) {
      profiler.start("ensureProgram");
      if (this.verbose) {
        const mode = this.oldProgram ? "incremental" : "initial";
        console.log(
          `[typesugar] Creating TypeScript program with ${this.fileNames.length} files (${mode})`
        );
      }
      // Pass old program for incremental compilation (reuses unchanged ASTs)
      this.program = ts.createProgram(
        this.fileNames,
        this.compilerOptions,
        this.host,
        this.oldProgram ?? undefined
      );
      const elapsed = profiler.end("ensureProgram");
      if (PROFILING_ENABLED && elapsed > 100) {
        console.log(
          `[profiler] ensureProgram: ${elapsed.toFixed(1)}ms (${this.fileNames.length} files)`
        );
      }
    }
  }

  /**
   * The transformer factory for the current program (created once per
   * program; creating it loads the program's macro packages).
   */
  private ensureTransformerFactory(): ts.TransformerFactory<ts.SourceFile> {
    this.ensureProgram();
    if (!this.cachedTransformerFactory) {
      profiler.start("macroTransformerFactory");
      this.cachedTransformerFactory = macroTransformerFactory(
        this.program!,
        this.transformerConfig
      );
      const factoryMs = profiler.end("macroTransformerFactory");
      if (PROFILING_ENABLED && factoryMs > 100) {
        console.log(`[profiler] macroTransformerFactory: ${factoryMs.toFixed(1)}ms`);
      }
    }
    return this.cachedTransformerFactory;
  }

  private getSourceFile(fileName: string, code: string): ts.SourceFile | undefined {
    // First try to get from program (for type information)
    const programSourceFile = this.program?.getSourceFile(fileName);

    if (programSourceFile) {
      // The program's copy already holds the preprocessed text (the host
      // serves it). Only if the text still differs is a detached copy made --
      // which has NO type information, so prefer the program's.
      if (code !== programSourceFile.text) {
        return ts.createSourceFile(
          fileName,
          code,
          this.compilerOptions.target ?? ts.ScriptTarget.Latest,
          true
        );
      }
      return programSourceFile;
    }

    // File not in program - create standalone source file
    return ts.createSourceFile(
      fileName,
      code,
      this.compilerOptions.target ?? ts.ScriptTarget.Latest,
      true
    );
  }

  private runMacroTransformer(
    sourceFile: ts.SourceFile,
    originalCode: string
  ): {
    code: string;
    map: RawSourceMap | null;
    diagnostics: TransformDiagnostic[];
    printMs?: number;
    expansions?: ExpansionRecord[];
  } {
    return this.runTypescriptTransformer(sourceFile, originalCode);
  }

  /**
   * Run the TypeScript-based macro transformer.
   *
   * Uses ts.transform() with the macro transformer factory for full
   * type-aware macro expansion.
   */
  private runTypescriptTransformer(
    sourceFile: ts.SourceFile,
    originalCode: string
  ): {
    code: string;
    map: RawSourceMap | null;
    diagnostics: TransformDiagnostic[];
    printMs?: number;
    expansions?: ExpansionRecord[];
  } {
    // Clear expansion tracker before transformation
    globalExpansionTracker.clear();

    try {
      const factory = this.ensureTransformerFactory();

      profiler.start("ts.transform");
      const result = ts.transform(sourceFile, [factory]);
      profiler.end("ts.transform");

      if (result.transformed.length === 0) {
        result.dispose();
        return { code: originalCode, map: null, diagnostics: [], printMs: 0 };
      }

      const transformedSourceFile = result.transformed[0];

      // Collect diagnostics even if the AST didn't change (macros may have
      // reported errors without modifying the AST, e.g. summon() for a missing instance)
      const rawDiagnostics = result.diagnostics ?? [];

      if (rawDiagnostics.length > 0 && this.options.verbose) {
        for (const d of rawDiagnostics) {
          console.log(
            `[typesugar pipeline] raw diag: start=${d.start}, length=${d.length}, file=${d.file?.fileName ?? "none"}`
          );
        }
      }

      // OPTIMIZATION: Skip printing if the AST didn't change (reference equality)
      // This is a significant win for files with no macros or macro-free regions
      if (transformedSourceFile === sourceFile) {
        const unchangedDiags: TransformDiagnostic[] = rawDiagnostics.map((d) => {
          const message =
            typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
          const codeMatch = message.match(/\[TS(\d{4})\]/);
          const suggestionText = (d as { __typesugarSuggestion?: string }).__typesugarSuggestion;
          const result: TransformDiagnostic = {
            file: d.file?.fileName ?? sourceFile.fileName,
            start: d.start ?? 0,
            length: d.length ?? 0,
            message,
            severity:
              d.category === ts.DiagnosticCategory.Error
                ? ("error" as const)
                : ("warning" as const),
            code: d.code ?? (codeMatch ? parseInt(codeMatch[1], 10) : undefined),
          };
          if (suggestionText) {
            result.suggestion = {
              description: "Apply suggested fix",
              start: d.start ?? 0,
              length: d.length ?? 0,
              replacement: suggestionText,
            };
          }
          return result;
        });
        result.dispose();
        globalExpansionTracker.clear();
        return { code: originalCode, map: null, diagnostics: unchangedDiags, printMs: 0 };
      }

      const diagnostics: TransformDiagnostic[] = rawDiagnostics.map((d) => {
        const message =
          typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
        const codeMatch = message.match(/\[TS(\d{4})\]/);
        const suggestionText = (d as { __typesugarSuggestion?: string }).__typesugarSuggestion;
        const result: TransformDiagnostic = {
          file: d.file?.fileName ?? sourceFile.fileName,
          start: d.start ?? 0,
          length: d.length ?? 0,
          message,
          severity:
            d.category === ts.DiagnosticCategory.Error ? ("error" as const) : ("warning" as const),
          code: d.code ?? (codeMatch ? parseInt(codeMatch[1], 10) : undefined),
        };
        if (suggestionText) {
          result.suggestion = {
            description: "Apply suggested fix",
            start: d.start ?? 0,
            length: d.length ?? 0,
            replacement: suggestionText,
          };
        }
        return result;
      });

      profiler.start("printFile");
      const printStart = PROFILING_ENABLED ? performance.now() : 0;

      // Always use the AST printer — it's correct by construction since it
      // reprints the entire transformed AST.
      //
      // Previous approach used surgical text replacement via ExpansionTracker
      // when preserveBlankLines was true. This was fragile because it required
      // every AST modification to manually record an expansion — any untracked
      // change (companion objects, implicit resolution, extension rewrites,
      // constructor erasure) was silently lost. The AST printer + blank line
      // restoration is correct by default with no opt-in tracking required.
      const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
      const transformed = printer.printFile(transformedSourceFile);

      // Generate source map by walking the transformed AST.
      const map = generateASTSourceMap(
        originalCode,
        transformedSourceFile,
        transformed,
        sourceFile.fileName
      );

      const printMs = PROFILING_ENABLED ? performance.now() - printStart : 0;
      profiler.end("printFile");

      // Dispose only AFTER printing: dispose() clears the emit nodes (emit
      // flags, comment/source-map ranges) macros attached to nodes, which the
      // printer needs.
      result.dispose();

      // Capture expansion records before clearing
      const expansions = globalExpansionTracker.getExpansionsForFile(sourceFile.fileName);

      // Clear tracker after extracting data
      globalExpansionTracker.clear();

      return {
        code: transformed,
        map,
        diagnostics,
        printMs,
        expansions: expansions.length > 0 ? expansions : undefined,
      };
    } catch (error) {
      const stack = error instanceof Error ? error.stack : String(error);
      if (this.verbose) {
        console.error(`[typesugar] Transform error for ${sourceFile.fileName}:\n${stack}`);
      }
      return {
        code: originalCode,
        map: null,
        diagnostics: [
          {
            file: sourceFile.fileName,
            start: 0,
            length: 0,
            message: `Transform failed: ${error}`,
            severity: "error",
          },
        ],
        printMs: 0,
      };
    }
  }

  private checkCache(fileName: string, contentHash: string): TransformResult | null {
    // Check if cache is valid with dependency validation
    // Dependency hashes are re-read from the file system/reader rather than
    // taken from `contentHashes`: an edited dependency that nobody reported
    // via invalidate() (an editor buffer, a file outside the watcher) must
    // still invalidate its dependents (review findings #7/#17).
    const isValid = this.cache.isTransformedValid(fileName, contentHash, (dep) =>
      this.getContentHash(dep, true)
    );

    if (!isValid) {
      // A stale entry means something this file's output depends on
      // changed; the Program still holds the old ASTs/types for it.
      if (this.cache.getTransformed(fileName)) this.resetProgram();
      return null;
    }

    const entry = this.cache.getTransformed(fileName);
    return entry?.result ?? null;
  }

  /**
   * Apply the transpile step to a TransformResult, populating `js` and `jsSourceMap`.
   * Used by both the fresh-transform path and the disk-cache-hit path.
   */
  private applyTranspileStep(
    result: TransformResult,
    fileName: string,
    upstreamMap: RawSourceMap | null
  ): void {
    const transpiled = transpileExpanded(result.code, fileName, this.compilerOptions);
    result.js = transpiled.outputText.replace(/\n\/\/# sourceMappingURL=.*$/m, "");
    if (transpiled.sourceMapText) {
      const transpileMap = JSON.parse(transpiled.sourceMapText) as RawSourceMap;
      result.jsSourceMap = composeSourceMapChain([transpileMap, upstreamMap]);
    }
  }

  private cacheResult(
    fileName: string,
    result: TransformResult,
    contentHash: string,
    dependencies: Set<string>,
    writeToDisk: boolean = true
  ): void {
    // Compute dependency hashes for validation
    const dependencyHashes = new Map<string, string>();
    for (const dep of dependencies) {
      const hash = this.getContentHash(dep);
      if (hash) {
        dependencyHashes.set(dep, hash);
      }
    }

    this.cache.setTransformed(fileName, {
      result,
      contentHash,
      dependencies,
      dependencyHashes,
    });

    // Write to disk cache if enabled and this is a fresh transform
    if (writeToDisk && this.diskCache) {
      const depHashRecord: Record<string, string> = {};
      for (const [dep, hash] of dependencyHashes) {
        depHashRecord[dep] = hash;
      }
      this.diskCache.set(
        fileName,
        contentHash,
        Array.from(dependencies),
        depHashRecord,
        result.code,
        result.sourceMap,
        result.diagnostics
      );
    }
  }

  private getContentHash(fileName: string, fresh = false): string | undefined {
    // Check cache first
    const cached = fresh ? undefined : this.contentHashes.get(fileName);
    if (cached) return cached;

    // Compute and cache
    const content = this.customReadFile(fileName);
    if (!content) return undefined;

    const hash = hashContent(content);
    this.contentHashes.set(fileName, hash);
    return hash;
  }

  /**
   * The project files this file's output depends on: everything it imports,
   * re-exports (`export ... from`), `import()`s anywhere in the file, or
   * `import x = require()`s, resolved with the program's own module
   * resolution (so NodeNext `./a.js` finds `a.ts`), plus -- transitively --
   * their dependencies, since a re-exported or imported type can change the
   * expansion. External (node_modules) and declaration files are excluded.
   * (Review finding #7.)
   */
  private extractDependencies(sourceFile: ts.SourceFile, containingFile: string): Set<string> {
    const dependencies = new Set<string>();
    const queue: Array<{ sf: ts.SourceFile; file: string }> = [
      { sf: sourceFile, file: containingFile },
    ];
    const seen = new Set<string>([containingFile]);
    while (queue.length > 0) {
      const { sf, file } = queue.shift()!;
      for (const spec of collectModuleSpecifiers(sf)) {
        const resolved = this.resolveDependency(spec, file);
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        dependencies.add(resolved);
        const depSf =
          this.program?.getSourceFile(resolved) ??
          (() => {
            const text = this.customReadFile(resolved);
            return text === undefined
              ? undefined
              : ts.createSourceFile(resolved, text, ts.ScriptTarget.Latest, false);
          })();
        if (depSf) queue.push({ sf: depSf, file: resolved });
      }
    }
    return dependencies;
  }

  /** Resolve a module specifier to a project source file, or undefined. */
  private resolveDependency(spec: string, containingFile: string): string | undefined {
    const resolved = this.host.resolveModuleNames(
      [spec],
      containingFile,
      undefined,
      undefined,
      this.compilerOptions
    )[0];
    if (!resolved || resolved.isExternalLibraryImport) return undefined;
    const file = path.normalize(resolved.resolvedFileName);
    if (/\.d\.[cm]?ts$/.test(file) || file.includes("node_modules")) return undefined;
    return file;
  }

  private createEmptyResult(fileName: string): TransformResult {
    return {
      original: "",
      code: "",
      sourceMap: null,
      mapper: new IdentityPositionMapper(),
      changed: false,
      diagnostics: [
        {
          file: fileName,
          start: 0,
          length: 0,
          message: `File not found: ${fileName}`,
          severity: "error",
        },
      ],
    };
  }
}

/**
 * Every module specifier a file depends on: import/export-from declarations,
 * `import x = require("...")`, and `import("...")`/`require("...")` calls
 * anywhere in the file.
 */
function collectModuleSpecifiers(sf: ts.SourceFile): string[] {
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specs.push(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    }
  };
  // Explicit stack, not recursion: a deeply nested expression (e.g. a
  // 10k-term `1 + 1 + ...` chain) would overflow the call stack.
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const node = stack.pop()!;
    visit(node);
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return specs;
}

/**
 * Map a diagnostic (and its suggestion span) from preprocessed-text offsets
 * back to original-source offsets. Positions the map can't resolve are kept.
 */
function mapDiagnosticToOriginal(
  d: TransformDiagnostic,
  mapper: PositionMapper | null
): TransformDiagnostic {
  if (!mapper) return d;
  const mapSpan = (start: number, length: number): { start: number; length: number } => {
    const s = mapper.toOriginal(start);
    if (s === null) return { start, length };
    const e = mapper.toOriginal(start + length);
    return { start: s, length: e !== null && e >= s ? e - s : length };
  };
  const span = mapSpan(d.start, d.length);
  const out: TransformDiagnostic = { ...d, start: span.start, length: span.length };
  if (d.suggestion) {
    const sug = mapSpan(d.suggestion.start, d.suggestion.length);
    out.suggestion = { ...d.suggestion, start: sug.start, length: sug.length };
  }
  return out;
}

/**
 * Create a pipeline from a tsconfig.json path
 */
export function createPipeline(
  tsconfigPath: string,
  options?: PipelineOptions
): TransformationPipeline {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Error reading ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
    );
  }

  // Passing the config file name sets `compilerOptions.configFilePath`,
  // which comptime's fs project root prefers (the tsconfig's directory).
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    path.resolve(tsconfigPath)
  );

  // Surface tsconfig problems (unknown options, bad `extends`, invalid
  // values) instead of silently building with a half-parsed config.
  const configErrors = parsed.errors.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (configErrors.length > 0) {
    throw new Error(
      `Error in ${tsconfigPath}:\n` +
        configErrors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n")
    );
  }

  // Load the project's typesugar config (typesugar.config.*, package.json
  // "typesugar") searching from the tsconfig's directory, not process.cwd():
  // a bundler/IDE host's cwd is often not the project.
  config.load({ searchFrom: path.dirname(path.resolve(tsconfigPath)) });

  return new TransformationPipeline(parsed.options, parsed.fileNames, options);
}

/**
 * Simple single-file transformation (no type info)
 *
 * Use this for quick transformations. Falls through to the real filesystem
 * for lib files so the TypeScript type checker works correctly.
 */
export function transformCode(
  code: string,
  options?: { fileName?: string; extraRootFiles?: string[] } & PipelineOptions
): TransformResult {
  const fileName = path.resolve(options?.fileName ?? "input.ts");
  const callerReadFile = options?.readFile ?? ts.sys.readFile;
  const callerFileExists = options?.fileExists ?? ts.sys.fileExists;
  const rootFiles = [fileName, ...(options?.extraRootFiles ?? [])];
  const pipeline = new TransformationPipeline(
    {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
      strict: false,
      noImplicitAny: false,
      skipLibCheck: true,
      skipDefaultLibCheck: true,
    },
    rootFiles,
    {
      ...options,
      readFile: (f) =>
        f === fileName || f === (options?.fileName ?? "input.ts") ? code : callerReadFile(f),
      fileExists: (f) =>
        f === fileName || f === (options?.fileName ?? "input.ts") || callerFileExists(f),
    }
  );
  const result = pipeline.transform(fileName);

  if (options?.strictOutput && result.changed) {
    const outputDiags = typecheckOutput(
      result.code,
      code,
      fileName,
      options.extraRootFiles,
      callerReadFile,
      callerFileExists
    );
    if (outputDiags.length > 0) {
      result.diagnostics = [...result.diagnostics, ...outputDiags];
    }
  }

  return result;
}

/**
 * Compiler options for the strict output typecheck.
 * Intentionally permissive — we only want to catch transformer bugs,
 * not be a strict linter. `types: []` prevents loading `@types/*` from
 * disk which is the main source of slowness.
 */
const STRICT_OUTPUT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  strict: false,
  strictNullChecks: false,
  noImplicitAny: false,
  noEmit: true,
  skipLibCheck: true,
  skipDefaultLibCheck: true,
  types: [],
  typeRoots: [],
};

/**
 * Typecheck a transformed output string to verify it's valid TypeScript.
 *
 * Uses a single ts.Program with both input and output as separate virtual
 * files to avoid the cost of creating two programs. Compares diagnostics
 * to only report errors that are NEW (introduced by transformation).
 */
function typecheckOutput(
  outputCode: string,
  inputCode: string,
  fileName: string,
  extraRootFiles?: string[],
  callerReadFile?: (f: string) => string | undefined,
  callerFileExists?: (f: string) => boolean
): TransformDiagnostic[] {
  const readFile = callerReadFile ?? ts.sys.readFile;
  const fileExists = callerFileExists ?? ts.sys.fileExists;

  const outputFileName = fileName;
  const inputFileName = fileName.replace(/\.(ts|tsx)$/, ".__input__.$1");
  const virtualFiles = new Map<string, string>([
    [outputFileName, outputCode],
    [inputFileName, inputCode],
  ]);
  const knownFiles = new Set<string>([outputFileName, inputFileName, ...(extraRootFiles ?? [])]);

  const host = ts.createCompilerHost(STRICT_OUTPUT_COMPILER_OPTIONS);
  const origReadFile = host.readFile.bind(host);
  const origFileExists = host.fileExists.bind(host);

  // Every file is served in the runtime view of @opaque types, the view the
  // expanded code is written against (opaqueTypesAsUnderlying).
  const serve = (f: string, text: string | undefined) =>
    text === undefined ? undefined : opaqueTypesAsUnderlying(f, text);
  host.readFile = (f) => {
    const virtual = virtualFiles.get(f);
    if (virtual !== undefined) return serve(f, virtual);
    if (knownFiles.has(f)) {
      const custom = readFile(f);
      if (custom !== undefined) return serve(f, custom);
    }
    if (f.includes("lib.") && f.endsWith(".d.ts")) return origReadFile(f);
    return serve(f, readFile(f));
  };
  host.fileExists = (f) => {
    if (knownFiles.has(f)) return true;
    if (f.includes("lib.") && f.endsWith(".d.ts")) return origFileExists(f);
    return fileExists(f);
  };

  const rootFiles = [outputFileName, inputFileName, ...(extraRootFiles ?? [])];
  const program = ts.createProgram(rootFiles, STRICT_OUTPUT_COMPILER_OPTIONS, host);

  function getDiags(target: string): {
    msgs: Set<string>;
    diags: { msg: string; start: number; length: number; code: number }[];
  } {
    const sf = program.getSourceFile(target);
    if (!sf) return { msgs: new Set(), diags: [] };
    const raw = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    const msgs = new Set<string>();
    const diags: { msg: string; start: number; length: number; code: number }[] = [];
    for (const d of raw) {
      const msg = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
      msgs.add(msg);
      diags.push({ msg, start: d.start ?? 0, length: d.length ?? 0, code: d.code });
    }
    return { msgs, diags };
  }

  const { diags: outputDiags } = getDiags(outputFileName);
  if (outputDiags.length === 0) return [];

  const { msgs: inputMsgs } = getDiags(inputFileName);

  return outputDiags
    .filter((d) => !inputMsgs.has(d.msg))
    .map((d) => ({
      file: fileName,
      start: d.start,
      length: d.length,
      message: `[strictOutput] ${d.msg}`,
      severity: "warning" as const,
      code: d.code,
    }));
}

/**
 * Format a TransformResult as a focused diff showing only changed regions.
 *
 * Uses a Myers-like greedy LCS diff on lines, then emits hunks with
 * `contextLines` of surrounding unchanged source. Non-adjacent hunks
 * are separated by `···` markers.
 *
 * Works for ALL transformation types — macros, preprocessor rewrites,
 * AST-level changes — because it compares the actual output, not tracked
 * expansion records.
 *
 * @param result - A TransformResult (needs original and code)
 * @param contextLines - Number of context lines around each hunk (default 3)
 */
export function formatExpansions(result: TransformResult, contextLines: number = 3): string {
  if (!result.changed) return "No changes.";

  const origLines = result.original.split("\n");
  const newLines = result.code.split("\n");

  // Build edit script via greedy LCS (Hunt–Szymanski style)
  type Edit = { kind: "equal" | "delete" | "insert"; line: string; origIdx?: number };
  const edits: Edit[] = [];

  const oLen = origLines.length;
  const nLen = newLines.length;
  let oi = 0;
  let ni = 0;

  // Build a simple longest common subsequence alignment using a two-pointer
  // approach with lookahead. This is O(n*k) where k is the max lookahead.
  const MAX_LOOK = 50;

  while (oi < oLen || ni < nLen) {
    if (oi < oLen && ni < nLen && origLines[oi] === newLines[ni]) {
      edits.push({ kind: "equal", line: origLines[oi], origIdx: oi });
      oi++;
      ni++;
      continue;
    }

    // Try to resync: find the nearest match in both directions
    let bestOff = -1;
    let bestNOff = -1;
    let bestCost = MAX_LOOK * 2 + 1;

    for (let lo = 0; lo < MAX_LOOK && oi + lo < oLen; lo++) {
      for (let ln = 0; ln < MAX_LOOK && ni + ln < nLen; ln++) {
        if (origLines[oi + lo] === newLines[ni + ln] && lo + ln < bestCost) {
          bestOff = lo;
          bestNOff = ln;
          bestCost = lo + ln;
          if (bestCost === 0) break;
        }
      }
      if (bestCost === 0) break;
    }

    if (bestOff < 0) {
      // No resync found within lookahead — emit remaining as deletes/inserts
      while (oi < oLen) {
        edits.push({ kind: "delete", line: origLines[oi], origIdx: oi });
        oi++;
      }
      while (ni < nLen) {
        edits.push({ kind: "insert", line: newLines[ni] });
        ni++;
      }
      break;
    }

    // Emit deletes for skipped original lines
    for (let i = 0; i < bestOff; i++) {
      edits.push({ kind: "delete", line: origLines[oi], origIdx: oi });
      oi++;
    }
    // Emit inserts for skipped new lines
    for (let i = 0; i < bestNOff; i++) {
      edits.push({ kind: "insert", line: newLines[ni] });
      ni++;
    }
  }

  // Identify changed regions (hunks)
  interface Hunk {
    startIdx: number;
    endIdx: number; // exclusive
  }

  const hunks: Hunk[] = [];
  let inHunk = false;
  let hunkStart = 0;

  for (let i = 0; i < edits.length; i++) {
    if (edits[i].kind !== "equal") {
      if (!inHunk) {
        hunkStart = i;
        inHunk = true;
      }
    } else if (inHunk) {
      hunks.push({ startIdx: hunkStart, endIdx: i });
      inHunk = false;
    }
  }
  if (inHunk) {
    hunks.push({ startIdx: hunkStart, endIdx: edits.length });
  }

  if (hunks.length === 0) return "No changes.";

  // Expand hunks with context and merge overlapping
  const contextHunks: Hunk[] = [];
  for (const h of hunks) {
    const expanded = {
      startIdx: Math.max(0, h.startIdx - contextLines),
      endIdx: Math.min(edits.length, h.endIdx + contextLines),
    };
    const last = contextHunks[contextHunks.length - 1];
    if (last && expanded.startIdx <= last.endIdx) {
      last.endIdx = Math.max(last.endIdx, expanded.endIdx);
    } else {
      contextHunks.push(expanded);
    }
  }

  // Render
  const maxOrigLine = oLen;
  const gutterWidth = String(maxOrigLine).length;
  const parts: string[] = [];

  let changeCount = 0;
  for (const edit of edits) {
    if (edit.kind === "delete" || edit.kind === "insert") changeCount++;
  }

  for (let hi = 0; hi < contextHunks.length; hi++) {
    if (hi > 0) parts.push("···");
    const ch = contextHunks[hi];

    for (let i = ch.startIdx; i < ch.endIdx; i++) {
      const edit = edits[i];
      const lineNum =
        edit.origIdx !== undefined
          ? String(edit.origIdx + 1).padStart(gutterWidth)
          : " ".repeat(gutterWidth);

      switch (edit.kind) {
        case "equal":
          parts.push(`${lineNum} |   ${edit.line}`);
          break;
        case "delete":
          parts.push(`${lineNum} | - ${edit.line}`);
          break;
        case "insert":
          parts.push(`${" ".repeat(gutterWidth)} | + ${edit.line}`);
          break;
      }
    }
  }

  const header = `${changeCount} changed line${changeCount === 1 ? "" : "s"} in ${contextHunks.length} region${contextHunks.length === 1 ? "" : "s"}`;
  return `${header}\n${parts.join("\n")}`;
}

/**
 * Restore blank lines that TypeScript's printer strips.
 *
 * Uses a greedy two-pointer alignment: walks the printed output and the
 * original source together, re-inserting blank lines from the original
 * whenever the surrounding content lines match up. Lines that were
 * replaced by macro expansion (no match in original) pass through as-is.
 *
 * @deprecated Unused by the pipeline (blank-line restoration was removed in
 * PEP-032 Wave 10); kept only because it is part of the public export list.
 * Will be removed.
 */
export function restoreBlankLines(original: string, printed: string): string {
  const origLines = original.split("\n");
  const printedLines = printed.split("\n");
  const result: string[] = [];
  const MAX_LOOKAHEAD = 30;

  let oi = 0;

  for (let ti = 0; ti < printedLines.length; ti++) {
    const tTrimmed = printedLines[ti].trim();

    // Printed blank lines pass through unchanged
    if (tTrimmed === "") {
      result.push(printedLines[ti]);
      continue;
    }

    // Try to find a matching content line in the original within a window
    let matchOffset = -1;
    for (let look = 0; look < MAX_LOOKAHEAD && oi + look < origLines.length; look++) {
      if (origLines[oi + look].trim() === tTrimmed) {
        matchOffset = look;
        break;
      }
    }

    if (matchOffset >= 0) {
      // Emit blank lines from the skipped region in the original
      for (let j = 0; j < matchOffset; j++) {
        if (origLines[oi + j].trim() === "") {
          result.push("");
        }
      }
      oi += matchOffset + 1;
    }

    result.push(printedLines[ti]);
  }

  return result.join("\n");
}
