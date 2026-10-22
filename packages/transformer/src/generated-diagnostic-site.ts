/**
 * Where in the source to report a diagnostic TypeScript found in
 * macro-generated code: a position in the expanded text that no source-map
 * segment covers (an `@impl` instance's generated `satisfies`, a helper call
 * a macro wrapped around the user's expression).
 *
 * Shared by the editor (language-service.ts) and the CLI's expanded check
 * (strict-check.ts), so both put such a diagnostic at the same place instead
 * of dropping it: the nearest node around it that came from the source.
 *
 * Takes the TypeScript module as a parameter: the language-service plugin
 * runs against the editor's own TypeScript, not the one this package imports.
 */

import type * as ts from "typescript";

/** The nodes of `sf` whose span contains `pos`, outermost (`sf`) first. */
function nodesAt(tsm: typeof ts, sf: ts.SourceFile, pos: number): ts.Node[] {
  // A top-down walk by position, not `node.parent`: the editor's syntactic
  // diagnostics come from a file that may not be bound yet.
  const nodes: ts.Node[] = [sf];
  let node: ts.Node = sf;
  for (;;) {
    const child = tsm.forEachChild(node, (c) => (c.pos <= pos && pos < c.end ? c : undefined));
    if (!child) return nodes;
    nodes.push(child);
    node = child;
  }
}

/**
 * A node whose span is a list of statements: a source token inside one
 * belongs to some other statement, not to the generated code at hand, so the
 * walk goes past it to the construct that owns it (the function, the `if`).
 */
function isStatementList(tsm: typeof ts, n: ts.Node): boolean {
  return (
    tsm.isSourceFile(n) ||
    tsm.isBlock(n) ||
    tsm.isModuleBlock(n) ||
    tsm.isCaseBlock(n) ||
    tsm.isCaseClause(n) ||
    tsm.isDefaultClause(n)
  );
}

/**
 * For a diagnostic at `pos` in the generated text `sf`: walking out from the
 * innermost node containing `pos`, the first node (not a statement list, nor
 * the file) for which `site(start, end)` (the node's span in `sf`, leading
 * trivia excluded) finds a source position; that result, or `undefined` when
 * no enclosing node came from the source (the whole statement is generated).
 */
export function enclosingSourceSite<T>(
  tsm: typeof ts,
  sf: ts.SourceFile,
  pos: number,
  site: (start: number, end: number) => T | undefined
): T | undefined {
  const nodes = nodesAt(tsm, sf, pos);
  for (let k = nodes.length - 1; k >= 1; k--) {
    const n = nodes[k];
    if (isStatementList(tsm, n)) continue;
    const found = site(n.getStart(sf), n.end);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The length to mark at `start` of the source `text`: the word there, else one character. */
export function sourceTokenLength(text: string, start: number): number {
  const word = /^[\w$]+/.exec(text.slice(start, start + 256));
  return word ? word[0].length : 1;
}
