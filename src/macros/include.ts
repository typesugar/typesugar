/**
 * Compile-Time File I/O Macros
 *
 * Provides controlled, read-only file access at compile time:
 * - `includeStr(path)` — embed file contents as a string literal
 * - `includeBytes(path)` — embed file contents as a Uint8Array literal
 * - `includeJson<T>(path)` — parse JSON at compile time, embed as object literal
 *
 * Also extends the comptime sandbox with a `readFile(path)` function for
 * use inside `comptime()` blocks.
 *
 * Inspired by: Rust `include_str!`/`include_bytes!`, Zig `@embedFile`, Nim `staticRead`
 *
 * @example
 * ```typescript
 * import { includeStr, includeBytes, includeJson } from "typesugar";
 *
 * const schema = includeStr("./schema.graphql");
 * const icon = includeBytes("./icon.png");
 * const config = includeJson<AppConfig>("./config.json");
 * ```
 */

import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import { defineExpressionMacro, globalRegistry } from "../core/registry.js";
import { MacroContext } from "../core/types.js";
import { jsValueToExpression } from "../core/ast-utils.js";

// =============================================================================
// Dependency Tracking
// =============================================================================

/**
 * Set of file paths that macros have read during the current compilation.
 * Used by watch mode and incremental builds to know when to re-expand.
 */
const fileDependencies = new Set<string>();

/** Get all file dependencies recorded during compilation */
export function getFileDependencies(): ReadonlySet<string> {
  return fileDependencies;
}

/** Clear file dependencies (called at the start of each compilation) */
export function clearFileDependencies(): void {
  fileDependencies.clear();
}

/** Record a file dependency */
function recordDependency(absolutePath: string): void {
  fileDependencies.add(absolutePath);
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Resolve a relative path against the source file's directory.
 */
function resolveRelativePath(ctx: MacroContext, relativePath: string): string {
  const sourceDir = path.dirname(ctx.sourceFile.fileName);
  return path.resolve(sourceDir, relativePath);
}

/**
 * Extract a string literal path from a macro argument.
 */
function extractPathArg(
  ctx: MacroContext,
  arg: ts.Expression,
  callExpr: ts.CallExpression,
  macroName: string,
): string | undefined {
  if (ts.isStringLiteral(arg)) {
    return arg.text;
  }

  if (ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }

  // Try compile-time evaluation
  const result = ctx.evaluate(arg);
  if (result.kind === "string") {
    return result.value;
  }

  ctx.reportError(
    callExpr,
    `${macroName}: path argument must be a string literal or compile-time constant`,
  );
  return undefined;
}

// =============================================================================
// includeStr — Embed file as string literal
// =============================================================================

export const includeStrMacro = defineExpressionMacro({
  name: "includeStr",
  module: "typemacro",
  description:
    "Read a file at compile time and embed its contents as a string literal.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(
        callExpr,
        "includeStr expects exactly one argument: includeStr(path)",
      );
      return callExpr;
    }

    const relativePath = extractPathArg(ctx, args[0], callExpr, "includeStr");
    if (!relativePath) return callExpr;

    const absolutePath = resolveRelativePath(ctx, relativePath);
    recordDependency(absolutePath);

    try {
      const contents = fs.readFileSync(absolutePath, "utf-8");
      return ctx.factory.createStringLiteral(contents);
    } catch (error) {
      ctx.reportError(
        callExpr,
        `includeStr: Cannot read file '${relativePath}' (resolved to '${absolutePath}'): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return callExpr;
    }
  },
});

// =============================================================================
// includeBytes — Embed file as Uint8Array literal
// =============================================================================

export const includeBytesMacro = defineExpressionMacro({
  name: "includeBytes",
  module: "typemacro",
  description:
    "Read a file at compile time and embed its contents as a Uint8Array literal.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(
        callExpr,
        "includeBytes expects exactly one argument: includeBytes(path)",
      );
      return callExpr;
    }

    const relativePath = extractPathArg(ctx, args[0], callExpr, "includeBytes");
    if (!relativePath) return callExpr;

    const absolutePath = resolveRelativePath(ctx, relativePath);
    recordDependency(absolutePath);

    try {
      const buffer = fs.readFileSync(absolutePath);
      const bytes = Array.from(new Uint8Array(buffer));

      // Generate: new Uint8Array([b0, b1, b2, ...])
      const elements = bytes.map((b) => ctx.factory.createNumericLiteral(b));

      return ctx.factory.createNewExpression(
        ctx.factory.createIdentifier("Uint8Array"),
        undefined,
        [ctx.factory.createArrayLiteralExpression(elements)],
      );
    } catch (error) {
      ctx.reportError(
        callExpr,
        `includeBytes: Cannot read file '${relativePath}' (resolved to '${absolutePath}'): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return callExpr;
    }
  },
});

// =============================================================================
// includeJson — Parse JSON at compile time, embed as object literal
// =============================================================================

export const includeJsonMacro = defineExpressionMacro({
  name: "includeJson",
  module: "typemacro",
  description:
    "Read and parse a JSON file at compile time, embedding the result as an object literal.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(
        callExpr,
        "includeJson expects exactly one argument: includeJson(path)",
      );
      return callExpr;
    }

    const relativePath = extractPathArg(ctx, args[0], callExpr, "includeJson");
    if (!relativePath) return callExpr;

    const absolutePath = resolveRelativePath(ctx, relativePath);
    recordDependency(absolutePath);

    try {
      const contents = fs.readFileSync(absolutePath, "utf-8");
      const parsed = JSON.parse(contents);
      return jsValueToExpression(ctx, parsed, callExpr);
    } catch (error) {
      if (error instanceof SyntaxError) {
        ctx.reportError(
          callExpr,
          `includeJson: Invalid JSON in '${relativePath}': ${error.message}`,
        );
      } else {
        ctx.reportError(
          callExpr,
          `includeJson: Cannot read file '${relativePath}' (resolved to '${absolutePath}'): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      return callExpr;
    }
  },
});

// =============================================================================
// includeText — Alias for includeStr with encoding option
// =============================================================================

export const includeTextMacro = defineExpressionMacro({
  name: "includeText",
  module: "typemacro",
  description:
    "Read a text file at compile time with optional encoding. Alias for includeStr.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    // Delegate to includeStr
    return includeStrMacro.expand(ctx, callExpr, args);
  },
});

// =============================================================================
// JS Value → AST Expression Conversion
// =============================================================================

// =============================================================================
// Register macros
// =============================================================================

globalRegistry.register(includeStrMacro);
globalRegistry.register(includeBytesMacro);
globalRegistry.register(includeJsonMacro);
globalRegistry.register(includeTextMacro);
