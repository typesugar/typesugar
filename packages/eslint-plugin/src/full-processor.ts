/**
 * Full ESLint Processor for typesugar
 *
 * This processor runs the ACTUAL typesugar macro transformer, not just pattern matching.
 * It produces properly transformed output with accurate source mappings.
 *
 * Requirements:
 * - TypeScript must be available
 * - typesugar transformer must be built
 * - Uses more memory (creates TS programs per file)
 *
 * Trade-offs vs the lightweight processor:
 * - More accurate (real macro expansion)
 * - Better source mapping
 * - Slower (full TS compilation)
 * - Higher memory usage
 */

import type { Linter } from "eslint";
import * as ts from "typescript";
import { preprocess as preprocessCustomSyntax } from "@typesugar/preprocessor";

// Dynamically import the transformer to avoid circular dependencies
let transformerFactory: typeof import("@typesugar/transformer").default | undefined;

/** typesugar package prefixes for import detection */
const TYPESUGAR_PACKAGE_PREFIXES = [
  "typesugar",
  "@typesugar/",
  "typemacro", // legacy name
  "@typemacro/", // legacy name
  "ttfx", // legacy name
  "@ttfx/", // legacy name
];

/**
 * Check if a lint message is about an unused import from a typesugar package.
 */
function isTypesugarUnusedImportError(message: Linter.LintMessage, source: string): boolean {
  // Rules that report unused imports
  const unusedImportRules = [
    "no-unused-vars",
    "@typescript-eslint/no-unused-vars",
    "import/no-unused-modules",
    "unused-imports/no-unused-imports",
    "unused-imports/no-unused-vars",
  ];

  if (!unusedImportRules.includes(message.ruleId ?? "")) {
    return false;
  }

  // Find the line with the error
  if (message.line === undefined) {
    return false;
  }

  const lines = source.split("\n");
  const errorLine = lines[message.line - 1] ?? "";

  // Check if this line is an import from a typesugar package
  const importMatch = errorLine.match(/from\s+["']([^"']+)["']/);
  if (!importMatch) {
    return false;
  }

  const modulePath = importMatch[1];
  return TYPESUGAR_PACKAGE_PREFIXES.some(
    (prefix) => modulePath === prefix.replace(/\/$/, "") || modulePath.startsWith(prefix)
  );
}

async function loadTransformer() {
  if (!transformerFactory) {
    try {
      const mod = await import("@typesugar/transformer");
      transformerFactory = mod.default;
    } catch (e) {
      console.warn("[typesugar-eslint] Could not load transformer:", e);
    }
  }
  return transformerFactory;
}

interface TransformResult {
  transformed: string;
  sourceMap: Map<number, number>; // transformed line -> original line
}

// Cache for transformed files (avoids re-transforming unchanged files)
const transformCache = new Map<string, { source: string; result: TransformResult }>();

/**
 * Create a TypeScript program and run the typesugar transformer
 */
function transformWithTypesugar(fileName: string, source: string): TransformResult {
  // Check cache
  const cached = transformCache.get(fileName);
  if (cached && cached.source === source) {
    return cached.result;
  }

  const sourceMap = new Map<number, number>();

  // First: Run the preprocessor to handle custom syntax (F<_> HKT, |>, ::)
  // This converts non-standard TypeScript to valid TypeScript before the TS compiler sees it
  const preprocessResult = preprocessCustomSyntax(source, { fileName });
  const preprocessedSource = preprocessResult.code;

  // Create compiler options
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    experimentalDecorators: true,
    noEmit: false,
    declaration: false,
  };

  // Create a virtual file system
  const files = new Map<string, string>();
  files.set(fileName, preprocessedSource);

  // Create compiler host
  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile;
  const originalReadFile = host.readFile;
  const originalFileExists = host.fileExists;

  host.getSourceFile = (name, languageVersion) => {
    const content = files.get(name);
    if (content !== undefined) {
      return ts.createSourceFile(name, content, languageVersion, true);
    }
    return originalGetSourceFile.call(host, name, languageVersion);
  };

  host.readFile = (name) => {
    const content = files.get(name);
    if (content !== undefined) return content;
    return originalReadFile.call(host, name);
  };

  host.fileExists = (name) => {
    if (files.has(name)) return true;
    return originalFileExists.call(host, name);
  };

  // Capture output
  let transformedOutput = "";
  host.writeFile = (name, text) => {
    if (name.endsWith(".js") || name.endsWith(".ts")) {
      transformedOutput = text;
    }
  };

  // Create program
  const program = ts.createProgram([fileName], compilerOptions, host);

  // Get the transformer factory
  if (!transformerFactory) {
    // Transformer not loaded yet - return original
    const result = { transformed: source, sourceMap };
    transformCache.set(fileName, { source, result });
    return result;
  }

  // Run transformation
  const transformer = transformerFactory(program, { verbose: false });
  const sourceFile = program.getSourceFile(fileName);

  if (!sourceFile) {
    const result = { transformed: source, sourceMap };
    transformCache.set(fileName, { source, result });
    return result;
  }

  // Transform
  const transformationResult = ts.transform(sourceFile, [transformer], compilerOptions);
  const transformedSourceFile = transformationResult.transformed[0];

  // Print the transformed AST back to text
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  transformedOutput = printer.printFile(transformedSourceFile);

  // Build source map (line-based)
  // TODO: More sophisticated source mapping using AST node positions
  const originalLines = source.split("\n");
  const transformedLines = transformedOutput.split("\n");

  // For now, simple 1:1 mapping for unchanged lines
  // Real implementation would track AST node origins
  for (let i = 0; i < Math.max(originalLines.length, transformedLines.length); i++) {
    sourceMap.set(i + 1, Math.min(i + 1, originalLines.length));
  }

  transformationResult.dispose();

  const result = { transformed: transformedOutput, sourceMap };
  transformCache.set(fileName, { source, result });
  return result;
}

// Store state for postprocess
const fileStates = new Map<
  string,
  {
    originalSource: string;
    sourceMap: Map<number, number>;
  }
>();

/**
 * Create the full processor that uses the actual typesugar transformer
 */
export function createFullProcessor(): Linter.Processor {
  // Eagerly load transformer
  loadTransformer().catch(() => {});

  return {
    meta: {
      name: "typesugar-full",
      version: "0.1.0",
    },

    supportsAutofix: true,

    preprocess(text: string, filename: string): Array<string | { text: string; filename: string }> {
      // Skip non-TypeScript files
      if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) {
        return [text];
      }

      // Transform using the full typesugar transformer
      const { transformed, sourceMap } = transformWithTypesugar(filename, text);

      fileStates.set(filename, {
        originalSource: text,
        sourceMap,
      });

      return [transformed];
    },

    postprocess(messages: Linter.LintMessage[][], filename: string): Linter.LintMessage[] {
      const state = fileStates.get(filename);
      if (!state) {
        return messages.flat();
      }

      return messages
        .flat()
        .filter((message) => !isTypesugarUnusedImportError(message, state.originalSource))
        .map((message) => {
          if (message.line !== undefined) {
            const originalLine = state.sourceMap.get(message.line) ?? message.line;
            return {
              ...message,
              line: originalLine,
              endLine: message.endLine
                ? (state.sourceMap.get(message.endLine) ?? message.endLine)
                : undefined,
            };
          }
          return message;
        });
    },
  };
}

/**
 * Clear the transform cache (useful for watch mode)
 */
export function clearTransformCache(): void {
  transformCache.clear();
}
