/**
 * VirtualCompilerHost - A ts.CompilerHost that serves preprocessed content
 *
 * This enables TypeScript to build a Program from valid TypeScript even when
 * the original source uses HKT type-parameter syntax (`F<A>` for a type
 * parameter `F`), which is rewritten to `Kind<F, A>` before the type checker
 * sees it.
 *
 * Key responsibilities:
 * 1. Rewrite HKT type references in .ts/.tsx files (serve valid TypeScript to
 *    the type checker)
 * 2. Module resolution for relative imports
 */

import * as ts from "typescript";
import * as path from "path";
import type { RawSourceMap } from "@typesugar/core";
import { hasHKTPatterns, rewriteHKTTypeReferences } from "./hkt-rewriter.js";

/**
 * Cached preprocessed file content
 */
export interface PreprocessedFile {
  /** The preprocessed code (valid TypeScript) */
  code: string;
  /** Source map from preprocessing */
  map: RawSourceMap | null;
  /** Original source content */
  original: string;
  /** Hash of original content for cache invalidation */
  hash: string;
}

/**
 * Options for creating a VirtualCompilerHost
 */
export interface VirtualCompilerHostOptions {
  /** Compiler options for TypeScript */
  compilerOptions: ts.CompilerOptions;
  /** Base compiler host to delegate to (created if not provided) */
  baseHost?: ts.CompilerHost;
  /** Custom file reader (defaults to ts.sys.readFile) */
  readFile?: (fileName: string) => string | undefined;
  /** File existence checker (defaults to ts.sys.fileExists) */
  fileExists?: (fileName: string) => boolean;
}

/**
 * Simple hash function for cache invalidation
 */
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * A CompilerHost wrapper that serves preprocessed content to TypeScript.
 *
 * This is the key abstraction that enables type-aware transformation:
 * 1. When TypeScript requests a source file, we preprocess it first
 * 2. TypeScript sees valid TypeScript (no custom syntax)
 * 3. The ts.Program and TypeChecker work correctly
 * 4. We cache preprocessing results for performance
 */
export class VirtualCompilerHost implements ts.CompilerHost {
  private preprocessedFiles = new Map<string, PreprocessedFile>();
  private baseHost: ts.CompilerHost;
  private customReadFile: (fileName: string) => string | undefined;
  private customFileExists: (fileName: string) => boolean;

  constructor(private options: VirtualCompilerHostOptions) {
    this.baseHost = options.baseHost ?? ts.createCompilerHost(options.compilerOptions);
    this.customReadFile = options.readFile ?? ts.sys.readFile;
    this.customFileExists = options.fileExists ?? ts.sys.fileExists;
  }

  /**
   * Get a preprocessed file from cache or preprocess it on demand
   */
  getPreprocessedFile(fileName: string): PreprocessedFile | undefined {
    // Check cache first
    const cached = this.preprocessedFiles.get(fileName);
    if (cached) {
      // Validate cache by checking if content changed
      const currentContent = this.customReadFile(fileName);
      if (currentContent && hashContent(currentContent) === cached.hash) {
        return cached;
      }
      // Cache invalid, remove it
      this.preprocessedFiles.delete(fileName);
    }

    // Read and preprocess
    const content = this.customReadFile(fileName);
    if (!content) return undefined;

    // .ts/.tsx → HKT rewrite only (F<A> → Kind<F, A>)
    if (this.shouldRewriteHKT(fileName) && hasHKTPatterns(content)) {
      const result = rewriteHKTTypeReferences(content, fileName);

      if (result.changed) {
        const preprocessed: PreprocessedFile = {
          code: result.code,
          map: result.map,
          original: content,
          hash: hashContent(content),
        };
        this.preprocessedFiles.set(fileName, preprocessed);
        return preprocessed;
      }
    }

    return undefined;
  }

  /**
   * Check if a file should be checked for HKT type reference rewriting.
   *
   * Only .ts/.tsx files are candidates.
   */
  private shouldRewriteHKT(fileName: string): boolean {
    if (fileName.includes("node_modules")) return false;
    if (fileName.endsWith(".d.ts")) return false;
    return /\.tsx?$/.test(fileName);
  }

  // ---------------------------------------------------------------------------
  // ts.CompilerHost implementation
  // ---------------------------------------------------------------------------

  getSourceFile(
    fileName: string,
    languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
    onError?: (message: string) => void,
    shouldCreateNewSourceFile?: boolean
  ): ts.SourceFile | undefined {
    // Check if we have preprocessed content
    const preprocessed = this.getPreprocessedFile(fileName);

    if (preprocessed) {
      // Create source file from preprocessed content
      const languageVersion =
        typeof languageVersionOrOptions === "number"
          ? languageVersionOrOptions
          : languageVersionOrOptions.languageVersion;

      return ts.createSourceFile(
        fileName,
        preprocessed.code,
        languageVersion,
        true // setParentNodes
      );
    }

    // For virtual files served by customReadFile that don't need preprocessing,
    // the base host can't find them on disk. Create from customReadFile content.
    const customContent = this.customReadFile(fileName);
    if (customContent !== undefined) {
      const languageVersion =
        typeof languageVersionOrOptions === "number"
          ? languageVersionOrOptions
          : languageVersionOrOptions.languageVersion;
      return ts.createSourceFile(fileName, customContent, languageVersion, true);
    }

    // Fall back to base host for real filesystem files
    return this.baseHost.getSourceFile(
      fileName,
      languageVersionOrOptions,
      onError,
      shouldCreateNewSourceFile
    );
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return this.baseHost.getDefaultLibFileName(options);
  }

  getCurrentDirectory(): string {
    return this.baseHost.getCurrentDirectory();
  }

  getCanonicalFileName(fileName: string): string {
    return this.baseHost.getCanonicalFileName(fileName);
  }

  useCaseSensitiveFileNames(): boolean {
    return this.baseHost.useCaseSensitiveFileNames();
  }

  getNewLine(): string {
    return this.baseHost.getNewLine();
  }

  fileExists(fileName: string): boolean {
    return this.customFileExists(fileName);
  }

  readFile(fileName: string): string | undefined {
    // Return preprocessed content if available
    const preprocessed = this.getPreprocessedFile(fileName);
    if (preprocessed) {
      return preprocessed.code;
    }
    return this.customReadFile(fileName);
  }

  // Optional methods delegated to base host
  getDirectories?(path: string): string[] {
    return this.baseHost.getDirectories?.(path) ?? [];
  }

  realpath?(path: string): string {
    return this.baseHost.realpath?.(path) ?? path;
  }

  trace?(s: string): void {
    this.baseHost.trace?.(s);
  }

  directoryExists?(directoryName: string): boolean {
    return this.baseHost.directoryExists?.(directoryName) ?? true;
  }

  getEnvironmentVariable?(name: string): string | undefined {
    return this.baseHost.getEnvironmentVariable?.(name);
  }

  // ---------------------------------------------------------------------------
  // Module resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve module names.
   *
   * Resolution order:
   * 1. Standard TypeScript extensions (.ts, .tsx, .d.ts, .js, .jsx)
   * 2. Index files in directories
   */
  resolveModuleNames(
    moduleNames: string[],
    containingFile: string,
    _reusedNames: string[] | undefined,
    redirectedReference: ts.ResolvedProjectReference | undefined,
    options: ts.CompilerOptions,
    _containingSourceFile?: ts.SourceFile
  ): (ts.ResolvedModule | undefined)[] {
    return moduleNames.map((moduleName) => {
      // For relative imports, do explicit resolution with our file system
      if (moduleName.startsWith(".") || moduleName.startsWith("/")) {
        const baseDir = path.dirname(containingFile);
        const resolved = this.resolveRelativeModule(moduleName, baseDir);
        if (resolved) {
          return resolved;
        }
      }

      // For non-relative imports (node_modules), use TypeScript's default resolution
      const result = ts.resolveModuleName(
        moduleName,
        containingFile,
        options,
        {
          fileExists: (f) => this.fileExists(f),
          readFile: (f) => this.readFile(f),
          directoryExists: (d) => this.directoryExists?.(d) ?? true,
          getCurrentDirectory: () => this.getCurrentDirectory(),
          getDirectories: (p) => this.getDirectories?.(p) ?? [],
          realpath: (p) => this.realpath?.(p) ?? p,
        },
        undefined,
        redirectedReference
      );

      return result.resolvedModule;
    });
  }

  /**
   * Resolve a relative module path to a file.
   *
   * Resolution order:
   * 1. .ts, .tsx (standard TypeScript)
   * 2. .d.ts (declaration files)
   * 3. .js, .jsx (JavaScript)
   * 4. index files in directories
   */
  private resolveRelativeModule(
    modulePath: string,
    baseDir: string
  ): ts.ResolvedModule | undefined {
    const basePath = path.resolve(baseDir, modulePath);

    // NodeNext-style specifiers carry a JS extension (e.g. `./data/option.js`).
    // For type resolution, the corresponding declaration/source must win over the
    // emitted `.js` itself — otherwise we'd load the typeless JavaScript and the
    // imported types collapse to `any`. (This matters for de-bundled library .d.ts
    // that import siblings with explicit `.js` extensions — PEP-050.)
    const jsExt = /\.(js|mjs|cjs)$/.exec(basePath);
    if (jsExt) {
      const withoutExt = basePath.slice(0, -jsExt[0].length);
      const typeExts = [".d.ts", ".ts", ".tsx", ".d.mts", ".mts", ".d.cts", ".cts"];
      for (const ext of typeExts) {
        const candidate = withoutExt + ext;
        if (this.customFileExists(candidate)) {
          return { resolvedFileName: candidate, isExternalLibraryImport: false };
        }
      }
    }

    // Extension order: standard TS first, then declarations, then JS
    const extensions = [".ts", ".tsx", ".d.ts", ".js", ".jsx"];

    // Try direct file with extensions
    for (const ext of extensions) {
      const candidate = basePath + ext;
      if (this.customFileExists(candidate)) {
        return {
          resolvedFileName: candidate,
          isExternalLibraryImport: false,
        };
      }
    }

    // Try index files in directory
    for (const ext of extensions) {
      const indexCandidate = path.join(basePath, "index" + ext);
      if (this.customFileExists(indexCandidate)) {
        return {
          resolvedFileName: indexCandidate,
          isExternalLibraryImport: false,
        };
      }
    }

    // Try as-is (might be a directory with package.json or exact file)
    if (this.customFileExists(basePath)) {
      return {
        resolvedFileName: basePath,
        isExternalLibraryImport: false,
      };
    }

    return undefined;
  }

  writeFile(
    fileName: string,
    data: string,
    writeByteOrderMark: boolean,
    onError?: (message: string) => void,
    sourceFiles?: readonly ts.SourceFile[]
  ): void {
    this.baseHost.writeFile(fileName, data, writeByteOrderMark, onError, sourceFiles);
  }

  // ---------------------------------------------------------------------------
  // Cache management
  // ---------------------------------------------------------------------------

  /**
   * Invalidate cache for a specific file
   */
  invalidate(fileName: string): void {
    this.preprocessedFiles.delete(fileName);
  }

  /**
   * Invalidate all cached files
   */
  invalidateAll(): void {
    this.preprocessedFiles.clear();
  }

  /**
   * Get all currently cached file names
   */
  getCachedFileNames(): string[] {
    return Array.from(this.preprocessedFiles.keys());
  }

  /**
   * Check if a file has been preprocessed
   */
  hasPreprocessed(fileName: string): boolean {
    return this.preprocessedFiles.has(fileName);
  }

  /**
   * Get the original content for a preprocessed file
   */
  getOriginalContent(fileName: string): string | undefined {
    return this.preprocessedFiles.get(fileName)?.original;
  }

  /**
   * Get the source map for a preprocessed file
   */
  getSourceMap(fileName: string): RawSourceMap | null | undefined {
    return this.preprocessedFiles.get(fileName)?.map;
  }
}
