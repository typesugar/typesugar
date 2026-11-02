/**
 * Browser-Compatible Transform Function
 *
 * This module provides a simple transformCode() function that runs
 * the macro transformer on a source code string without any file system access.
 *
 * Key features:
 * - Creates an in-memory TypeScript program
 * - No Node.js dependencies (no fs, path, or ts.sys)
 * - Works in any JavaScript environment (browser, Node, Deno, etc.)
 */

import * as ts from "typescript";
import { MacroTransformer } from "./transformer.js";
import {
  createPositionMapper,
  IdentityPositionMapper,
  type PositionMapper,
} from "./position-mapper.js";
import type { TransformDiagnostic, TransformResult } from "./types.js";
import {
  MacroContextImpl,
  globalExpansionTracker,
  HygieneContext,
  scanImportsForScope,
  globalResolutionScope,
  assertSupportedTypeScript,
  type RawSourceMap,
  opaqueTypesAsUnderlying,
} from "@typesugar/core";

/**
 * Options for transformCode()
 */
export interface TransformCodeOptions {
  /**
   * File name for diagnostics and source maps.
   * Defaults to "input.ts" or "input.tsx" based on content heuristics.
   */
  fileName?: string;

  /**
   * Enable verbose logging of macro expansion.
   */
  verbose?: boolean;

  /**
   * Optional: provide a custom TypeScript program.
   * If provided, the code string must match the content of the file in the program.
   * Use this for advanced scenarios where you need type information from
   * additional source files or custom compiler options.
   */
  program?: ts.Program;

  /**
   * Optional: provide a custom compiler host.
   * Only used if no program is provided.
   */
  compilerHost?: ts.CompilerHost;

  /**
   * Compiler options for the TypeScript program.
   * Only used if no program is provided.
   */
  compilerOptions?: ts.CompilerOptions;

  /**
   * Enable expansion tracking for detailed source maps.
   */
  trackExpansions?: boolean;

  /**
   * Typecheck the transformer's output and report any TypeScript errors
   * as diagnostics with severity "warning".
   *
   * Use this to verify that macro expansion produces valid TypeScript.
   */
  strictOutput?: boolean;
}

/**
 * Result of transformCode()
 *
 * Extends TransformResult with additional convenience fields.
 */
export interface TransformCodeResult extends TransformResult {
  /**
   * Whether any macros were expanded.
   */
  changed: boolean;
}

/**
 * Default compiler options for in-memory programs.
 *
 * These are designed to be permissive and compatible with most code:
 * - Latest ECMAScript target
 * - ESM modules
 * - Strict mode disabled (don't want type errors to block transformation)
 * - Skip lib check (we don't have lib files in memory)
 */
const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
  strict: false,
  noImplicitAny: false,
  strictNullChecks: false,
};

/**
 * Create an in-memory compiler host that serves a single file.
 *
 * This host:
 * - Returns the provided code for the specified file name
 * - Returns empty content for lib.d.ts files (they don't exist in browser)
 * - Implements all required CompilerHost methods without file system access
 */
function createInMemoryCompilerHost(
  code: string,
  fileName: string,
  options: ts.CompilerOptions
): ts.CompilerHost {
  const scriptKind = getScriptKind(fileName);

  return {
    getSourceFile(
      requestedFileName: string,
      languageVersion: ts.ScriptTarget
    ): ts.SourceFile | undefined {
      if (requestedFileName === fileName) {
        return ts.createSourceFile(requestedFileName, code, languageVersion, true, scriptKind);
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
}

/**
 * Get the TypeScript script kind from a file name.
 */
function getScriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (fileName.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (fileName.endsWith(".js") || fileName.endsWith(".mjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * Infer a default file name based on code content.
 */
function inferFileName(code: string): string {
  if (/<[A-Z]|<\/|<[a-z]+\s/.test(code)) {
    return "input.tsx";
  }
  return "input.ts";
}

/**
 * Transform TypeScript/JavaScript code with typesugar macro expansion.
 *
 * This is the main entry point for browser-compatible transformation.
 * It creates an in-memory TypeScript program and runs the MacroTransformer.
 *
 * @example
 * ```typescript
 * import { transformCode } from "@typesugar/transformer-core";
 *
 * const result = transformCode(`
 *   import { staticAssert } from "@typesugar/macros";
 *   staticAssert<true>();
 * `);
 *
 * console.log(result.code); // Macro expanded
 * console.log(result.changed); // true
 * ```
 *
 * @param code - The source code to transform
 * @param options - Optional configuration
 * @returns The transformation result with code, source map, and diagnostics
 */
export function transformCode(
  code: string,
  options: TransformCodeOptions = {}
): TransformCodeResult {
  // PEP-060 item 1: reject TypeScript 7 (no JS compiler API) with one clear
  // message before the first ts.* access below. Memoized; costs nothing after.
  assertSupportedTypeScript(ts);
  const fileName = options.fileName ?? inferFileName(code);
  const verbose = options.verbose ?? false;
  const trackExpansions = options.trackExpansions ?? false;
  const compilerOptions = {
    ...DEFAULT_COMPILER_OPTIONS,
    ...options.compilerOptions,
  };

  let program: ts.Program;
  let sourceFile: ts.SourceFile | undefined;

  if (options.program) {
    program = options.program;
    sourceFile = program.getSourceFile(fileName);
    if (!sourceFile) {
      return createErrorResult(code, fileName, `File ${fileName} not found in provided program`);
    }
  } else {
    const host =
      options.compilerHost ?? createInMemoryCompilerHost(code, fileName, compilerOptions);
    program = ts.createProgram([fileName], compilerOptions, host);
    sourceFile = program.getSourceFile(fileName);
  }

  if (!sourceFile) {
    return createErrorResult(code, fileName, `Failed to create source file for ${fileName}`);
  }

  globalExpansionTracker.clear();

  const hygiene = new HygieneContext();
  const diagnostics: TransformDiagnostic[] = [];

  try {
    const transformerFactory = createTransformerFactory(
      program,
      hygiene,
      globalExpansionTracker,
      verbose,
      diagnostics
    );

    const result = ts.transform(sourceFile, [transformerFactory]);

    if (result.transformed.length === 0) {
      result.dispose();
      return createUnchangedResult(code, fileName);
    }

    const transformedSourceFile = result.transformed[0];

    if (result.diagnostics) {
      for (const d of result.diagnostics) {
        diagnostics.push(convertTsDiagnostic(d, fileName));
      }
    }

    if (transformedSourceFile === sourceFile) {
      result.dispose();
      return createUnchangedResult(code, fileName, diagnostics);
    }

    // Print once, recording a source map from the printer itself, so the
    // returned code and map describe the same text (deep-review core #41).
    const printed = printWithSourceMap(transformedSourceFile, code, fileName);
    const transformedCode = printed.code;

    result.dispose();

    const expansionCount = globalExpansionTracker.count;
    // Instance inlining, specialisation, implicit filling, operator rewrites,
    // import cleanup and DCE never record a tracked expansion, so also compare
    // against the unmodified file printed the same way (deep-review core #22).
    const changed =
      expansionCount > 0 ||
      transformedCode !==
        ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(sourceFile);
    // The map comes from the printer that produced `transformedCode` — never from
    // `ExpansionTracker.generateSourceMap`, which describes `generateExpandedCode()`
    // text (original with only call sites replaced), not printer output.
    const sourceMap = changed ? printed.map : null;
    if (changed && !printed.map && printed.warning) {
      diagnostics.push({
        file: fileName,
        start: 0,
        length: 0,
        message: printed.warning,
        severity: "warning",
      });
    }
    const mapper = sourceMap
      ? createPositionMapper(sourceMap, code, transformedCode)
      : new IdentityPositionMapper();

    const expansions = trackExpansions
      ? globalExpansionTracker.getAllExpansions().slice()
      : undefined;
    globalExpansionTracker.clear();

    const coreResult: TransformCodeResult = {
      original: code,
      code: transformedCode,
      sourceMap,
      mapper,
      changed,
      diagnostics,
      expansions,
    };

    if (options.strictOutput && changed) {
      const outputDiags = typecheckOutputCode(transformedCode, fileName, compilerOptions);
      if (outputDiags.length > 0) {
        coreResult.diagnostics = [...coreResult.diagnostics, ...outputDiags];
      }
    }

    return coreResult;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    globalExpansionTracker.clear();
    return createErrorResult(code, fileName, `Transform failed: ${message}`);
  }
}

/**
 * TypeScript's printer can record a source map while it prints (that is how
 * `tsc` emits maps), but the hooks are not in the public `.d.ts`. They are
 * stable runtime exports across TS 4.x/5.x; feature-detect them and degrade to
 * "no map" with a visible warning if a future TS drops them.
 */
interface InternalSourceMapGenerator {
  toJSON(): RawSourceMap;
}
interface InternalTs {
  createSourceMapGenerator?: (
    host: {
      getCanonicalFileName(f: string): string;
      getCurrentDirectory(): string;
      useCaseSensitiveFileNames(): boolean;
    },
    file: string,
    sourceRoot: string,
    sourcesDirectoryPath: string,
    options: ts.CompilerOptions
  ) => InternalSourceMapGenerator;
  createTextWriter?: (newLine: string) => { getText(): string };
}
interface InternalPrinter {
  writeFile?: (sf: ts.SourceFile, writer: unknown, generator: unknown) => void;
}

function printWithSourceMap(
  sf: ts.SourceFile,
  originalCode: string,
  fileName: string
): { code: string; map: RawSourceMap | null; warning?: string } {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const its = ts as unknown as InternalTs;
  const writeFile = (printer as unknown as InternalPrinter).writeFile;
  if (
    typeof its.createSourceMapGenerator !== "function" ||
    typeof its.createTextWriter !== "function" ||
    typeof writeFile !== "function"
  ) {
    return {
      code: printer.printFile(sf),
      map: null,
      warning:
        "[typesugar] this TypeScript version has no printer source-map hooks; " +
        "transformCode returned no source map (positions use identity mapping)",
    };
  }
  const generator = its.createSourceMapGenerator(
    {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => "",
      useCaseSensitiveFileNames: () => true,
    },
    fileName,
    "",
    "",
    {}
  );
  const writer = its.createTextWriter("\n");
  writeFile.call(printer, sf, writer, generator);
  const map = generator.toJSON();
  if (map.sources.length > 0) map.sourcesContent = [originalCode];
  return { code: writer.getText(), map };
}

/**
 * Create the transformer factory for macro expansion.
 */
function createTransformerFactory(
  program: ts.Program,
  hygiene: HygieneContext,
  expansionTracker: typeof globalExpansionTracker | undefined,
  verbose: boolean,
  diagnostics: TransformDiagnostic[]
): ts.TransformerFactory<ts.SourceFile> {
  return (context: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      const ctx = new MacroContextImpl(
        program,
        program.getTypeChecker(),
        sourceFile,
        context.factory,
        context,
        hygiene,
        undefined,
        verbose
      );

      // PEP-052: populate per-file activation scope (syntax markers + in-file
      // typeclass definitions) so the operator path is import-scoped.
      scanImportsForScope(sourceFile, globalResolutionScope, program);

      const transformer = new MacroTransformer(ctx, verbose, expansionTracker);

      const result = ts.visitNode(sourceFile, transformer.visit.bind(transformer));

      for (const diag of ctx.getDiagnostics()) {
        let start = 0;
        let length = 0;

        if (diag.node) {
          try {
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
                // Keep pos/end values
              }
            } else {
              start = diag.node.getStart(sourceFile);
              length = diag.node.getWidth(sourceFile);
            }
          } catch {
            // Keep zero values
          }
        }

        const errorCode =
          diag.code ??
          (() => {
            const m = diag.message.match(/\[TS(\d{4})\]/);
            return m ? parseInt(m[1], 10) : undefined;
          })();

        diagnostics.push({
          file: sourceFile.fileName,
          start,
          length,
          message: diag.message,
          severity: diag.severity === "info" ? "warning" : diag.severity,
          code: errorCode,
          suggestion: diag.suggestion
            ? {
                description: diag.suggestion,
                start,
                length,
                replacement: diag.suggestion,
              }
            : undefined,
        });
      }

      return result as ts.SourceFile;
    };
  };
}

/**
 * Convert a TypeScript diagnostic to our diagnostic format.
 */
function convertTsDiagnostic(d: ts.Diagnostic, defaultFile: string): TransformDiagnostic {
  const message = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
  return {
    file: d.file?.fileName ?? defaultFile,
    start: d.start ?? 0,
    length: d.length ?? 0,
    message,
    severity: d.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    code: d.code,
  };
}

/**
 * Create an error result.
 */
function createErrorResult(code: string, fileName: string, message: string): TransformCodeResult {
  return {
    original: code,
    code,
    sourceMap: null,
    mapper: new IdentityPositionMapper(),
    changed: false,
    diagnostics: [
      {
        file: fileName,
        start: 0,
        length: 0,
        message,
        severity: "error",
      },
    ],
  };
}

/**
 * Create an unchanged result (no macros found).
 */
function createUnchangedResult(
  code: string,
  fileName: string,
  diagnostics: TransformDiagnostic[] = []
): TransformCodeResult {
  return {
    original: code,
    code,
    sourceMap: null,
    mapper: new IdentityPositionMapper(),
    changed: false,
    diagnostics,
  };
}

/**
 * Typecheck a transformed output string to verify it's valid TypeScript.
 * Browser-compatible: uses an in-memory host with no filesystem access.
 */
function typecheckOutputCode(
  outputCode: string,
  fileName: string,
  baseCompilerOptions: ts.CompilerOptions
): TransformDiagnostic[] {
  const checkOptions: ts.CompilerOptions = {
    ...baseCompilerOptions,
    noEmit: true,
    skipLibCheck: true,
  };

  // Expanded code is written against the runtime view of @opaque types.
  const host = createInMemoryCompilerHost(
    opaqueTypesAsUnderlying(fileName, outputCode),
    fileName,
    checkOptions
  );
  const program = ts.createProgram([fileName], checkOptions, host);
  const sourceFile = program.getSourceFile(fileName);
  if (!sourceFile) return [];

  const syntactic = program.getSyntacticDiagnostics(sourceFile);
  const semantic = program.getSemanticDiagnostics(sourceFile);
  const allDiags = [...syntactic, ...semantic];

  return allDiags.map((d) => {
    const msgText = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
    return {
      file: d.file?.fileName ?? fileName,
      start: d.start ?? 0,
      length: d.length ?? 0,
      message: `[strictOutput] ${msgText}`,
      severity: "warning" as const,
      code: d.code,
    };
  });
}
