/**
 * Expression-position comprehension preprocessor.
 *
 * Deliberate exception to the CLAUDE.md "AST over string manipulation" rule:
 *
 * TypeScript's parser produces error-recovered ASTs when a comprehension
 * (`let:/yield:`, `par:/yield:`, ...) appears in expression position with a
 * newline between the host expression and the labeled block:
 *
 *   const fn = (x) =>
 *   let: { ... } yield: { ... }
 *
 * The arrow's body is parsed as the bare identifier `let`, the `yield:` block's
 * `{ user }` becomes an ObjectBindingPattern on a sibling `VariableDeclaration`,
 * and subsequent `name << expr` statements are error-recovered BinaryExpressions.
 * The recovered AST is too fragile to stitch with `ts.factory.update*`.
 *
 * Instead: we parse once with TS, detect the broken-shape AST, re-parse the
 * comprehension text on its own (where it is a clean statement-position
 * `LabeledStatement` + continuation), and use MagicString to move it into
 * statement position, followed by a statement that reads its value through a
 * synthetic tag. `transformCode` then reparses the rewritten source, which now
 * parses without error recovery:
 *
 *   1. Arrow body:     (x) => COMP          → (x) => { COMP; return __letyield_N; }
 *   2. return:         return COMP          → { COMP; return __letyield_N; }
 *                      (same line or next)
 *   3. export default: export default COMP  → COMP; export default __letyield_N;
 *   4. declaration:    const r = COMP       → COMP; const r = __letyield_N;
 *
 * The std `let:`/`par:` macros recognise the tag statement right after the
 * comprehension (`findValueSlot` in std's comprehension-utils.ts) and bind
 * their result to it (`const __letyield_N = <chain>;`); the transformer then
 * collapses `{ const __letyield_N = E; return __letyield_N; }` back into
 * `=> E` / `return E`. Because the comprehension is parsed as an ordinary
 * statement, every form works in every one of these positions: `par:`/`all:`,
 * nested `par:` groups, a `||`/`??` fallback on the first bind, and
 * `yield: <expr>` continuations (docs review 2026-10, A#9/A#10/S#2).
 *
 * `await let:/yield:` is intentionally NOT rewritten — any wrap inside a
 * function body runs into the same stray-`}` problem as iife, and no reliable
 * hoist is available without breaking closure semantics. Users should bind
 * the comprehension to a `const` explicitly and await that.
 */

import * as ts from "typescript";
import MagicString from "magic-string";
import type { RawSourceMap } from "@typesugar/core";

const MAIN_LABELS = new Set(["let", "par", "seq", "all"]);
const CONTINUATION_LABELS = new Set(["yield", "pure", "return", "in"]);

export interface PreprocessDiagnostic {
  /** typesugar error code (e.g. 9223). */
  code: number;
  /** 0-based character offset into the original source. */
  start: number;
  /** Length of the span in characters. */
  length: number;
  message: string;
  severity: "error" | "warning";
}

export interface PreprocessResult {
  source: string;
  /** MagicString-generated source map from rewritten → original. undefined if no rewrites. */
  sourceMap?: RawSourceMap;
  /** Whether any rewrite was performed. */
  changed: boolean;
  /** Preprocessor-emitted diagnostics (e.g. TS9223 for yield: in generators). */
  diagnostics: PreprocessDiagnostic[];
}

/**
 * Detect and rewrite expression-position comprehensions so that subsequent
 * TS parsing produces a shape the transformer can handle.
 */
export function preprocessExpressionComprehensions(
  source: string,
  fileName: string
): PreprocessResult {
  // Fast path: if no main labels appear at all, skip entirely.
  if (!hasPotentialComprehension(source)) {
    return { source, changed: false, diagnostics: [] };
  }

  const diagnostics: PreprocessDiagnostic[] = [];

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true
  );

  const rewrites: Rewrite[] = [];
  let tagCounter = 0;
  const nextTag = () => `__letyield_${tagCounter++}`;

  function visit(node: ts.Node): void {
    // Skip descending into type positions — comprehensions are statements/expressions,
    // never types. This also avoids false positives inside function-type signatures.
    if (isTypeNode(node)) return;

    // TS9223: `yield:` inside a generator function collides with the `yield`
    // keyword, so it won't parse as a continuation label. Detect it here so
    // the user gets a targeted message pointing at `pure:` / `return:` — by
    // the time the macro runs, the `yield:` has already been dropped from
    // the AST (parsed as a bare `yield` expression).
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)) &&
      node.asteriskToken !== undefined &&
      node.body
    ) {
      // The parsed body can end early when the comprehension's stray `}`
      // gets consumed as the generator's closing brace, so we scan from the
      // function's start to the real textual end of its body (via brace
      // balancing on the source), not `node.body.end`.
      const realEnd = findGeneratorBodyEnd(source, node.body.getStart(sourceFile));
      if (realEnd !== -1) {
        for (const span of findYieldLabelsIn(source, node.body.getStart(sourceFile), realEnd)) {
          diagnostics.push({
            code: 9223,
            start: span.start,
            length: span.length,
            message:
              "`yield:` cannot be used as a continuation label inside a generator function. " +
              "Use `pure:` or `return:` instead.",
            severity: "error",
          });
        }
      }
    }

    // Pattern A: arrow body is a bare `let|par|seq|all` Identifier.
    //   (x) => let: {...} yield: {...}
    //   → (x) => { let: {...} yield: {...}; return __tag; }
    if (ts.isArrowFunction(node) && isBrokenCompIdentifier(node.body)) {
      const labelStart = node.body.getStart(sourceFile);
      const comp = parseComprehensionAt(source, labelStart, fileName);
      if (comp) {
        rewrites.push({
          kind: "block-return",
          start: labelStart,
          labelStart,
          comp,
          tag: nextTag(),
        });
      }
    }

    // Pattern C: `export default <Identifier "let|par|seq|all">`
    //   → let: {...} yield: {...}; export default __tag;
    if (
      ts.isExportAssignment(node) &&
      !node.isExportEquals &&
      isBrokenCompIdentifier(node.expression)
    ) {
      const labelStart = node.expression.getStart(sourceFile);
      const comp = parseComprehensionAt(source, labelStart, fileName);
      if (comp) {
        rewrites.push({
          kind: "hoist",
          start: node.getStart(sourceFile),
          labelStart,
          comp,
          tag: nextTag(),
          prefix: "export default ",
        });
      }
    }

    // Pattern B2: `return let: {...} yield: {...}` on ONE line -- parsed as
    // `return let` (the label as an identifier expression).
    //   → { let: {...} yield: {...}; return __tag; }
    if (ts.isReturnStatement(node) && isBrokenCompIdentifier(node.expression)) {
      const labelStart = node.expression.getStart(sourceFile);
      const comp = parseComprehensionAt(source, labelStart, fileName);
      if (comp) {
        rewrites.push({
          kind: "block-return",
          start: node.getStart(sourceFile),
          labelStart,
          comp,
          tag: nextTag(),
        });
      }
    }

    // Pattern D: `const r = let|par|seq|all: {...} <cont>: {...}`.
    //   → let: {...} <cont>: {...}; const r = __tag;
    // (Always hoisted: the transformer's older `const x = let;` merge works
    // on the error-recovered parse and mangles a fallback first bind, a
    // `par:` group, `yield: <expr>`, generics in a bind, … — docs review
    // 2026-10, A#10.)
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.length >= 1 &&
      isBrokenCompIdentifier(node.declarationList.declarations[0].initializer)
    ) {
      const init = node.declarationList.declarations[0].initializer as ts.Identifier;
      const labelStart = init.getStart(sourceFile);
      const comp = parseComprehensionAt(source, labelStart, fileName);
      if (comp) {
        const start = node.getStart(sourceFile);
        rewrites.push({
          kind: "hoist",
          start,
          labelStart,
          comp,
          tag: nextTag(),
          prefix: source.slice(start, labelStart),
        });
      }
    }

    // Pattern B: bare `return;` (no expression, ASI-inserted) immediately followed in
    // the enclosing block by a LabeledStatement whose label is a main-comp label.
    //   return
    //   let: {...} yield: {...}
    //   → { let: {...} yield: {...}; return __tag; }
    if (ts.isReturnStatement(node) && node.expression === undefined) {
      const parent = node.parent;
      if (parent && (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent))) {
        const siblings = parent.statements;
        const idx = siblings.indexOf(node as unknown as ts.Statement);
        if (idx >= 0 && idx + 1 < siblings.length) {
          const next = siblings[idx + 1];
          if (ts.isLabeledStatement(next) && MAIN_LABELS.has(next.label.text)) {
            const labelStart = next.getStart(sourceFile);
            const comp = parseComprehensionAt(source, labelStart, fileName);
            if (comp) {
              rewrites.push({
                kind: "block-return",
                start: node.getStart(sourceFile),
                labelStart,
                comp,
                tag: nextTag(),
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (rewrites.length === 0) {
    return { source, changed: false, diagnostics };
  }

  const s = new MagicString(source);

  // Every rewrite leaves the user's comprehension text untouched, in
  // STATEMENT position (where it parses cleanly), and follows it with a
  // statement that reads its value through the synthetic tag. The std
  // let:/par: macros see that follow-up statement and bind their result to
  // the tag (`const __tag = <chain>;`); the transformer then collapses
  // `{ const __tag = E; return __tag; }` back into `=> E` / `return E`.
  for (const rw of rewrites) {
    const end = rw.comp.end;
    // A separator before the follow-up statement unless the comprehension
    // already ends a statement (`}` of a block, or `;`).
    const last = source[end - 1];
    const sep = last === "}" || last === ";" ? "" : ";";
    switch (rw.kind) {
      case "block-return":
        if (rw.start < rw.labelStart) {
          // `return COMP;` — the `;` closing the return goes inside the block.
          s.overwrite(rw.start, rw.labelStart, "{ ");
          const semi = source.slice(end).match(/^[ \t]*;/);
          s.appendRight(end + (semi ? semi[0].length : 0), `${sep} return ${rw.tag}; }`);
        } else {
          s.prependLeft(rw.labelStart, "{ ");
          s.appendRight(end, `${sep} return ${rw.tag}; }`);
        }
        break;
      case "hoist": {
        s.remove(rw.start, rw.labelStart);
        // Close the moved declaration unless the source already does (`;`)
        // or continues it (`, other = …`).
        const after = source.slice(end).match(/^[ \t]*([;,])?/)?.[1];
        s.appendRight(end, `${sep} ${rw.prefix}${rw.tag}${after ? "" : ";"}`);
        break;
      }
    }
  }

  const rawMap = s.generateMap({ hires: true, source: fileName, includeContent: true });

  return {
    source: s.toString(),
    sourceMap: {
      version: 3,
      sources: rawMap.sources as string[],
      names: rawMap.names as string[],
      mappings: rawMap.mappings as string,
      sourcesContent: rawMap.sourcesContent as string[],
      file: rawMap.file as string | undefined,
    },
    changed: true,
    diagnostics,
  };
}

/**
 * Find the source offset of the generator body's true closing `}` by scanning
 * forward from the opening `{` and balancing braces (with template-literal
 * awareness). Returns -1 if no matching close is found.
 */
function findGeneratorBodyEnd(source: string, openBracePos: number): number {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /*skipTrivia*/ true,
    ts.LanguageVariant.Standard,
    source
  );
  scanner.setTextPos(openBracePos);
  return scanBracedBlock(scanner);
}

/**
 * Scan `source[start..end]` for literal `yield:` followed by a `{`, returning
 * the spans of each hit. Used inside generator function bodies (where `yield:`
 * can't parse as a label) to report TS9223 at the user's intended position.
 */
function findYieldLabelsIn(
  source: string,
  start: number,
  end: number
): Array<{ start: number; length: number }> {
  const hits: Array<{ start: number; length: number }> = [];
  const re = /\byield\s*:\s*\{/g;
  re.lastIndex = Math.max(0, start);
  while (true) {
    const match = re.exec(source);
    if (!match) break;
    if (match.index >= end) break;
    hits.push({ start: match.index, length: "yield".length });
  }
  return hits;
}

// ============================================================================
// Helpers
// ============================================================================

/** A comprehension parsed cleanly in statement position (see parseComprehensionAt). */
interface ParsedComprehension {
  /** End offset (in the original source) of the last labeled block / continuation. */
  end: number;
  main: ts.LabeledStatement;
  continuation?: ts.LabeledStatement;
}

type Rewrite =
  /** `=> COMP` / `return COMP` → `{ COMP; return __tag; }` (from `start`). */
  | {
      kind: "block-return";
      start: number;
      labelStart: number;
      comp: ParsedComprehension;
      tag: string;
    }
  /** `<prefix>COMP` → `COMP; <prefix>__tag` (`export default `, `const r = `). */
  | {
      kind: "hoist";
      start: number;
      labelStart: number;
      comp: ParsedComprehension;
      tag: string;
      prefix: string;
    };

/**
 * Parse the comprehension that starts at `labelStart` the way it parses in
 * STATEMENT position — i.e. parse `source.slice(labelStart)` on its own, where
 * `let: { … }` is a real LabeledStatement and the continuation
 * (`yield: { … }` or `yield: <expr>`) is its sibling. Returns the span and the
 * clean AST, or undefined when the text there is not a comprehension (e.g. a
 * genuine variable named `par`).
 */
function parseComprehensionAt(
  source: string,
  labelStart: number,
  fileName: string
): ParsedComprehension | undefined {
  const sf = ts.createSourceFile(
    fileName,
    source.slice(labelStart),
    ts.ScriptTarget.Latest,
    /*setParentNodes*/ true
  );
  const [main, next] = sf.statements;
  if (
    !main ||
    !ts.isLabeledStatement(main) ||
    !MAIN_LABELS.has(main.label.text) ||
    !ts.isBlock(main.statement) ||
    main.getStart(sf) !== 0
  ) {
    return undefined;
  }
  const continuation =
    next && ts.isLabeledStatement(next) && CONTINUATION_LABELS.has(next.label.text)
      ? next
      : undefined;
  return { end: labelStart + (continuation ?? main).end, main, continuation };
}

function hasPotentialComprehension(source: string): boolean {
  // Cheap prefilter — if no `let:|par:|seq:|all:` substring appears, nothing to do.
  // The scanner-based detection later confirms these are actual labels.
  return /\b(?:let|par|seq|all)\s*:/.test(source);
}

function isBrokenCompIdentifier(node: ts.Node | undefined): node is ts.Identifier {
  return !!node && ts.isIdentifier(node) && MAIN_LABELS.has(node.text);
}

function isTypeNode(node: ts.Node): boolean {
  // Skip TypeNode subtrees — comprehensions don't appear in types, and scanning
  // inside type positions can mislead downstream logic.
  return (
    ts.isTypeNode(node) ||
    node.kind === ts.SyntaxKind.TypeLiteral ||
    node.kind === ts.SyntaxKind.FunctionType ||
    node.kind === ts.SyntaxKind.ConstructorType
  );
}

/**
 * Expect the scanner to be positioned before an `{` token. Consume `{`, balance
 * inner braces, and return the position immediately after the matching `}`.
 * Returns -1 if the shape doesn't match.
 *
 * Handles template literals with substitutions (`` `...${expr}...` ``): when
 * `scan()` returns `TemplateHead`, the closing `}` of each substitution must
 * be consumed via `reScanTemplateToken` so it isn't mistaken for a block close.
 */
function scanBracedBlock(scanner: ts.Scanner): number {
  const open = scanner.scan();
  if (open !== ts.SyntaxKind.OpenBraceToken) return -1;
  let depth = 1;
  while (depth > 0) {
    const tok = scanner.scan();
    if (tok === ts.SyntaxKind.EndOfFileToken) return -1;
    if (tok === ts.SyntaxKind.OpenBraceToken) {
      depth++;
      continue;
    }
    if (tok === ts.SyntaxKind.CloseBraceToken) {
      depth--;
      continue;
    }
    if (tok === ts.SyntaxKind.TemplateHead) {
      if (!consumeTemplateSubstitutions(scanner)) return -1;
      continue;
    }
  }
  return scanner.getTextPos();
}

/**
 * After `TemplateHead`, consume tokens inside each `${…}` substitution and
 * re-scan at each closing `}` so the template literal is consumed as a whole
 * without leaking its internal `{`/`}` into the outer brace-balance counter.
 */
function consumeTemplateSubstitutions(scanner: ts.Scanner): boolean {
  while (true) {
    // Scan the expression inside `${...}` with local brace tracking.
    let innerDepth = 1;
    while (innerDepth > 0) {
      const t = scanner.scan();
      if (t === ts.SyntaxKind.EndOfFileToken) return false;
      if (t === ts.SyntaxKind.OpenBraceToken) innerDepth++;
      else if (t === ts.SyntaxKind.CloseBraceToken) innerDepth--;
      else if (t === ts.SyntaxKind.TemplateHead) {
        if (!consumeTemplateSubstitutions(scanner)) return false;
      }
    }
    // Rescan the just-consumed `}` as a template continuation.
    const cont = scanner.reScanTemplateToken(/*isTaggedTemplate*/ false);
    if (cont === ts.SyntaxKind.TemplateMiddle) continue;
    if (cont === ts.SyntaxKind.TemplateTail) return true;
    return false;
  }
}
