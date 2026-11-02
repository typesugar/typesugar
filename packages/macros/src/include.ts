/**
 * Compile-Time File I/O Macros
 *
 * Provides controlled, read-only file access at compile time:
 * - `includeStr(path)` — embed file contents as a string literal
 * - `includeBytes(path)` — embed file contents as a Uint8Array literal
 * - `includeJson<T>(path)` — parse JSON at compile time, embed as object literal
 *
 * - `includeText(path)` — alias for `includeStr`
 *
 * Paths are resolved relative to the source file and must stay inside the
 * project (the tsconfig directory or the program's current directory).
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
import { defineExpressionMacro, globalRegistry } from "@typesugar/core";
import { MacroContext } from "@typesugar/core";
import { jsValueToExpression } from "@typesugar/core";
import { TS9205, TS9212, TS9213 } from "@typesugar/core";

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
 * Resolve a path against the source file's directory, ensuring the result
 * stays within the project root to prevent path traversal attacks (F2).
 *
 * Blocks (lexically — `path.resolve` + `path.normalize`, then a project-root
 * boundary check):
 * - Absolute paths: `/etc/passwd`
 * - Traversal: `../../../.env`, including forms that re-enter the root
 *   (`./a/../../b`) — `..` segments are collapsed before the check.
 *
 * Does NOT resolve symlinks: a symlink *already planted inside* the project
 * root that points outside it would not be caught. That requires write access
 * to the repo, which is outside the macro-argument threat model (a hostile
 * dependency can only pass a path string, not plant files). See F2 in
 * docs/SECURITY-REVIEW.md.
 */
function resolveRelativePath(ctx: MacroContext, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(
      `Security: absolute paths are not allowed in include macros. ` +
        `Use a path relative to the source file instead: "${relativePath}"`
    );
  }

  const sourceDir = path.dirname(ctx.sourceFile.fileName);
  const resolved = path.normalize(path.resolve(sourceDir, relativePath));
  const roots = projectRoots(ctx, sourceDir);

  if (!roots.some((root) => isWithin(root, resolved))) {
    throw new Error(
      `Security: path "${relativePath}" resolves to "${resolved}" which is ` +
        `outside the project root "${roots.join('" / "')}". ` +
        `File access is restricted to the project directory.`
    );
  }

  return resolved;
}

/** `target` is `root` itself or lies beneath it (no string-prefix tricks). */
function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

/** A filesystem root ("/", "C:\\") is never a meaningful project root. */
function isFilesystemRoot(dir: string): boolean {
  return dir === "" || path.parse(dir).root === dir;
}

/**
 * Directories that count as "the project": the directory of the tsconfig the
 * program was built from, and the program's current directory. Either may be
 * missing or meaningless (single-file transforms use cwd "/"), in which case
 * the source file's own directory is the only root.
 */
function projectRoots(ctx: MacroContext, sourceDir: string): string[] {
  const roots: string[] = [];
  const configFilePath = ctx.program.getCompilerOptions().configFilePath;
  if (typeof configFilePath === "string" && configFilePath) {
    roots.push(path.normalize(path.dirname(path.resolve(configFilePath))));
  }
  const cwd = path.normalize(ctx.program.getCurrentDirectory());
  if (!isFilesystemRoot(cwd)) roots.push(cwd);
  const usable = roots.filter((r) => !isFilesystemRoot(r));
  return usable.length > 0 ? usable : [path.normalize(sourceDir)];
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

  ctx
    .diagnostic(TS9205)
    .at(callExpr)
    .help(`Pass a string literal: ${macroName}("./path/to/file")`)
    .emit();
  return undefined;
}

// =============================================================================
// includeStr — Embed file as string literal
// =============================================================================

export const includeStrMacro = defineExpressionMacro({
  name: "includeStr",
  cacheable: false, // depends on file contents on disk, not just the call text
  module: "typesugar",
  description: "Read a file at compile time and embed its contents as a string literal.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "includeStr expects exactly one argument: includeStr(path)");
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
        .withArgs({ path: relativePath })
        .note(`Resolved to: ${absolutePath}`)
        .note(error instanceof Error ? error.message : String(error))
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
  cacheable: false, // depends on file contents on disk, not just the call text
  module: "typesugar",
  description: "Read a file at compile time and embed its contents as a Uint8Array literal.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "includeBytes expects exactly one argument: includeBytes(path)");
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
        .withArgs({ path: relativePath })
        .note(`Resolved to: ${absolutePath}`)
        .note(error instanceof Error ? error.message : String(error))
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
  cacheable: false, // depends on file contents on disk, not just the call text
  module: "typesugar",
  description:
    "Read and parse a JSON file at compile time, embedding the result as an object literal.",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[]
  ): ts.Expression {
    if (args.length !== 1) {
      ctx.reportError(callExpr, "includeJson expects exactly one argument: includeJson(path)");
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
          .withArgs({ path: relativePath })
          .note(`Resolved to: ${absolutePath}`)
          .note(error instanceof Error ? error.message : String(error))
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
  cacheable: false, // depends on file contents on disk, not just the call text
  module: "typesugar",
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
