/**
 * VirtualCompilerHost - A ts.CompilerHost that serves preprocessed content
 *
 * This enables TypeScript to build a Program from valid TypeScript even when
 * the original source contains custom syntax (|>, ::, F<_>).
 */

import * as ts from "typescript";
import { preprocess, type RawSourceMap } from "@typesugar/preprocessor";

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
  /** Syntax extensions to enable (defaults to all) */
  extensions?: ("hkt" | "pipeline" | "cons" | "decorator-rewrite")[];
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
  private extensions: string[];
  private customReadFile: (fileName: string) => string | undefined;
  private customFileExists: (fileName: string) => boolean;

  constructor(private options: VirtualCompilerHostOptions) {
    this.baseHost = options.baseHost ?? ts.createCompilerHost(options.compilerOptions);
    this.extensions = options.extensions ?? ["hkt", "pipeline", "cons", "decorator-rewrite"];
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

    // Only preprocess TypeScript files
    if (!this.shouldPreprocess(fileName)) {
      return undefined;
    }

    const result = preprocess(content, {
      fileName,
      extensions: this.extensions,
    });

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

    return undefined;
  }

  /**
   * Check if a file should be preprocessed
   */
  private shouldPreprocess(fileName: string): boolean {
    // Skip node_modules and declaration files
    if (fileName.includes("node_modules")) return false;
    if (fileName.endsWith(".d.ts")) return false;

    // Only preprocess TS/TSX files
    return /\.[tj]sx?$/.test(fileName);
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

  writeFile(
    fileName: string,
    data: string,
    writeByteOrderMark: boolean,
    onError?: (message: string) => void,
    sourceFiles?: readonly ts.SourceFile[]
  ): void {
    this.baseHost.writeFile(fileName, data, writeByteOrderMark, onError, sourceFiles);
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
