/**
 * .d.ts Post-Processor for @opaque Types
 *
 * Transforms @opaque interface declarations in .d.ts files into type aliases
 * that expose the underlying runtime representation. This enables:
 *
 * 1. Plain TypeScript consumers to work with the erased type directly
 * 2. TypeSugar consumers to auto-discover opaque types via the @opaque annotation
 *
 * @example
 * Input (.d.ts from tsc):
 * ```typescript
 * /** @opaque A | null *\/
 * export interface Option<A> {
 *   map<B>(f: (a: A) => B): Option<B>;
 *   flatMap<B>(f: (a: A) => Option<B>): Option<B>;
 * }
 * ```
 *
 * Output (transformed .d.ts):
 * ```typescript
 * /** @opaque A | null *\/
 * export type Option<A> = A | null;
 * ```
 *
 * The companion function declarations (map, flatMap, Some, None, etc.) are
 * left unchanged — they reference Option<A> which is now the type alias.
 */

import ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import { stripPositions } from "@typesugar/core";

// ---------------------------------------------------------------------------
// Core transform
// ---------------------------------------------------------------------------

/**
 * Extract the `@opaque` tag value from a node's JSDoc comments.
 */
function extractOpaqueTag(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  // Try TS JSDoc API first
  const tags = ts.getJSDocTags(node);
  for (const tag of tags) {
    if (tag.tagName.text === "opaque") {
      const comment =
        typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);
      if (comment) return comment.trim();
    }
  }

  // Fallback: manual extraction from comment text
  // (needed when TS doesn't parse @opaque as a known tag)
  const fullText = sourceFile.getFullText();
  const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!commentRanges) return undefined;

  for (const range of commentRanges) {
    const comment = fullText.slice(range.pos, range.end);
    // Extract everything after @opaque until next tag or end of comment
    const opaqueIdx = comment.indexOf("@opaque");
    if (opaqueIdx === -1) continue;

    const afterOpaque = comment.slice(opaqueIdx + "@opaque".length);
    // Find the end: next @tag, or end of comment block
    const nextTagMatch = afterOpaque.match(/\n\s*\*\s*@/);
    const endOfComment = afterOpaque.indexOf("*/");

    let endIdx: number;
    if (
      nextTagMatch?.index !== undefined &&
      (endOfComment === -1 || nextTagMatch.index < endOfComment)
    ) {
      endIdx = nextTagMatch.index;
    } else if (endOfComment !== -1) {
      endIdx = endOfComment;
    } else {
      endIdx = afterOpaque.length;
    }

    const value = afterOpaque
      .slice(0, endIdx)
      .replace(/\n\s*\*\s*/g, " ") // join continuation lines
      .trim();
    if (value) return value;
  }

  return undefined;
}

/**
 * Get the full text range of a JSDoc comment block preceding a node.
 * Returns the start position of the comment (including /**).
 */
function getJsDocRange(
  node: ts.Node,
  sourceFile: ts.SourceFile
): { pos: number; end: number } | undefined {
  const fullText = sourceFile.getFullText();
  const commentRanges = ts.getLeadingCommentRanges(fullText, node.getFullStart());
  if (!commentRanges) return undefined;

  // Find the last block comment (JSDoc) before the node
  for (let i = commentRanges.length - 1; i >= 0; i--) {
    const range = commentRanges[i];
    if (range.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      return range;
    }
  }
  return undefined;
}

export interface DtsTransformResult {
  /** The transformed .d.ts content */
  content: string;
  /** Number of interfaces that were transformed */
  transformedCount: number;
  /** Names of the transformed types */
  transformedTypes: string[];
}

const printer = ts.createPrinter({ removeComments: true });

/**
 * Parse a free-text type expression (the `@opaque` JSDoc tag's value) into a
 * real `ts.TypeNode`.
 *
 * PEP-057 exception (documented in CLAUDE.md): the `@opaque` tag's value is
 * free-form TypeScript type syntax written inside a JSDoc comment — there is
 * no attached syntax tree for it (JSDoc comment text isn't parsed as TS type
 * syntax by the checker), so recovering a `ts.TypeNode` from it requires one
 * parse. Same category as `typeclass.ts`'s `fullSignatureText` contract and
 * `effect/schema.ts`'s `mapTypeToSchema` — a genuinely textual input with no
 * tree to build from, not a case where AST construction was "more work."
 * Everything else in this function (the interface's name, type parameters —
 * including constraints/defaults — and export/declare modifiers) is reused
 * directly from the real parsed `ts.InterfaceDeclaration` node, not
 * reconstructed from text.
 */
function parseOpaqueTypeExpression(text: string): ts.TypeNode | undefined {
  const wrapper = ts.createSourceFile(
    "__opaque_type__.ts",
    `type __T = ${text};`,
    ts.ScriptTarget.Latest,
    true
  );
  for (const stmt of wrapper.statements) {
    // Strip positions — this node's pos/end are offsets into the temporary
    // wrapper source above, not into the real .d.ts file it gets spliced
    // into. Leaving them real would make the printer slice the WRONG file's
    // text for this subtree (see stripPositions' own callers in
    // core/src/context.ts's parseExpression/parseStatements for the same
    // fix in the analogous ctx.parseExpression case).
    if (ts.isTypeAliasDeclaration(stmt)) return stripPositions(stmt.type);
  }
  return undefined;
}

/**
 * Transform a .d.ts file, replacing @opaque interface declarations with
 * type aliases that expose the underlying runtime representation.
 *
 * The JSDoc comment (including @opaque annotation) is preserved so that
 * consumer-side tooling can discover the opaque type metadata.
 *
 * @param fileName - The file name (for TS parser diagnostics)
 * @param content - The .d.ts file content
 * @returns The transformed content and metadata
 */
export function transformDtsContent(fileName: string, content: string): DtsTransformResult {
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true
  );

  // Collect replacements — we'll apply them in reverse order to preserve positions
  const replacements: Array<{
    /** Start of the interface keyword (after JSDoc/modifiers) */
    start: number;
    /** End of the interface declaration (closing brace) */
    end: number;
    /** Replacement text */
    text: string;
  }> = [];
  const transformedTypes: string[] = [];

  for (const stmt of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(stmt)) continue;

    const underlyingTypeText = extractOpaqueTag(stmt, sourceFile);
    if (!underlyingTypeText) continue;

    const underlyingTypeNode = parseOpaqueTypeExpression(underlyingTypeText);
    if (!underlyingTypeNode) continue; // malformed @opaque annotation — leave the interface as-is

    // Reuse the real name/type-parameters/modifiers nodes directly rather
    // than reconstructing them from text (constraints/defaults on type
    // parameters, e.g. `A extends object`, come along for free this way).
    const aliasDecl = ts.factory.createTypeAliasDeclaration(
      ts.getModifiers(stmt),
      stmt.name,
      stmt.typeParameters,
      underlyingTypeNode
    );

    const alias = printer.printNode(ts.EmitHint.Unspecified, aliasDecl, sourceFile);

    // Replace from the node start (after leading trivia/JSDoc) to the node end.
    // getStart(sourceFile) gives the position after leading trivia (JSDoc comments),
    // so the JSDoc is preserved automatically.
    replacements.push({
      start: stmt.getStart(sourceFile),
      end: stmt.getEnd(),
      text: alias,
    });
    transformedTypes.push(stmt.name.text);
  }

  if (replacements.length === 0) {
    return { content, transformedCount: 0, transformedTypes: [] };
  }

  // Apply replacements in reverse order to preserve earlier positions
  let result = content;
  for (const r of [...replacements].reverse()) {
    result = result.slice(0, r.start) + r.text + result.slice(r.end);
  }

  return {
    content: result,
    transformedCount: replacements.length,
    transformedTypes,
  };
}

// ---------------------------------------------------------------------------
// File / directory processing
// ---------------------------------------------------------------------------

/**
 * Transform a single .d.ts file in-place.
 *
 * @returns true if the file was modified
 */
export function transformDtsFile(filePath: string, verbose?: boolean): boolean {
  const content = fs.readFileSync(filePath, "utf-8");
  const result = transformDtsContent(path.basename(filePath), content);

  if (result.transformedCount === 0) return false;

  fs.writeFileSync(filePath, result.content, "utf-8");

  if (verbose) {
    console.log(
      `[typesugar] dts-transform: ${filePath} — erased ${result.transformedCount} opaque interface(s): ${result.transformedTypes.join(", ")}`
    );
  }

  return true;
}

/**
 * Recursively transform all .d.ts files under a directory.
 *
 * @returns Number of files modified
 */
export function transformDtsDirectory(dirPath: string, verbose?: boolean): number {
  let count = 0;

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".d.ts")) {
        if (transformDtsFile(full, verbose)) count++;
      }
    }
  }

  walk(dirPath);
  return count;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * CLI usage: typesugar-dts-transform [--verbose] <path> [<path> ...]
 *
 * Each <path> can be a .d.ts file or a directory (recursively processed).
 */
export function cli(args: string[]): void {
  const verbose = args.includes("--verbose") || args.includes("-v");
  const paths = args.filter((a) => !a.startsWith("-"));

  if (paths.length === 0) {
    console.error("Usage: typesugar-dts-transform [--verbose] <path> [<path> ...]");
    process.exit(1);
  }

  let totalFiles = 0;
  for (const p of paths) {
    const resolved = path.resolve(p);
    const stat = fs.statSync(resolved, { throwIfNoEntry: false });
    if (!stat) {
      console.error(`Not found: ${resolved}`);
      process.exit(1);
    }
    if (stat.isDirectory()) {
      totalFiles += transformDtsDirectory(resolved, verbose);
    } else {
      if (transformDtsFile(resolved, verbose)) totalFiles++;
    }
  }

  if (verbose || totalFiles > 0) {
    console.log(`[typesugar] dts-transform: ${totalFiles} file(s) modified`);
  }
}

// Run CLI if this module is executed directly
if (typeof require !== "undefined" && require.main === module) {
  cli(process.argv.slice(2));
}
