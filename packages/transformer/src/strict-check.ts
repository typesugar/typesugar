/**
 * Type-check the EXPANDED program: `typesugar build` / `check` for the files
 * whose errors the source-level check can't see, `--strict` for every file.
 *
 * The expansion checked is the one the build itself produced (the emit's
 * `captureExpandedSource`, or `expandProgramSources` under `check`), the
 * same text the declarations are emitted from. It used to be a separate
 * expansion of detached re-parsed copies, made before anything else: the
 * macros then asked the checker about nodes of a tree it never bound, which
 * expanded some calls wrongly or not at all (fp's `case Some(v)`), and left
 * errors such as "Cannot find name 's'" for a parameter in the checker's
 * diagnostics for that file name, which the unexpanded program's diagnostics
 * then included. Its diagnostics were also suppression-filtered against the
 * unexpanded program, whose text their positions don't refer to.
 *
 * The expanded text is printed and re-parsed as whole files (as the
 * declaration emit does): this is a second Program over generated source,
 * not macro codegen. Every file whose text is unchanged (lib and
 * node_modules declarations, sources the macros left alone) is the first
 * program's own SourceFile, so only the files the macros changed are parsed
 * and bound again.
 */

import * as ts from "typescript";
import * as path from "path";
import {
  filterDiagnostics,
  getDiagnosticSuppressionRules,
  opaqueTypesAsUnderlying,
  type RawSourceMap,
} from "@typesugar/core";
import { decodeSourceMap } from "@typesugar/transformer-core";
import { createExpandedHost } from "./declarations.js";
import { enclosingSourceSite, sourceTokenLength } from "./generated-diagnostic-site.js";

/**
 * Type-check `rootNames` with `expanded` (absolute path → expanded text of
 * each file the macros changed) in place of the source, every file served in
 * the runtime view of `@opaque` types (`opaqueTypesAsUnderlying`), the view
 * the expanded code is written against. Returns the diagnostics of `files`
 * (absolute paths; every file's, global and option diagnostics included,
 * when absent), suppression-filtered against THAT program: its checker and
 * its source files, the ones the diagnostics' positions refer to.
 *
 * `reuse` is the program the expansion was made from: a file whose served
 * text is the text of its SourceFile there is that SourceFile, not a fresh
 * parse (and `reuse` is the new program's `oldProgram`, so module
 * resolutions carry over too).
 */
export function typecheckExpandedProgram(params: {
  rootNames: readonly string[];
  options: ts.CompilerOptions;
  host: ts.CompilerHost;
  expanded: ReadonlyMap<string, string>;
  reuse?: ts.Program;
  files?: ReadonlySet<string>;
}): ts.Diagnostic[] {
  const base = createExpandedHost(params.host, params.expanded);
  const readFile = (fileName: string): string | undefined => {
    const text = base.readFile(fileName);
    return text === undefined ? undefined : opaqueTypesAsUnderlying(fileName, text);
  };
  const host: ts.CompilerHost = {
    ...base,
    readFile,
    getSourceFile: (fileName, languageVersionOrOptions, onError) => {
      const text = readFile(fileName);
      if (text === undefined) {
        onError?.(`Cannot read file '${fileName}'.`);
        return undefined;
      }
      const old = params.reuse?.getSourceFile(fileName);
      if (old && old.text === text) return old;
      return ts.createSourceFile(fileName, text, languageVersionOrOptions, true);
    },
  };
  const program = ts.createProgram(
    params.rootNames,
    { ...params.options, noEmit: true },
    host,
    params.reuse
  );
  let diagnostics: ts.Diagnostic[];
  if (params.files) {
    diagnostics = [];
    for (const sf of program.getSourceFiles()) {
      if (!params.files.has(path.resolve(sf.fileName))) continue;
      diagnostics.push(
        ...program.getSyntacticDiagnostics(sf),
        ...program.getSemanticDiagnostics(sf)
      );
    }
  } else {
    diagnostics = [...ts.getPreEmitDiagnostics(program)];
  }

  if (getDiagnosticSuppressionRules().length === 0) return diagnostics;
  try {
    return filterDiagnostics(
      diagnostics,
      program.getTypeChecker(),
      (fn) => program.getSourceFile(fn),
      { program }
    );
  } catch (e: unknown) {
    console.error(
      `🧊 Warning: diagnostic suppression filtering of the expanded program's diagnostics skipped — ${
        e instanceof Error ? e.message : String(e)
      }`
    );
    return diagnostics;
  }
}

/** Generated → source offsets of one expanded file's mapped tokens, sorted by generated offset. */
interface ExpandedFileMap {
  generated: number[];
  original: number[];
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function buildFileMap(
  map: RawSourceMap,
  expandedText: string,
  originalText: string
): ExpandedFileMap {
  const decoded = decodeSourceMap(map);
  const genStarts = lineStarts(expandedText);
  const origStarts = lineStarts(originalText);
  const pairs: Array<[number, number]> = [];
  decoded.mappings.forEach((segments, line) => {
    if (line >= genStarts.length) return;
    for (const s of segments) {
      if (s.sourceLine === undefined || s.sourceColumn === undefined) continue;
      if (s.sourceLine >= origStarts.length) continue;
      pairs.push([genStarts[line] + s.generatedColumn, origStarts[s.sourceLine] + s.sourceColumn]);
    }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const fileMap: ExpandedFileMap = { generated: [], original: [] };
  for (const [g, o] of pairs) {
    if (fileMap.generated[fileMap.generated.length - 1] === g) continue;
    fileMap.generated.push(g);
    fileMap.original.push(o);
  }
  return fileMap;
}

/** Index of the first entry of the sorted `xs` that is >= `x`. */
function lowerBound(xs: readonly number[], x: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The source offset of the generated offset `pos` of `file`, as the editor's
 * position mapper finds it (position-mapping-core.ts `toOriginal`): from the
 * last mapped token at or before it on its line, the same distance on; none
 * when nothing before it on its line is mapped.
 */
function toOriginal(fm: ExpandedFileMap, file: ts.SourceFile, pos: number): number | undefined {
  const lineStart = pos - file.getLineAndCharacterOfPosition(pos).character;
  const i = lowerBound(fm.generated, pos + 1) - 1;
  if (i < 0 || fm.generated[i] < lineStart) return undefined;
  return fm.original[i] + (pos - fm.generated[i]);
}

/**
 * Diagnostics of the expanded program (`typecheckExpandedProgram`), moved
 * from the expanded text to the program's own source files (`program`, the
 * one the expansion was made from), through each file's source map (`maps`,
 * from `captureExpandedSource`).
 *
 * A diagnostic is placed at the first token of its span that came from the
 * source: its own start when that token did (`user.nme`'s `nme`), else a
 * source token inside it (a generated call is placed at the user's
 * expression it wraps). A macro that gives its output the call site's
 * position (`setTextRange`) has its generated tokens placed there. A
 * diagnostic with no source token in its span is in generated code: it is
 * placed at the nearest node around it that has one (an `@impl` instance's
 * generated `satisfies` is reported at the instance's initializer;
 * generated-diagnostic-site.ts, which the editor uses too). Only one whose
 * whole statement is generated is `unmapped`: the caller decides (plain
 * check drops it, `--strict` reports it in the expanded text). One in a file
 * the macros didn't change is already at its source position.
 */
export function mapExpandedDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  params: {
    program: ts.Program;
    expanded: ReadonlyMap<string, string>;
    maps: ReadonlyMap<string, () => RawSourceMap | null>;
  }
): { mapped: ts.Diagnostic[]; unmapped: ts.Diagnostic[] } {
  const fileMaps = new Map<string, ExpandedFileMap | null>();
  const fileMapOf = (resolved: string, original: ts.SourceFile): ExpandedFileMap | null => {
    let fm = fileMaps.get(resolved);
    if (fm === undefined) {
      const map = params.maps.get(resolved)?.();
      const text = params.expanded.get(resolved);
      fm = map && text !== undefined ? buildFileMap(map, text, original.text) : null;
      fileMaps.set(resolved, fm);
    }
    return fm;
  };

  const mapped: ts.Diagnostic[] = [];
  const unmapped: ts.Diagnostic[] = [];
  for (const d of diagnostics) {
    if (!d.file || d.start === undefined) {
      mapped.push(d);
      continue;
    }
    const resolved = path.resolve(d.file.fileName);
    const original = params.program.getSourceFile(d.file.fileName);
    if (!params.expanded.has(resolved) || !original) {
      // Not a file the macros changed: its position is a source position
      // (its SourceFile is the program's own unless @opaque rewrote it).
      mapped.push(original && original.text === d.file.text ? { ...d, file: original } : d);
      continue;
    }
    const fm = fileMapOf(resolved, original);
    if (!fm) {
      unmapped.push(d);
      continue;
    }
    const length = Math.max(d.length ?? 0, 1);
    const i = lowerBound(fm.generated, d.start);
    if (i >= fm.generated.length || fm.generated[i] >= d.start + length) {
      // Only generated code in its span: at the nearest node around it that
      // came from the source (the language service does the same).
      const file = d.file;
      const start = enclosingSourceSite(ts, file, d.start, (s) => toOriginal(fm, file, s));
      if (start === undefined) {
        unmapped.push(d);
        continue;
      }
      mapped.push({
        ...d,
        file: original,
        start,
        length: sourceTokenLength(original.text, start),
      });
      continue;
    }
    const start = fm.original[i];
    const spanText = d.file.text.slice(d.start, d.start + (d.length ?? 0));
    // Keep the length where the source has the same text there (the usual
    // case: the expansion reuses the user's node); else mark the token.
    let len = d.length;
    if (
      fm.generated[i] !== d.start ||
      original.text.slice(start, start + spanText.length) !== spanText
    ) {
      const word = /^[\w$]+/.exec(original.text.slice(start));
      len = word ? word[0].length : 1;
    }
    mapped.push({ ...d, file: original, start, length: len });
  }
  return { mapped, unmapped };
}

/**
 * The rules whose suppression leaves the source-level check blind to code
 * the expansion makes checkable: they hide "Cannot find name" for the names
 * a construct binds (a comprehension's steps, a `match:` case's pattern, an
 * `ensures:` block's `result`, a fluent `match()` chain's patterns), so every
 * use of those names is unchecked as written. Matched by rule name, the
 * registry's key.
 *
 * A fluent `match()` reads a scrutinee TypeScript has narrowed at its
 * declared type (std's match.ts `scrutineeReading`), so its expansion
 * type-checks as the chain was written: a `.case` for a variant the value
 * can't be at that point is not TS2678 there.
 */
const BLIND_SPOT_RULES = new Set([
  "ComprehensionBlock",
  "MatchSwitch",
  "ContractBlock",
  "MacroCallChain",
]);

/** The chain methods of a fluent `match()` (std's match.ts parseArms). */
const MATCH_CHAIN_METHODS = new Set(["case", "or", "as", "if", "then", "else"]);

/**
 * When `call` is a link of a fluent chain `m(x).case(p).then(r)...` (not the
 * root call itself), the name its root call calls; by syntax only. The
 * MacroCallChain rule has already decided, by symbol, that the chain is
 * typesugar's `match`; this only finds the chain's extent.
 */
function chainRootName(call: ts.CallExpression): string | undefined {
  let expr: ts.Expression = call;
  let links = 0;
  while (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee)) return links > 0 ? callee.text : undefined;
    if (!ts.isPropertyAccessExpression(callee) || !MATCH_CHAIN_METHODS.has(callee.name.text)) {
      return undefined;
    }
    links++;
    expr = callee.expression;
  }
  return undefined;
}

/**
 * The outermost fluent chain around `node` rooted at the same name as the
 * innermost one (a `match()` in another's arm is inside it; `fetch(u).then(...)`
 * around a `match()` is not part of it).
 */
function enclosingMatchChain(node: ts.Node): ts.CallExpression | undefined {
  let name: string | undefined;
  let outermost: ts.CallExpression | undefined;
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (!ts.isCallExpression(n)) continue;
    const root = chainRootName(n);
    if (root === undefined) continue;
    if (name === undefined) name = root;
    if (root === name) outermost = n;
  }
  return outermost;
}

/** Continuation labels: the statement after a comprehension's block that belongs to it. */
const CONTINUATION_LABELS = new Set(["yield", "pure", "return"]);

function deepestNodeAt(sf: ts.SourceFile, pos: number): ts.Node {
  let node: ts.Node = sf;
  for (;;) {
    const child = node.forEachChild((c) => (c.pos <= pos && pos < c.end ? c : undefined));
    if (!child) return node;
    node = child;
  }
}

function statementsOf(node: ts.Node): readonly ts.Statement[] | undefined {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) return node.statements;
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return node.statements;
  return undefined;
}

/**
 * For each file, the spans (in the text of the diagnostics' SourceFiles) of
 * the constructs where a {@link BLIND_SPOT_RULES} rule hid a diagnostic: the
 * outermost labeled statement around it, with its comprehension's
 * continuation (or, for a continuation, its block); for MacroCallChain, the
 * outermost fluent `match()` chain around it. The
 * expanded check reports only what lies in these spans: elsewhere the source
 * check already saw the code, and the expansion may differ from it in ways
 * that are not errors in what the user wrote.
 */
export function blindSpotRegions(
  suppressed: ReadonlyArray<{ diagnostic: ts.Diagnostic; rule: string }>
): Map<string, Array<[number, number]>> {
  const regions = new Map<string, Array<[number, number]>>();
  for (const { diagnostic: d, rule } of suppressed) {
    if (!BLIND_SPOT_RULES.has(rule) || !d.file || d.start === undefined) continue;
    const sf = d.file;
    if (rule === "MacroCallChain") {
      // A fluent chain is an expression: the region is the whole chain.
      const chain = enclosingMatchChain(deepestNodeAt(sf, d.start));
      if (!chain) continue;
      const key = path.resolve(sf.fileName);
      const list = regions.get(key) ?? [];
      list.push([chain.getStart(sf), chain.end]);
      regions.set(key, list);
      continue;
    }
    let labeled: ts.LabeledStatement | undefined;
    for (let n: ts.Node | undefined = deepestNodeAt(sf, d.start); n; n = n.parent) {
      if (ts.isLabeledStatement(n)) labeled = n;
    }
    if (!labeled) continue;
    let first: ts.Statement = labeled;
    let last: ts.Statement = labeled;
    const siblings = labeled.parent ? statementsOf(labeled.parent) : undefined;
    if (siblings) {
      const i = siblings.indexOf(labeled);
      const isContinuation = (s: ts.Statement | undefined): s is ts.LabeledStatement =>
        s !== undefined && ts.isLabeledStatement(s) && CONTINUATION_LABELS.has(s.label.text);
      if (isContinuation(labeled) && i > 0 && ts.isLabeledStatement(siblings[i - 1])) {
        first = siblings[i - 1];
      } else if (isContinuation(siblings[i + 1])) {
        last = siblings[i + 1];
      }
    }
    const key = path.resolve(sf.fileName);
    const list = regions.get(key) ?? [];
    list.push([first.getStart(sf), last.end]);
    regions.set(key, list);
  }
  return regions;
}

/** The JSDoc tags that make a declaration a typeclass instance (`@impl` and its alias). */
const INSTANCE_TAGS = new Set(["impl", "instance"]);

/**
 * For each source file of `program`, the spans of its `@impl` (`@instance`)
 * instance declarations: an unannotated instance is checked against its
 * typeclass only in the expansion, which `satisfies` the typeclass's expanded
 * type (typeclass.ts `asOpenSatisfiesTarget`), so the source-level check
 * can't see a missing or misspelled member. By syntax: which JSDoc tag a
 * statement has (the macro itself decides, by symbol, what the instance is
 * for).
 */
export function instanceRegions(program: ts.Program): Map<string, Array<[number, number]>> {
  const regions = new Map<string, Array<[number, number]>>();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !/@(impl|instance)\b/.test(sf.text)) continue;
    const spans: Array<[number, number]> = [];
    const visit = (statements: readonly ts.Statement[]): void => {
      for (const st of statements) {
        if (ts.isModuleDeclaration(st)) {
          let body = st.body;
          while (body && ts.isModuleDeclaration(body)) body = body.body;
          if (body && ts.isModuleBlock(body)) visit(body.statements);
          continue;
        }
        if (!ts.isVariableStatement(st)) continue;
        if (ts.getJSDocTags(st).some((t) => INSTANCE_TAGS.has(t.tagName.text))) {
          spans.push([st.getStart(sf), st.end]);
        }
      }
    };
    visit(sf.statements);
    if (spans.length > 0) regions.set(path.resolve(sf.fileName), spans);
  }
  return regions;
}

/**
 * Where the expanded check reports, by default: the constructs whose bound
 * names the suppression filter hid ({@link blindSpotRegions}), and the
 * `@impl` instances ({@link instanceRegions}).
 */
export function expandedCheckRegions(
  suppressed: ReadonlyArray<{ diagnostic: ts.Diagnostic; rule: string }>,
  program: ts.Program
): Map<string, Array<[number, number]>> {
  const regions = blindSpotRegions(suppressed);
  for (const [file, spans] of instanceRegions(program)) {
    regions.set(file, [...(regions.get(file) ?? []), ...spans]);
  }
  return regions;
}

/** Is `d` (positioned in its file's source text) inside one of `regions`? */
export function inBlindSpot(
  d: ts.Diagnostic,
  regions: ReadonlyMap<string, ReadonlyArray<[number, number]>>
): boolean {
  if (!d.file || d.start === undefined) return false;
  const spans = regions.get(path.resolve(d.file.fileName));
  return spans !== undefined && spans.some(([s, e]) => s <= d.start! && d.start! < e);
}
