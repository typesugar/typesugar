/**
 * Browser-Compatible Transformation Pipeline
 *
 * This module provides a simplified transformation pipeline that works
 * entirely in the browser without Node.js APIs.
 *
 * Key differences from the full transformer:
 * - Uses TypeScript backend only (no oxc)
 * - In-memory LRU cache (no disk cache)
 * - fs-dependent macros (includeStr, includeJson) report errors
 * - No file system access
 */

import * as ts from "typescript";
import { preprocess, type RawSourceMap, type PreprocessResult } from "@typesugar/preprocessor";
import { globalExpansionTracker, globalRegistry, createMacroContext } from "@typesugar/core";
import { BrowserTransformCache, hashContent } from "./cache.js";

export interface TransformDiagnostic {
  file: string;
  start: number;
  length: number;
  message: string;
  severity: "error" | "warning";
  code?: number;
}

export interface TransformResult {
  original: string;
  code: string;
  sourceMap: RawSourceMap | null;
  changed: boolean;
  diagnostics: TransformDiagnostic[];
  preprocessed?: boolean;
}

export interface BrowserTransformOptions {
  fileName?: string;
  verbose?: boolean;
  cacheSize?: number;
}

let transformCache: BrowserTransformCache | null = null;

function getCache(maxSize: number = 100): BrowserTransformCache {
  if (!transformCache) {
    transformCache = new BrowserTransformCache(maxSize);
  }
  return transformCache;
}

export function clearCache(): void {
  transformCache?.clear();
}

export function getCacheStats(): string {
  return transformCache?.getStatsString() ?? "Cache not initialized";
}

function isSugaredTypeScriptFile(fileName: string): boolean {
  return /\.stsx?$/i.test(fileName);
}

export function preprocessCode(
  code: string,
  options: { fileName?: string } = {}
): PreprocessResult {
  const fileName = options.fileName ?? "input.sts";
  return preprocess(code, { fileName });
}

export function transform(code: string, options: BrowserTransformOptions = {}): TransformResult {
  const fileName = options.fileName ?? "input.ts";
  const verbose = options.verbose ?? false;
  const cache = getCache(options.cacheSize);
  const contentHash = hashContent(code);

  const cached = cache.get(fileName, contentHash);
  if (cached) {
    if (verbose) {
      console.log(`[playground] Cache hit for ${fileName}`);
    }
    return {
      original: code,
      code: cached.code,
      sourceMap: cached.sourceMap ? JSON.parse(cached.sourceMap) : null,
      changed: cached.changed,
      diagnostics: [],
    };
  }

  let preprocessedCode = code;
  let preprocessMap: RawSourceMap | null = null;
  let wasPreprocessed = false;

  if (isSugaredTypeScriptFile(fileName)) {
    try {
      const result = preprocess(code, { fileName });
      if (result.changed) {
        preprocessedCode = result.code;
        preprocessMap = result.map;
        wasPreprocessed = true;
        if (verbose) {
          console.log(`[playground] Preprocessed ${fileName}`);
        }
      }
    } catch (e) {
      return {
        original: code,
        code,
        sourceMap: null,
        changed: false,
        diagnostics: [
          {
            file: fileName,
            start: 0,
            length: 0,
            message: `Preprocessing failed: ${e}`,
            severity: "error",
          },
        ],
      };
    }
  }

  try {
    const result = runMacroTransformer(preprocessedCode, fileName, verbose);

    const cacheEntry = {
      code: result.code,
      sourceMap: result.sourceMap ? JSON.stringify(result.sourceMap) : null,
      changed: result.changed,
    };
    cache.set(fileName, contentHash, cacheEntry);

    return {
      ...result,
      original: code,
      preprocessed: wasPreprocessed,
      sourceMap: composeSourceMaps(preprocessMap, result.sourceMap),
    };
  } catch (e) {
    return {
      original: code,
      code: preprocessedCode,
      sourceMap: preprocessMap,
      changed: wasPreprocessed,
      diagnostics: [
        {
          file: fileName,
          start: 0,
          length: 0,
          message: `Transform failed: ${e}`,
          severity: "error",
        },
      ],
    };
  }
}

function runMacroTransformer(
  code: string,
  fileName: string,
  verbose: boolean
): {
  code: string;
  sourceMap: RawSourceMap | null;
  changed: boolean;
  diagnostics: TransformDiagnostic[];
} {
  const scriptKind =
    fileName.endsWith(".tsx") || fileName.endsWith(".stsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, scriptKind);

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
  };

  const host = createBrowserCompilerHost(compilerOptions, fileName, code);
  const program = ts.createProgram([fileName], compilerOptions, host);

  globalExpansionTracker.clear();

  const transformerFactory = createBrowserTransformerFactory(program, verbose);

  const transformResult = ts.transform(sourceFile, [transformerFactory]);

  if (transformResult.transformed.length === 0) {
    transformResult.dispose();
    return { code, sourceMap: null, changed: false, diagnostics: [] };
  }

  const transformedSourceFile = transformResult.transformed[0];

  const diagnostics: TransformDiagnostic[] = (transformResult.diagnostics ?? []).map((d) => {
    const message = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
    return {
      file: d.file?.fileName ?? fileName,
      start: d.start ?? 0,
      length: d.length ?? 0,
      message,
      severity:
        d.category === ts.DiagnosticCategory.Error ? ("error" as const) : ("warning" as const),
      code: d.code,
    };
  });

  if (transformedSourceFile === sourceFile) {
    transformResult.dispose();
    return { code, sourceMap: null, changed: false, diagnostics };
  }

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const transformed = printer.printFile(transformedSourceFile);

  transformResult.dispose();

  const sourceMap = globalExpansionTracker.generateSourceMap(code, fileName);
  globalExpansionTracker.clear();

  return {
    code: transformed,
    sourceMap,
    changed: transformed !== code,
    diagnostics,
  };
}

function createBrowserCompilerHost(
  options: ts.CompilerOptions,
  fileName: string,
  code: string
): ts.CompilerHost {
  const defaultHost = {
    getSourceFile(
      requestedFileName: string,
      languageVersion: ts.ScriptTarget
    ): ts.SourceFile | undefined {
      if (requestedFileName === fileName) {
        return ts.createSourceFile(requestedFileName, code, languageVersion, true);
      }
      if (requestedFileName.includes("lib.") && requestedFileName.endsWith(".d.ts")) {
        return ts.createSourceFile(requestedFileName, "", languageVersion, true);
      }
      return undefined;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getDirectories: () => [],
    fileExists: (f: string) => f === fileName,
    readFile: (f: string) => (f === fileName ? code : undefined),
    getCanonicalFileName: (f: string) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };

  return defaultHost;
}

function createBrowserTransformerFactory(
  program: ts.Program,
  verbose: boolean
): ts.TransformerFactory<ts.SourceFile> {
  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      const visitor = (node: ts.Node): ts.Node | ts.Node[] => {
        // Handle attribute macros (decorators like @tailrec, @derive, @operators)
        if (hasDecorators(node)) {
          const transformed = tryExpandAttributeMacros(
            node as ts.HasDecorators,
            program,
            sourceFile,
            context,
            verbose
          );
          if (transformed !== node) {
            // If we got an array, visit each child and return
            if (Array.isArray(transformed)) {
              return transformed.map((n) => ts.visitEachChild(n, visitor, context));
            }
            return ts.visitEachChild(transformed, visitor, context);
          }
        }

        // Handle expression macros (call expressions like staticAssert(), comptime())
        if (ts.isCallExpression(node)) {
          const transformed = tryExpandMacroCall(node, program, sourceFile, context, verbose);
          if (transformed !== node) {
            return transformed;
          }
        }

        return ts.visitEachChild(node, visitor, context);
      };

      return ts.visitNode(sourceFile, visitor) as ts.SourceFile;
    };
  };
}

function hasDecorators(node: ts.Node): node is ts.HasDecorators {
  return (
    ts.canHaveDecorators(node) &&
    ts.getDecorators(node) !== undefined &&
    ts.getDecorators(node)!.length > 0
  );
}

function isDeclarationNode(node: ts.Node): node is ts.Declaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  );
}

function tryExpandAttributeMacros(
  node: ts.HasDecorators,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  context: ts.TransformationContext,
  verbose: boolean
): ts.Node | ts.Node[] {
  const decorators = ts.getDecorators(node);
  if (!decorators || decorators.length === 0) {
    return node;
  }

  let currentNode: ts.Node | ts.Node[] = node;

  for (const decorator of decorators) {
    // Get decorator name
    let macroName: string | undefined;
    let args: ts.Expression[] = [];

    if (ts.isIdentifier(decorator.expression)) {
      macroName = decorator.expression.text;
    } else if (ts.isCallExpression(decorator.expression)) {
      if (ts.isIdentifier(decorator.expression.expression)) {
        macroName = decorator.expression.expression.text;
        args = Array.from(decorator.expression.arguments);
      }
    }

    if (!macroName) continue;

    // Look up the attribute macro
    const macro = globalRegistry.getAttribute(macroName);
    if (!macro) continue;

    if (verbose) {
      console.log(`[playground] Expanding attribute macro: @${macroName}`);
    }

    // Get the current target (may have been transformed by previous decorator)
    const target = Array.isArray(currentNode) ? currentNode[0] : currentNode;
    if (!isDeclarationNode(target)) continue;

    const ctx = createMacroContext(program, sourceFile, context);

    try {
      const expanded = macro.expand(ctx, decorator, target as ts.Declaration, args);
      currentNode = expanded;
    } catch (e) {
      if (verbose) {
        console.warn(`[playground] Attribute macro @${macroName} failed: ${e}`);
      }
    }
  }

  return currentNode;
}

function tryExpandMacroCall(
  node: ts.CallExpression,
  program: ts.Program,
  sourceFile: ts.SourceFile,
  context: ts.TransformationContext,
  verbose: boolean
): ts.Node {
  const callee = node.expression;
  let macroName: string | undefined;

  if (ts.isIdentifier(callee)) {
    macroName = callee.text;
  } else if (ts.isPropertyAccessExpression(callee)) {
    macroName = callee.name.text;
  }

  if (!macroName) {
    return node;
  }

  const macro = globalRegistry.getExpression(macroName);
  if (!macro) {
    return node;
  }

  if (verbose) {
    console.log(`[playground] Expanding macro: ${macroName}`);
  }

  const ctx = createMacroContext(program, sourceFile, context);

  try {
    const args = Array.from(node.arguments);
    const expanded = macro.expand(ctx, node, args);
    return expanded;
  } catch (e) {
    if (verbose) {
      console.warn(`[playground] Macro ${macroName} failed: ${e}`);
    }
    return node;
  }
}

function composeSourceMaps(
  first: RawSourceMap | null,
  second: RawSourceMap | null
): RawSourceMap | null {
  if (!first) return second;
  if (!second) return first;
  return second;
}

export { preprocess, preprocessCode as preprocessOnly, type PreprocessResult, type RawSourceMap };
