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
import {
  defineExpressionMacro,
  globalRegistry,
  TS9201,
  TS9205,
  TS9211,
  TS9212,
  TS9213,
} from "@typesugar/core";
import { MacroContext } from "@typesugar/core";
import { jsValueToExpression } from "@typesugar/core";

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

/** Record a file dependency (exported for use by comptime sandbox) */
export function recordDependency(absolutePath: string): void {
  fileDependencies.add(absolutePath);
}

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * Resolve a relative path against a base directory or the source file's directory.
 * Exported for use by comptime sandbox.
 */
export function resolveRelativePath(
  ctxOrBaseDir: MacroContext | string,
  relativePath: string
): string {
  const baseDir =
    typeof ctxOrBaseDir === "string"
      ? ctxOrBaseDir
      : path.dirname(ctxOrBaseDir.sourceFile.fileName);
  return path.resolve(baseDir, relativePath);
}

/**
 * Extract a string literal path from a macro argument.
 */
function extractPathArg(
  ctx: MacroContext,
  arg: ts.Expression,
  callExpr: ts.CallExpression,
  macroName: string
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

  ctx.diagnostic(TS9205).at(callExpr).withArgs({ macro: macroName }).emit();
  return undefined;
}

// =============================================================================
// includeStr — Embed file as string literal
// =============================================================================

export const includeStrMacro = defineExpressionMacro({
  name: "includeStr",
  module: "@typesugar/macros",
  description: "Read a file at compile time and embed its contents as a string literal.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx
        .diagnostic(TS9201)
        .at(callExpr)
        .withArgs({
          macro: "includeStr",
          expected: "1",
          actual: String(args.length),
        })
        .emit();
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
      ctx
        .diagnostic(TS9212)
        .at(callExpr)
        .withArgs({
          path: relativePath,
          error: error instanceof Error ? error.message : String(error),
        })
        .note(`Resolved to: ${absolutePath}`)
        .emit();
      return callExpr;
    }
  },
});

// =============================================================================
// includeBytes — Embed file as Uint8Array literal
// =============================================================================

export const includeBytesMacro = defineExpressionMacro({
  name: "includeBytes",
  module: "@typesugar/macros",
  description: "Read a file at compile time and embed its contents as a Uint8Array literal.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx
        .diagnostic(TS9201)
        .at(callExpr)
        .withArgs({
          macro: "includeBytes",
          expected: "1",
          actual: String(args.length),
        })
        .emit();
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
        [ctx.factory.createArrayLiteralExpression(elements)]
      );
    } catch (error) {
      ctx
        .diagnostic(TS9212)
        .at(callExpr)
        .withArgs({
          path: relativePath,
          error: error instanceof Error ? error.message : String(error),
        })
        .note(`Resolved to: ${absolutePath}`)
        .emit();
      return callExpr;
    }
  },
});

// =============================================================================
// includeJson — Parse JSON at compile time, embed as object literal
// =============================================================================

export const includeJsonMacro = defineExpressionMacro({
  name: "includeJson",
  module: "@typesugar/macros",
  description:
    "Read and parse a JSON file at compile time, embedding the result as an object literal.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx
        .diagnostic(TS9201)
        .at(callExpr)
        .withArgs({
          macro: "includeJson",
          expected: "1",
          actual: String(args.length),
        })
        .emit();
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
        ctx
          .diagnostic(TS9213)
          .at(callExpr)
          .withArgs({ path: relativePath })
          .note(error.message)
          .emit();
      } else {
        ctx
          .diagnostic(TS9212)
          .at(callExpr)
          .withArgs({
            path: relativePath,
            error: error instanceof Error ? error.message : String(error),
          })
          .note(`Resolved to: ${absolutePath}`)
          .emit();
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
  module: "@typesugar/macros",
  description: "Read a text file at compile time with optional encoding. Alias for includeStr.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
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
