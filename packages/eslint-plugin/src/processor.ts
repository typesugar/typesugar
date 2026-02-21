/**
 * ESLint Processor for typesugar
 *
 * This processor runs the typesugar macro transformer on source files before ESLint
 * lints them. ESLint sees the transformed output, which is standard TypeScript
 * with all macro syntax expanded.
 *
 * How it works:
 * 1. preprocess(): Receives source code, runs typesugar preprocessor (HKT, operators) then
 *    pattern-based transforms, returns transformed code
 * 2. ESLint lints the transformed code (no false positives from macro syntax)
 * 3. postprocess(): Maps lint messages back to original source locations
 *
 * This is the same approach used by eslint-plugin-svelte and eslint-plugin-vue.
 */

import type { Linter } from "eslint";
import * as ts from "typescript";
import { preprocess as preprocessCustomSyntax } from "@typesugar/preprocessor";

interface SourceMapping {
  originalFile: string;
  originalLine: number;
  originalColumn: number;
  generatedLine: number;
  generatedColumn: number;
}

interface ProcessorState {
  originalSource: string;
  transformedSource: string;
  sourceMappings: SourceMapping[];
  fileName: string;
}

// Per-file state for source mapping
const fileStates = new Map<string, ProcessorState>();

/**
 * Create a TypeScript program for a single file
 */
function createSingleFileProgram(fileName: string, source: string): ts.Program {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    declaration: false,
    noEmit: true,
    // Enable experimental decorators for typesugar syntax
    experimentalDecorators: true,
  };

  // Create a virtual file system with just this file
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  // Create a minimal compiler host
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getDirectories: () => [],
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? source : undefined),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };

  return ts.createProgram([fileName], compilerOptions, host);
}

/**
 * Run the typesugar transformer on source code
 */
function transformSource(
  fileName: string,
  source: string,
): {
  transformed: string;
  mappings: SourceMapping[];
} {
  const mappings: SourceMapping[] = [];

  try {
    // First: Run the preprocessor to handle custom syntax (F<_> HKT, |>, ::)
    // This converts non-standard TypeScript to valid TypeScript
    const preprocessResult = preprocessCustomSyntax(source, { fileName });
    let transformed = preprocessResult.code;

    // Import the transformer dynamically to avoid circular deps at load time
    // For now, we'll use a simpler approach: just run the TS compiler
    // with the transformer loaded

    const program = createSingleFileProgram(fileName, transformed);
    const sourceFile = program.getSourceFile(fileName);

    if (!sourceFile) {
      return { transformed, mappings };
    }

    // For the initial implementation, we'll create a lightweight transform
    // that handles the most common patterns. A full implementation would
    // integrate with the actual typesugar transformer.

    // Transform patterns that cause ESLint false positives:
    // 1. @derive(Eq, Clone) -> remove decorator (ESLint doesn't need to see it)
    // 2. requires: { ... } -> /* requires: { ... } */ (comment out)
    // 3. comptime(...) -> /* comptime(...) */ (the value is inlined)

    // Simple pattern-based transformation for the most common cases
    // This is a heuristic approach - the full solution would use the actual transformer

    // Pattern 1: Remove @derive, @typeclass, @instance, etc. decorators with undefined args
    const decoratorPattern =
      /@(derive|deriving|typeclass|instance|operators|contract|invariant|reflect)\s*\([^)]*\)/g;
    transformed = transformed.replace(decoratorPattern, (match) => {
      // Keep the decorator but wrap undefined identifiers
      // For now, just comment it out - ESLint will see the class/function without decorators
      return `/* ${match} */`;
    });

    // Pattern 2: Comment out labeled blocks (requires:/ensures:)
    // These are valid JS but ESLint warns about unused labels
    const labeledBlockPattern = /(requires|ensures)\s*:\s*\{[\s\S]*?\n\s*\}/g;
    transformed = transformed.replace(labeledBlockPattern, (match) => {
      return `/* ${match.replace(/\*\//g, "* /")} */`;
    });

    // Pattern 3: Handle comptime() - these expand to literals at compile time
    // For linting purposes, we can replace with a placeholder
    const comptimePattern = /comptime\s*\(\s*(?:[\s\S]*?)\s*\)/g;
    // Keep comptime for now - it's typed properly and shouldn't cause issues

    // Build basic line-to-line mappings (1:1 for unchanged lines)
    // TODO: Compose with preprocessor source map for accurate position tracking
    const originalLines = source.split("\n");
    const transformedLines = transformed.split("\n");

    for (
      let i = 0;
      i < Math.min(originalLines.length, transformedLines.length);
      i++
    ) {
      mappings.push({
        originalFile: fileName,
        originalLine: i + 1,
        originalColumn: 0,
        generatedLine: i + 1,
        generatedColumn: 0,
      });
    }

    return { transformed, mappings };
  } catch (error) {
    // If transformation fails, return original source
    console.warn(`[typesugar-eslint] Transform failed for ${fileName}:`, error);
    return { transformed: source, mappings };
  }
}

/**
 * Map a position in transformed code back to original source
 */
function mapToOriginal(
  state: ProcessorState,
  line: number,
  column: number,
): { line: number; column: number } {
  // Find the closest mapping
  for (let i = state.sourceMappings.length - 1; i >= 0; i--) {
    const mapping = state.sourceMappings[i];
    if (mapping.generatedLine <= line) {
      // Simple line-based mapping for now
      const lineDelta = line - mapping.generatedLine;
      return {
        line: mapping.originalLine + lineDelta,
        column: column, // TODO: More precise column mapping
      };
    }
  }

  // Fallback: return as-is
  return { line, column };
}

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
function isTypesugarUnusedImportError(
  message: Linter.LintMessage,
  source: string,
): boolean {
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
    (prefix) =>
      modulePath === prefix.replace(/\/$/, "") || modulePath.startsWith(prefix),
  );
}

/**
 * Create the ESLint processor
 */
export function createProcessor(): Linter.Processor {
  return {
    meta: {
      name: "typesugar",
      version: "0.1.0",
    },

    // Only process .ts and .tsx files
    supportsAutofix: true,

    /**
     * Preprocess: Transform the source before linting
     */
    preprocess(
      text: string,
      filename: string,
    ): Array<string | { text: string; filename: string }> {
      // Skip non-TypeScript files
      if (!filename.endsWith(".ts") && !filename.endsWith(".tsx")) {
        return [text];
      }

      // Quick check: does this file even use typesugar patterns?
      // For :: we use a regex to avoid false positives with TypeScript's :: in labels
      // (e.g., `foo::bar` vs `foo: { label: ... }`)
      const usesTypesugar =
        text.includes("@derive") ||
        text.includes("@typeclass") ||
        text.includes("@instance") ||
        text.includes("@contract") ||
        text.includes("@invariant") ||
        text.includes("comptime(") ||
        text.includes("requires:") ||
        text.includes("ensures:") ||
        text.includes("@operators") ||
        text.includes("@reflect") ||
        text.includes("<_>") || // HKT syntax
        text.includes("|>") || // Pipeline operator
        /[)\]}\w]\s*::\s*[(\[{A-Za-z_$]/.test(text); // Cons operator (value :: value context)

      if (!usesTypesugar) {
        // No typesugar patterns - pass through unchanged
        fileStates.set(filename, {
          originalSource: text,
          transformedSource: text,
          sourceMappings: [],
          fileName: filename,
        });
        return [text];
      }

      // Transform the source
      const { transformed, mappings } = transformSource(filename, text);

      // Store state for postprocess
      fileStates.set(filename, {
        originalSource: text,
        transformedSource: transformed,
        sourceMappings: mappings,
        fileName: filename,
      });

      return [transformed];
    },

    /**
     * Postprocess: Map lint messages back to original source locations
     * and filter out false positives for typesugar imports
     */
    postprocess(
      messages: Linter.LintMessage[][],
      filename: string,
    ): Linter.LintMessage[] {
      const state = fileStates.get(filename);
      if (!state || state.sourceMappings.length === 0) {
        // No transformation was done, but still filter typesugar import errors
        return messages
          .flat()
          .filter(
            (message) =>
              !isTypesugarUnusedImportError(
                message,
                state?.originalSource ?? "",
              ),
          );
      }

      // Map each message's location back to the original source
      // and filter out false positives for typesugar imports
      return messages
        .flat()
        .filter(
          (message) =>
            !isTypesugarUnusedImportError(message, state.originalSource),
        )
        .map((message) => {
          if (message.line !== undefined) {
            const mapped = mapToOriginal(
              state,
              message.line,
              message.column ?? 0,
            );
            return {
              ...message,
              line: mapped.line,
              column: mapped.column,
              endLine: message.endLine
                ? mapToOriginal(state, message.endLine, 0).line
                : undefined,
            };
          }
          return message;
        });
    },
  };
}
