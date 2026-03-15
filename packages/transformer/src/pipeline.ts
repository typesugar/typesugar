/**
 * TransformationPipeline - Unified transformation orchestration
 *
 * This is the single source of truth for all typesugar transformation.
 * Used by: unplugin-typesugar, ts-patch, ts-plugin.
 */

import * as ts from "typescript";
import * as path from "path";
import { globalExpansionTracker, type ExpansionRecord } from "@typesugar/core";
import { type RawSourceMap } from "@typesugar/preprocessor";
import { VirtualCompilerHost, type PreprocessedFile } from "./virtual-host.js";
import { composeSourceMaps } from "./source-map-utils.js";
import {
  createPositionMapper,
  IdentityPositionMapper,
  type PositionMapper,
} from "./position-mapper.js";
import { TransformCache, hashContent, DiskTransformCache, initHasher } from "./cache.js";
import macroTransformerFactory, {
  type MacroTransformerConfig,
  saveExpansionCache,
  getExpansionCacheStats,
} from "./index.js";
import { profiler, PROFILING_ENABLED, type FileTimings } from "./profiling.js";
import { transformWithOxcBackend, type OxcBackendResult } from "./oxc-backend.js";

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
  /** Composed source map (original → transformed) */
  sourceMap: RawSourceMap | null;
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
 * Transformation backend to use
 *
 * - 'oxc' (default): Uses the oxc-native macro engine (faster parsing/codegen).
 *   Automatically falls back to TypeScript for files with type-aware macros.
 * - 'typescript': Uses TypeScript's transformer API (handles all macro types)
 */
export type TransformBackend = "typescript" | "oxc";

/**
 * Options for the transformation pipeline
 */
export interface PipelineOptions {
  /** Enable verbose logging */
  verbose?: boolean;
  /**
   * Transformation backend to use (default: 'oxc')
   *
   * - 'oxc': oxc-native macro engine (faster parsing/codegen, auto-falls back to TS
   *   when type-aware macros are detected)
   * - 'typescript': Traditional TypeScript transformer API (handles all macro types)
   *
   * The oxc backend is the default for performance. Files with type-aware macros
   * (@typeclass, @impl, @op, @deriving) automatically fall back to TypeScript.
   */
  backend?: TransformBackend;
  /** Syntax extensions to enable (defaults to all) */
  extensions?: ("hkt" | "pipeline" | "cons" | "decorator-rewrite")[];
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
   * When false (default), reprints the full AST via TypeScript's printer,
   * which strips blank lines and may reformat code.
   */
  preserveBlankLines?: boolean;
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
  private extensions: ("hkt" | "pipeline" | "cons" | "decorator-rewrite")[];
  private transformerConfig: MacroTransformerConfig;
  private customReadFile: (fileName: string) => string | undefined;
  private fileNames: string[];
  /** Content hash cache for dependency validation */
  private contentHashes = new Map<string, string>();
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
    this.verbose = options.verbose ?? false;
    this.extensions = options.extensions ?? ["hkt", "pipeline", "cons", "decorator-rewrite"];
    this.transformerConfig = {
      verbose: this.verbose,
      ...options.transformerConfig,
    };
    // Surgical text replacement needs expansion tracking to know what changed
    if (options.preserveBlankLines) {
      this.transformerConfig.trackExpansions = true;
    }
    this.customReadFile = options.readFile ?? ts.sys.readFile;
    this.fileNames = fileNames;

    // Create layered cache with dependency tracking
    this.cache = new TransformCache({ maxSize: options.maxCacheSize ?? 1000 });

    // Create disk cache if enabled
    if (options.diskCache) {
      const cacheDir =
        typeof options.diskCache === "string" ? options.diskCache : ".typesugar-cache/transforms";
      this.diskCache = new DiskTransformCache(cacheDir);
      if (this.verbose) {
        console.log(`[typesugar] Disk cache enabled at ${cacheDir}`);
      }
    }

    // Create virtual host that serves preprocessed content
    this.host = new VirtualCompilerHost({
      compilerOptions,
      extensions: this.extensions,
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
        const result: TransformResult = {
          original,
          code: diskCached.code,
          sourceMap,
          mapper: sourceMap
            ? createPositionMapper(sourceMap, original, diskCached.code)
            : new IdentityPositionMapper(),
          changed: diskCached.code !== original,
          diagnostics: [],
          dependencies,
        };
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

    // Get preprocessed content from host
    const preprocessStart = PROFILING_ENABLED ? performance.now() : 0;
    const preprocessed = this.host.getPreprocessedFile(normalizedFileName);
    const preprocessMs = PROFILING_ENABLED ? performance.now() - preprocessStart : 0;
    const preprocessMap = preprocessed?.map ?? null;
    const codeForTransform = preprocessed?.code ?? original;

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
      diagnostics,
      printMs,
      expansions,
    } = this.runMacroTransformer(sourceFile, codeForTransform);
    const transformerMs = PROFILING_ENABLED ? performance.now() - transformerStart : 0;

    // Compose source maps
    const composedMap = composeSourceMaps(preprocessMap, transformMap);

    // Create position mapper
    const mapper = createPositionMapper(composedMap, original, transformed);

    // Determine if file changed
    const changed = transformed !== original;

    const result: TransformResult = {
      original,
      code: transformed,
      sourceMap: composedMap,
      mapper,
      changed,
      diagnostics,
      dependencies,
      expansions,
    };

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

    // Invalidate this file and all files that depend on it
    this.cache.invalidate(normalizedFileName);

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

  /**
   * Full invalidation (e.g., tsconfig change)
   */
  invalidateAll(): void {
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

  /**
   * Check if a file should be transformed (based on extensions)
   */
  shouldTransform(fileName: string): boolean {
    // Skip node_modules and declaration files
    if (fileName.includes("node_modules")) return false;
    if (fileName.endsWith(".d.ts")) return false;

    // Skip build infrastructure packages (they don't use typesugar macros)
    if (
      /packages[\\/](transformer|core|macros|preprocessor|ts-plugin|oxc-engine)[\\/]src[\\/]/.test(
        fileName
      )
    ) {
      return false;
    }

    // Transform TS/TSX/JS/JSX and STS/STSX files
    return /\.(([tj]sx?)|sts|stsx)$/.test(fileName);
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Old program reference for incremental compilation.
   * Allows ts.createProgram to reuse unchanged ASTs.
   */
  private oldProgram: ts.Program | null = null;

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

  private getSourceFile(fileName: string, code: string): ts.SourceFile | undefined {
    // First try to get from program (for type information)
    const programSourceFile = this.program?.getSourceFile(fileName);

    if (programSourceFile) {
      // If preprocessed, create a new source file with the preprocessed content
      // but keep the connection to the program for type checking
      if (code !== this.customReadFile(fileName)) {
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

  /**
   * Decorator macro names that require the TypeScript transformer.
   * These use decorator syntax (@name) rather than JSDoc syntax.
   */
  private static readonly DECORATOR_MACROS = new Set([
    "derive",
    "deriving",
    "typeclass",
    "impl",
    "instance",
    "extension",
    "specialize",
    "reflect",
    "generic",
    "implicits",
    "operator",
    "operators",
  ]);

  /**
   * Quick check for type-aware features that require the TypeScript transformer.
   *
   * The oxc backend handles:
   * - Pure passthrough (no macros)
   * - @cfg macro
   * - staticAssert() macro
   * - __binop__ expansion (for |>, <|, ::)
   *
   * Everything else needs the TypeScript transformer. This function returns true
   * if ANY pattern is detected that oxc might not handle correctly.
   */
  private needsTypescriptTransformer(source: string): boolean {
    // 1. Decorator macros: @derive(Eq), @typeclass, etc.
    const decoratorPattern =
      /@(\w+)(?:\s*\(|\s*(?:class|interface|type|function|const|let|var|\n))/g;
    let match;
    while ((match = decoratorPattern.exec(source)) !== null) {
      if (TransformationPipeline.DECORATOR_MACROS.has(match[1])) {
        return true;
      }
    }

    // 2. HKT syntax: F<_>, Functor<F<_>>, etc.
    if (/<_>/.test(source)) {
      return true;
    }

    // 2b. @hkt JSDoc macro (Tier 3 _ marker on type aliases)
    if (/@hkt\b/.test(source)) {
      return true;
    }

    // 3. Implicit resolution: = implicit()
    if (/=\s*implicit\s*\(/.test(source)) {
      return true;
    }

    // 4. Extension methods: .specialize(
    if (/\.specialize\s*\(/.test(source)) {
      return true;
    }

    // 5. Typeclass-based operator patterns that need type info
    if (/(?:Eq|Ord|Numeric|Semigroup|Monoid|Functor|Monad)</.test(source)) {
      return true;
    }

    // 6. comptime blocks (need type evaluation)
    if (/comptime\s*[<({\[]/.test(source)) {
      return true;
    }

    // 7. summon() calls (need type resolution)
    if (/summon\s*[<(]/.test(source)) {
      return true;
    }

    // 8. typeInfo() calls (need type introspection)
    if (/typeInfo\s*[<(]/.test(source)) {
      return true;
    }

    // 9. Labeled block comprehensions (let:, seq:, par:, all:)
    if (/\b(let|seq|par|all):\s*\{/.test(source)) {
      return true;
    }

    return false;
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
    // Use TypeScript backend only if explicitly requested
    // (PEP-004 enabled source-based detection of type-aware features)
    if (this.options.backend === "typescript") {
      return this.runTypescriptTransformer(sourceFile, originalCode);
    }

    // Default: oxc backend (faster for syntax-only macros, auto-falls back to TS)
    // Quick check: if type-aware features are present, fall back to TS immediately
    if (this.needsTypescriptTransformer(originalCode)) {
      if (this.verbose) {
        console.log(
          `[typesugar] Fallback to TS transformer for ${sourceFile.fileName} (type-aware features detected)`
        );
      }
      return this.runTypescriptTransformer(sourceFile, originalCode);
    }

    const oxcResult = this.runOxcTransformer(sourceFile, originalCode);

    // If oxc backend signals fallback (e.g., JSDoc type-aware macros detected),
    // retry with the TypeScript transformer
    if (oxcResult.needsFallback) {
      if (this.verbose) {
        console.log(
          `[typesugar] Fallback to TS transformer for ${sourceFile.fileName} (type-aware macros detected)`
        );
      }
      return this.runTypescriptTransformer(sourceFile, originalCode);
    }

    // Return without the needsFallback/changed fields (not part of the interface)
    // Note: We intentionally keep oxc diagnostics even if they contain errors,
    // because syntax-only macros like staticAssert intentionally produce errors
    return {
      code: oxcResult.code,
      map: oxcResult.map,
      diagnostics: oxcResult.diagnostics,
      printMs: oxcResult.printMs,
      expansions: oxcResult.expansions,
    };
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
      // Use cached transformer factory - only create once per program
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

      profiler.start("ts.transform");
      const result = ts.transform(sourceFile, [this.cachedTransformerFactory]);
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

      result.dispose();

      profiler.start("printFile");
      const printStart = PROFILING_ENABLED ? performance.now() : 0;

      let transformed: string;
      if (this.options.preserveBlankLines) {
        // Surgical text replacement: only macro call sites change, everything
        // else (blank lines, comments, formatting) stays byte-for-byte identical.
        // Falls back to the printer if no tracked expansions (e.g., only AST-level
        // changes like import removal or extension rewrites).
        const surgical = globalExpansionTracker.generateExpandedCode(
          originalCode,
          sourceFile.fileName
        );
        if (surgical !== null) {
          transformed = surgical;
        } else {
          const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
          transformed = printer.printFile(transformedSourceFile);
        }
      } else {
        const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
        transformed = printer.printFile(transformedSourceFile);
      }

      const printMs = PROFILING_ENABLED ? performance.now() - printStart : 0;
      profiler.end("printFile");

      // Generate source map from expansion records
      const map = globalExpansionTracker.generateSourceMap(originalCode, sourceFile.fileName);

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

  /**
   * Run the oxc-native macro transformer.
   *
   * Uses the oxc engine for parsing, AST traversal, and code generation,
   * while delegating type-aware macro expansion to TypeScript callbacks.
   *
   * Returns `needsFallback: true` if type-aware macros are detected that
   * require the TypeScript transformer.
   */
  private runOxcTransformer(
    sourceFile: ts.SourceFile,
    originalCode: string
  ): {
    code: string;
    map: RawSourceMap | null;
    diagnostics: TransformDiagnostic[];
    printMs?: number;
    expansions?: ExpansionRecord[];
    needsFallback: boolean;
    changed: boolean;
  } {
    try {
      profiler.start("oxc.transform");
      const result = transformWithOxcBackend(
        originalCode,
        sourceFile.fileName,
        this.program!,
        sourceFile,
        { sourceMap: true }
      );
      profiler.end("oxc.transform");

      // Convert oxc diagnostics to TransformDiagnostic format
      // Filter out fallback info messages when fallback is happening
      const diagnostics: TransformDiagnostic[] = result.diagnostics
        .filter((d) => !(result.needsFallback && d.severity === "info"))
        .map((d) => ({
          file: sourceFile.fileName,
          start: 0,
          length: 0,
          message: d.message,
          severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
        }));

      // Parse source map from JSON string if present
      let map: RawSourceMap | null = null;
      if (result.map) {
        try {
          map = JSON.parse(result.map) as RawSourceMap;
        } catch {
          // Ignore invalid source map
        }
      }

      return {
        code: result.code,
        map,
        diagnostics,
        printMs: 0, // oxc handles print internally
        needsFallback: result.needsFallback,
        changed: result.changed,
      };
    } catch (error) {
      if (this.verbose) {
        console.error(`[typesugar] Oxc transform error for ${sourceFile.fileName}:`, error);
      }
      return {
        code: originalCode,
        map: null,
        diagnostics: [
          {
            file: sourceFile.fileName,
            start: 0,
            length: 0,
            message: `Oxc transform failed: ${error}`,
            severity: "error",
          },
        ],
        printMs: 0,
        needsFallback: false,
        changed: false,
      };
    }
  }

  private checkCache(fileName: string, contentHash: string): TransformResult | null {
    // Check if cache is valid with dependency validation
    const isValid = this.cache.isTransformedValid(fileName, contentHash, (dep) =>
      this.getContentHash(dep)
    );

    if (!isValid) return null;

    const entry = this.cache.getTransformed(fileName);
    return entry?.result ?? null;
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
        result.sourceMap
      );
    }
  }

  private getContentHash(fileName: string): string | undefined {
    // Check cache first
    const cached = this.contentHashes.get(fileName);
    if (cached) return cached;

    // Compute and cache
    const content = this.customReadFile(fileName);
    if (!content) return undefined;

    const hash = hashContent(content);
    this.contentHashes.set(fileName, hash);
    return hash;
  }

  /**
   * Extract dependencies from a source file
   */
  private extractDependencies(sourceFile: ts.SourceFile, containingFile: string): Set<string> {
    const dependencies = new Set<string>();
    const baseDir = path.dirname(containingFile);

    // Collect import declarations
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        const moduleSpecifier = statement.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          const modulePath = moduleSpecifier.text;

          // Skip external modules (node_modules)
          if (!modulePath.startsWith(".") && !modulePath.startsWith("/")) {
            continue;
          }

          // Resolve relative path
          const resolved = this.resolveModulePath(modulePath, baseDir);
          if (resolved) {
            dependencies.add(resolved);
          }
        }
      }

      // Also check dynamic imports
      if (ts.isExpressionStatement(statement)) {
        this.collectDynamicImports(statement, baseDir, dependencies);
      }
    }

    return dependencies;
  }

  /**
   * Resolve a module path to an absolute file path
   */
  private resolveModulePath(modulePath: string, baseDir: string): string | undefined {
    // Try common extensions
    const extensions = [".ts", ".tsx", ".js", ".jsx", ""];
    const basePath = path.resolve(baseDir, modulePath);

    for (const ext of extensions) {
      const candidate = basePath + ext;
      if (this.options.fileExists?.(candidate) ?? ts.sys.fileExists(candidate)) {
        return candidate;
      }

      // Try index file
      const indexCandidate = path.join(basePath, "index" + ext);
      if (this.options.fileExists?.(indexCandidate) ?? ts.sys.fileExists(indexCandidate)) {
        return indexCandidate;
      }
    }

    return undefined;
  }

  /**
   * Collect dynamic imports from an expression
   */
  private collectDynamicImports(node: ts.Node, baseDir: string, dependencies: Set<string>): void {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const modulePath = arg.text;
        if (modulePath.startsWith(".") || modulePath.startsWith("/")) {
          const resolved = this.resolveModulePath(modulePath, baseDir);
          if (resolved) {
            dependencies.add(resolved);
          }
        }
      }
    }

    // Recurse
    ts.forEachChild(node, (child) => this.collectDynamicImports(child, baseDir, dependencies));
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

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath)
  );

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
  options?: { fileName?: string } & PipelineOptions
): TransformResult {
  const fileName = path.resolve(options?.fileName ?? "input.ts");
  const pipeline = new TransformationPipeline({ target: ts.ScriptTarget.Latest }, [fileName], {
    ...options,
    readFile: (f) =>
      f === fileName || f === (options?.fileName ?? "input.ts") ? code : ts.sys.readFile(f),
    fileExists: (f) =>
      f === fileName || f === (options?.fileName ?? "input.ts") || ts.sys.fileExists(f),
  });
  return pipeline.transform(fileName);
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
