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
 * Instead: we parse once with TS, detect the broken-shape AST, use MagicString
 * to rewrite the source (wrapping the bad expression-position usage in a block
 * that binds the comprehension to a synthetic const), and let `transformCode`
 * reparse the rewritten source. After the rewrite, TS's normal ASI path kicks
 * in and the existing `const x = let;`-merge path in the transformer handles
 * the inner `const __letyield_N = let: {...} yield: {...}` pattern.
 *
 * Three patterns are handled:
 *   1. Arrow body:     (x) =>              let: {...} yield: {...}
 *   2. return + comp:  return              let: {...} yield: {...}
 *   3. export default: export default      let: {...} yield: {...}
 *
 * Arrow and return wrap with a double `{ { … } }` Block; the inner Block absorbs
 * the stray `}` from the user's `let:` block so the trailing `yield:` parses as
 * a sibling of the broken VariableStatement (the existing merge's input shape).
 * The transformer then flattens the synthesized Block and simplifies the body.
 *
 * `export default` hoists instead: the comprehension moves to a top-level
 * `const __letyield_N = let: {...} yield: {...}` and the export references the
 * new name. Hoisting works because the existing merge handles the broken VarStmt
 * at SourceFile level (where a stray `}` is an error but doesn't corrupt
 * surrounding expressions, as it would inside a ParenthesizedExpression/IIFE).
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
    if (ts.isArrowFunction(node) && isBrokenCompIdentifier(node.body)) {
      const span = findLabeledBlockSpan(source, node.body.end);
      if (span) {
        const tag = nextTag();
        rewrites.push({
          kind: "arrow",
          wrapStart: (node.body as ts.Identifier).getStart(sourceFile),
          wrapEnd: span.end,
          tag,
        });
      }
    }

    // Pattern C: `export default <Identifier "let|par|seq|all">` — hoist the
    // comprehension to a top-level `const __letyield_N = …` and rewrite the
    // export to reference that name. An IIFE wrap here would work, but TS's
    // error-recovery inside `(() => { … })()` eats one too many `}`s and
    // detaches the trailing `()`, leaving the function uninvoked.
    if (
      ts.isExportAssignment(node) &&
      !node.isExportEquals &&
      isBrokenCompIdentifier(node.expression)
    ) {
      const span = findLabeledBlockSpan(source, node.expression.end);
      if (span) {
        const tag = nextTag();
        rewrites.push({
          kind: "export-default-hoist",
          exportStart: node.getStart(sourceFile),
          letStart: (node.expression as ts.Identifier).getStart(sourceFile),
          wrapEnd: span.end,
          tag,
        });
      }
    }

    // Pattern B: bare `return;` (no expression, ASI-inserted) immediately followed in
    // the enclosing block by a LabeledStatement whose label is a main-comp label.
    if (ts.isReturnStatement(node) && node.expression === undefined) {
      const parent = node.parent;
      if (parent && (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent))) {
        const siblings = parent.statements;
        const idx = siblings.indexOf(node as unknown as ts.Statement);
        if (idx >= 0 && idx + 1 < siblings.length) {
          const next = siblings[idx + 1];
          if (ts.isLabeledStatement(next) && MAIN_LABELS.has(next.label.text)) {
            // Find the full span including any continuation labels after `next`.
            const span = findLabeledBlockSpanFromLabeled(source, next);
            if (span) {
              const tag = nextTag();
              rewrites.push({
                kind: "return",
                returnStart: node.getStart(sourceFile),
                labelStart: next.getStart(sourceFile),
                wrapEnd: span.end,
                tag,
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

  for (const rw of rewrites) {
    // The INNER `{ ... }` around `const __tag = let: {...} yield: {...}; return __tag;`
    // is load-bearing: TypeScript's error-recovery parses the broken
    // `const __tag = let: { first-bind-name << ...` shape as a two-decl
    // VariableStatement whose ObjectBindingPattern ends implicitly (no `}`
    // consumed). The real `}` that closes the user's `let:` block would
    // otherwise close the *enclosing* function/arrow block, orphaning the
    // trailing `yield: { ... }`. An extra Block wrapper absorbs that `}` so
    // the subsequent `yield:`/`return` parse as siblings of the broken
    // VariableStatement — the shape the existing const-x-equals-let merge in
    // `transformer/src/index.ts` expects.
    switch (rw.kind) {
      case "arrow":
        // (x) => let: {...} yield: {...}
        // → (x) => { { const __tag = let: {...} yield: {...}; return __tag; } }
        s.prependLeft(rw.wrapStart, `{ { const ${rw.tag} = `);
        s.appendRight(rw.wrapEnd, `; return ${rw.tag}; } }`);
        break;
      case "export-default-hoist":
        // export default\n let: {...} yield: {...}
        // → const __tag = let: {...} yield: {...};\nexport default __tag;
        s.overwrite(rw.exportStart, rw.letStart, `const ${rw.tag} = `);
        s.appendRight(rw.wrapEnd, `;\nexport default ${rw.tag};`);
        break;
      case "return":
        // return\n let: {...} yield: {...}
        // → { { const __tag = let: {...} yield: {...}; return __tag; } }
        s.overwrite(rw.returnStart, rw.labelStart, `{ { const ${rw.tag} = `);
        s.appendRight(rw.wrapEnd, `; return ${rw.tag}; } }`);
        break;
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

type Rewrite =
  | { kind: "arrow"; wrapStart: number; wrapEnd: number; tag: string }
  | { kind: "return"; returnStart: number; labelStart: number; wrapEnd: number; tag: string }
  | {
      kind: "export-default-hoist";
      exportStart: number;
      letStart: number;
      wrapEnd: number;
      tag: string;
    };

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
 * Given a position just after a parsed `let|par|seq|all` identifier, scan
 * forward with ts.createScanner and confirm the source actually contains
 * `: { ... }` followed by zero or more `<contLabel>: { ... }` blocks. Returns
 * the end position of the last labeled block, or undefined if the shape
 * doesn't match (e.g., genuine `let` variable reference).
 */
function findLabeledBlockSpan(source: string, startPos: number): { end: number } | undefined {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /*skipTrivia*/ true,
    ts.LanguageVariant.Standard,
    source
  );
  scanner.setTextPos(startPos);

  // Expect `:` immediately after the label identifier.
  let tok = scanner.scan();
  if (tok !== ts.SyntaxKind.ColonToken) return undefined;

  // Expect `{` and balance braces.
  const firstEnd = scanBracedBlock(scanner);
  if (firstEnd === -1) return undefined;
  let lastEnd = firstEnd;

  // Zero or more continuation labels: `yield: { ... }`, `pure: { ... }`, etc.
  while (true) {
    const savedPos = scanner.getTextPos();
    const nextTok = scanner.scan();
    if (!isContinuationLabelToken(nextTok, scanner)) {
      scanner.setTextPos(savedPos);
      break;
    }
    const colon = scanner.scan();
    if (colon !== ts.SyntaxKind.ColonToken) {
      scanner.setTextPos(savedPos);
      break;
    }
    const contEnd = scanBracedBlock(scanner);
    if (contEnd === -1) break;
    lastEnd = contEnd;
  }

  return { end: lastEnd };
}

/**
 * Variant for when we already have the parsed LabeledStatement for the main
 * block — we use the main block's end position as the scan start, and look
 * for continuation labels after it.
 */
function findLabeledBlockSpanFromLabeled(
  source: string,
  labeled: ts.LabeledStatement
): { end: number } | undefined {
  let end = labeled.end;

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /*skipTrivia*/ true,
    ts.LanguageVariant.Standard,
    source
  );
  scanner.setTextPos(end);

  while (true) {
    const savedPos = scanner.getTextPos();
    const nextTok = scanner.scan();
    if (!isContinuationLabelToken(nextTok, scanner)) {
      scanner.setTextPos(savedPos);
      break;
    }
    const colon = scanner.scan();
    if (colon !== ts.SyntaxKind.ColonToken) {
      scanner.setTextPos(savedPos);
      break;
    }
    const contEnd = scanBracedBlock(scanner);
    if (contEnd === -1) break;
    end = contEnd;
  }

  return { end };
}

/**
 * Check whether the current token is one of our continuation labels.
 *
 * `yield`, `return`, and `in` come back from the scanner as keyword tokens
 * (not Identifier), so we dispatch on kind rather than matching scanner
 * output text against a string set.
 */
function isContinuationLabelToken(tok: ts.SyntaxKind, scanner: ts.Scanner): boolean {
  if (tok === ts.SyntaxKind.YieldKeyword) return true;
  if (tok === ts.SyntaxKind.ReturnKeyword) return true;
  if (tok === ts.SyntaxKind.InKeyword) return true;
  if (tok === ts.SyntaxKind.Identifier) {
    return CONTINUATION_LABELS.has(scanner.getTokenValue());
  }
  return false;
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
