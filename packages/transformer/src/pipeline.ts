/**
 * TransformationPipeline - Unified transformation orchestration
 *
 * This is the single source of truth for all typesugar transformation.
 * Used by: unplugin-typesugar, ts-patch, ts-plugin.
 */

import * as ts from "typescript";
import * as path from "path";
import { globalExpansionTracker } from "@typesugar/core";
import { type RawSourceMap } from "@typesugar/preprocessor";
import { VirtualCompilerHost, type PreprocessedFile } from "./virtual-host.js";
import { composeSourceMaps } from "./source-map-utils.js";
import {
  createPositionMapper,
  IdentityPositionMapper,
  type PositionMapper,
} from "./position-mapper.js";
import { TransformCache, hashContent } from "./cache.js";
import macroTransformerFactory, { type MacroTransformerConfig } from "./index.js";

/**
 * Diagnostic from macro expansion
 */
export interface TransformDiagnostic {
  file: string;
  start: number;
  length: number;
  message: string;
  severity: "error" | "warning";
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
}

/**
 * Options for the transformation pipeline
 */
export interface PipelineOptions {
  /** Enable verbose logging */
  verbose?: boolean;
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
export class TransformationPipeline {
  private host: VirtualCompilerHost;
  private program: ts.Program | null = null;
  private cache: TransformCache;
  private verbose: boolean;
  private extensions: ("hkt" | "pipeline" | "cons" | "decorator-rewrite")[];
  private transformerConfig: MacroTransformerConfig;
  private customReadFile: (fileName: string) => string | undefined;
  private fileNames: string[];
  /** Content hash cache for dependency validation */
  private contentHashes = new Map<string, string>();
  /** Cached transformer factory - reused across all file transforms */
  private cachedTransformerFactory: ts.TransformerFactory<ts.SourceFile> | null = null;

  constructor(
    private compilerOptions: ts.CompilerOptions,
    fileNames: string[],
    private options: PipelineOptions = {}
  ) {
    this.verbose = options.verbose ?? false;
    this.extensions = options.extensions ?? ["hkt", "pipeline", "cons", "decorator-rewrite"];
    this.transformerConfig = options.transformerConfig ?? { verbose: this.verbose };
    this.customReadFile = options.readFile ?? ts.sys.readFile;
    this.fileNames = fileNames;

    // Create layered cache with dependency tracking
    this.cache = new TransformCache({ maxSize: options.maxCacheSize ?? 1000 });

    // Create virtual host that serves preprocessed content
    this.host = new VirtualCompilerHost({
      compilerOptions,
      extensions: this.extensions,
      readFile: this.customReadFile,
      fileExists: options.fileExists,
    });
  }

  /**
   * Transform a single file
   */
  transform(fileName: string): TransformResult {
    const normalizedFileName = path.normalize(fileName);

    // Read original content
    const original = this.customReadFile(normalizedFileName);
    if (!original) {
      return this.createEmptyResult(normalizedFileName);
    }

    // Update content hash
    const contentHash = hashContent(original);
    this.contentHashes.set(normalizedFileName, contentHash);

    // Check cache with dependency validation
    const cached = this.checkCache(normalizedFileName, contentHash);
    if (cached) {
      if (this.verbose) {
        console.log(`[typesugar] Cache hit for ${normalizedFileName}`);
      }
      return cached;
    }

    // Ensure program exists (lazy creation)
    this.ensureProgram();

    // Get preprocessed content from host
    const preprocessed = this.host.getPreprocessedFile(normalizedFileName);
    const preprocessMap = preprocessed?.map ?? null;
    const codeForTransform = preprocessed?.code ?? original;

    // Get or create source file
    const sourceFile = this.getSourceFile(normalizedFileName, codeForTransform);
    if (!sourceFile) {
      return this.createEmptyResult(normalizedFileName);
    }

    // Extract dependencies from source file
    const dependencies = this.extractDependencies(sourceFile, normalizedFileName);

    // Run macro transformer
    const {
      code: transformed,
      map: transformMap,
      diagnostics,
    } = this.runMacroTransformer(sourceFile, codeForTransform);

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
    };

    // Cache the result with dependencies
    this.cacheResult(normalizedFileName, result, contentHash, dependencies);

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

    // Only transform TS/TSX/JS/JSX files
    return /\.[tj]sx?$/.test(fileName);
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  private ensureProgram(): void {
    if (!this.program) {
      if (this.verbose) {
        console.log(`[typesugar] Creating TypeScript program with ${this.fileNames.length} files`);
      }
      this.program = ts.createProgram(this.fileNames, this.compilerOptions, this.host);
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

  private runMacroTransformer(
    sourceFile: ts.SourceFile,
    originalCode: string
  ): { code: string; map: RawSourceMap | null; diagnostics: TransformDiagnostic[] } {
    // Clear expansion tracker before transformation
    globalExpansionTracker.clear();

    try {
      // Use cached transformer factory - only create once per program
      if (!this.cachedTransformerFactory) {
        this.cachedTransformerFactory = macroTransformerFactory(
          this.program!,
          this.transformerConfig
        );
      }

      const result = ts.transform(sourceFile, [this.cachedTransformerFactory]);

      if (result.transformed.length === 0) {
        result.dispose();
        return { code: originalCode, map: null, diagnostics: [] };
      }

      const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
      const transformed = printer.printFile(result.transformed[0]);

      // Collect diagnostics from the transformation
      const diagnostics: TransformDiagnostic[] = (result.diagnostics ?? []).map((d) => ({
        file: d.file?.fileName ?? sourceFile.fileName,
        start: d.start ?? 0,
        length: d.length ?? 0,
        message: typeof d.messageText === "string" ? d.messageText : d.messageText.messageText,
        severity:
          d.category === ts.DiagnosticCategory.Error ? ("error" as const) : ("warning" as const),
      }));

      result.dispose();

      // Generate source map from expansion records
      const map = globalExpansionTracker.generateSourceMap(originalCode, sourceFile.fileName);

      // Clear tracker after generating the map
      globalExpansionTracker.clear();

      return {
        code: transformed,
        map,
        diagnostics,
      };
    } catch (error) {
      if (this.verbose) {
        console.error(`[typesugar] Transform error for ${sourceFile.fileName}:`, error);
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
    dependencies: Set<string>
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
