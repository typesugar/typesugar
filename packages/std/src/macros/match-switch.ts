/**
 * `match:` — the statement form of pattern matching (Turf case study, F21).
 *
 * The fluent `match(x).case(p).then(e)` chain is an expression: an arm can't
 * loop, `return` from the enclosing function, `break`, `continue` or `throw`.
 * Traversal code is full of switches whose arms do exactly that. A `match:`
 * label on a switch keeps the switch — every arm body stays in place, with
 * plain switch control flow — and adds the match checks and patterns:
 *
 * ```ts
 * import "@typesugar/std/syntax/match";
 *
 * match: switch (geom.type) {            // literal cases: the same switch,
 *   case "Point": ...; break;            // checked for exhaustiveness
 *   case "LineString": ...; break;
 * }
 *
 * match: switch (geom) {                 // patterns on the whole value
 *   case { type: "Point", coordinates: [x, y] }:
 *     draw(x, y);
 *     break;
 *   case { type: "LineString", coordinates }:
 *     for (const c of coordinates) ...;
 *     break;
 * }
 * ```
 *
 * Output:
 * - **Literal cases** (literals, constants, enum members): the switch itself,
 *   label removed. Nothing is added, so the JavaScript is the hand-written
 *   switch. (In every form, the label is kept when a case uses `break match;`.)
 * - **Patterns sharing one discriminant** (`{ type: "Point", ... }`, or a
 *   `_tag`/`ok`-tagged built-in extractor such as Effect's `Some(v)`):
 *   `switch (geom.type) { case "Point": { const [x, y] = geom.coordinates; ... } }`.
 * - **Anything else** (fp's untagged `Some(v)`/`None`, `case null` next to
 *   object patterns, patterns without a shared discriminant):
 *   `switch (true) { case geom != null && geom.type === "Point": { ... } }` —
 *   an if/else chain that keeps switch semantics (break, fallthrough).
 *
 * Below the discriminant, literals, extractors, type tests and regexes TEST
 * (PEP-065 D1-a), reading nested values with `?.`; object and array shapes
 * with none of those inside DESTRUCTURE: `coordinates: [x, y]` reads the
 * first two elements whatever the length, as `const [x, y] =
 * geom.coordinates` does, and `[x, y, ...[]]` opts into an exact length.
 * A case that tests below its discriminant compiles to `switch (true)`.
 *
 * A guard is `case P && cond:` (PEP-065): a top-level `&&` in a label is
 * always a guard, `P` being the left-most operand. A failing guard tries the
 * next case. The guard runs before the case's bindings exist, so the names P
 * binds are read in it from where they come from (`w` → `s.w`). Any guard
 * puts the switch in the `switch (true)` form, and a guarded case covers
 * nothing for exhaustiveness. `case _ && cond:` is a guard alone.
 *
 * Case labels are literals, constants (`C`, `Dir.Up`) or patterns
 * (PEP-065). Anything else, a value computed at run time (`case f(x):` where
 * `f` has no extractor and is not a class, `case a + 1:`), is a compile
 * error, as in Scala; it used to compile as a value case whose bound names
 * threw ReferenceError.
 *
 * `default:` covers the remaining values and turns the exhaustiveness check
 * off, as `.else()` does, except a `default:` that only throws: that is a
 * runtime safety net for values outside the type, so the check still runs.
 * A `default:` that does more than throw, when the cases already cover the
 * type, is reported as unreachable.
 */

import * as ts from "typescript";
import {
  defineLabeledBlockMacro,
  globalRegistry,
  isSyntheticNode,
  type MacroContext,
} from "@typesugar/core";
import {
  analyzePattern,
  buildCondition,
  calleeKind,
  findMissingCases,
  getLiteralValueFromType,
  getPatternLiteralKey,
  getScrutineeAnalysis,
  getScrutineeType,
  isGuaranteedObject,
  literalCheck,
  nullishKeyOfType,
  reportMissingCases,
  withBuiltinExtractorsFor,
  payloadAccess,
  type MatchCoverage,
  type PatternInfo,
} from "./match.js";

const DEFAULT_FALLBACK = "a default: clause";

/**
 * A case clause, by what its label is. `label` is the label without its
 * guard (and parentheses); `guard` is the condition after `&&` (PEP-065).
 */
type Clause =
  | { kind: "value"; clause: ts.CaseClause; label: ts.Expression; guard?: ts.Expression }
  | {
      kind: "pattern";
      clause: ts.CaseClause;
      label: ts.Expression;
      pattern: PatternInfo;
      guard?: ts.Expression;
    }
  /** `case _ && cond:`: no test of its own, only the guard. */
  | { kind: "wildcard"; clause: ts.CaseClause; guard: ts.Expression }
  | { kind: "default"; clause: ts.DefaultClause };

/**
 * Split a guarded label `P && g1 && g2` into the pattern (the left-most
 * operand of the `&&` chain) and the guard (the rest, joined with `&&`). A
 * top-level `&&` in a case label is always a guard: `&&` is not a pattern
 * operator.
 */
function splitGuard(
  f: ts.NodeFactory,
  expr: ts.Expression
): { label: ts.Expression; guard?: ts.Expression } {
  const e = unparen(expr);
  if (!isAnd(e)) return { label: e };
  const conditions: ts.Expression[] = [];
  let left: ts.Expression = e;
  while (isAnd(left)) {
    conditions.unshift(left.right);
    left = unparen(left.left);
  }
  const guard = conditions.reduce((a, b) =>
    f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
  );
  return { label: left, guard };
}

function isAnd(e: ts.Expression): e is ts.BinaryExpression {
  return ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
}

function isWildcard(e: ts.Expression): boolean {
  return ts.isIdentifier(e) && e.text === "_";
}

/**
 * A pattern case: an object or array pattern, a call to an extractor
 * (`Some(v)`) or a type test (`String(s)`, `Date(d)`, a class), or a regex.
 */
function isPatternSyntax(expr: ts.Expression): boolean {
  if (ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)) return true;
  if (expr.kind === ts.SyntaxKind.RegularExpressionLiteral) return true;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    const kind = analyzePattern(expr).kind;
    return kind === "extractor" || kind === "type-constructor";
  }
  return false;
}

/** `None` / `Nil`: a pattern in a switch that has other patterns, a value otherwise. */
function isZeroArgExtractor(expr: ts.Expression): boolean {
  if (!ts.isIdentifier(expr)) return false;
  return analyzePattern(expr).kind === "extractor";
}

/** `e` without the parentheses around it (`case ("a"):` is the label `"a"`). */
function unparen(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

/** `a`, `a.b.c`, `this.a`: a constant compared with `===` (no calls, no `?.`). */
function isConstantName(e: ts.Expression): boolean {
  if (ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword) return true;
  return ts.isPropertyAccessExpression(e) && !e.questionDotToken && isConstantName(e.expression);
}

/** The source text of `node` for a message (a synthetic node has none). */
function sourceText(node: ts.Node): string {
  return isSyntheticNode(node) ? "this value" : node.getText();
}

/**
 * Why a case label is not a literal, a constant or a pattern (PEP-065), or
 * undefined when it is one. A label that is none of these used to compile as
 * a value case compared with `===`, and the names it binds threw
 * ReferenceError at run time; Scala rejects the same shapes (a pattern call
 * needs an extractor, a value must be a stable identifier).
 */
function labelProblem(
  f: ts.NodeFactory,
  expr: ts.Expression,
  scrutinee: ts.Expression
): string | undefined {
  const { label: e, guard } = splitGuard(f, expr);
  if (isPatternSyntax(e)) return undefined;
  if (isWildcard(e)) {
    return guard ? undefined : "match: `case _:` matches every value; write `default:` instead.";
  }
  if (isConstantName(e) || ts.isNoSubstitutionTemplateLiteral(e)) return undefined;
  let note = "";
  if (ts.isCallExpression(e)) {
    const pattern = analyzePattern(e);
    if (pattern.kind === "unsupported" && ts.isIdentifier(e.expression)) {
      // A constructor called wrongly (two arguments, no Destructure
      // instance) is a pattern with a problem; anything else is a value.
      const kind = calleeKind(e.expression);
      if (kind === "constructor" || kind === "unknown") {
        return `match: ${pattern.reason ?? "unsupported pattern in a match: switch"}`;
      }
      note = ` (\`${e.expression.text}\` has no extractor and is not a class)`;
    }
  } else if (analyzePattern(e).kind === "literal") {
    return undefined;
  }
  const text = sourceText(e);
  const named = ts.isIdentifier(scrutinee) || scrutinee.kind === ts.SyntaxKind.ThisKeyword;
  const inGuard = named
    ? `test it in a guard: \`case _ && ${sourceText(scrutinee)} === ${text}:\``
    : `name the scrutinee (\`const v = ${sourceText(scrutinee)};\` and \`match: switch (v)\`) ` +
      `and test it in a guard: \`case _ && v === ${text}:\``;
  return (
    `match: a case in a match: switch is a literal, a constant or a pattern; \`${text}\` is ` +
    `none of these${note}. Bind the value to a const (\`const c = ${text};\` and \`case c:\`), ` +
    `or ${inGuard}.`
  );
}

function classify(f: ts.NodeFactory, sw: ts.SwitchStatement): Clause[] {
  const raw = sw.caseBlock.clauses;
  const split = new Map(
    raw.flatMap((c) => (ts.isCaseClause(c) ? [[c, splitGuard(f, c.expression)] as const] : []))
  );
  const patternMode = [...split.values()].some(({ label }) => isPatternSyntax(label));
  return raw.map((clause): Clause => {
    if (ts.isDefaultClause(clause)) return { kind: "default", clause };
    const { label, guard } = split.get(clause)!;
    if (guard && isWildcard(label)) return { kind: "wildcard", clause, guard };
    if (isPatternSyntax(label) || (patternMode && isZeroArgExtractor(label))) {
      return { kind: "pattern", clause, label, pattern: analyzePattern(label), guard };
    }
    return { kind: "value", clause, label, guard };
  });
}

/** The key (in match.ts's literal-key form) a value case covers, if it is one value. */
function valueKey(ctx: MacroContext, expr: ts.Expression): string | undefined {
  const asPattern = analyzePattern(unparen(expr));
  if (asPattern.kind === "literal") return getPatternLiteralKey(asPattern);
  if (isSyntheticNode(expr)) return undefined;
  try {
    const type = ctx.getTypeOf(expr);
    return getLiteralValueFromType(type) ?? nullishKeyOfType(type);
  } catch {
    // A constant whose type can't be read covers nothing; the check may then
    // report a member as missing, which the user can see and fix.
    return undefined;
  }
}

/** Does a default clause do nothing but throw (a runtime safety net)? */
function onlyThrows(clause: ts.DefaultClause): boolean {
  const stmts = clause.statements.flatMap((s) => (ts.isBlock(s) ? [...s.statements] : [s]));
  return stmts.length > 0 && stmts.every(ts.isThrowStatement);
}

function isEnumerable(ctx: MacroContext, scrutinee: ts.Expression): boolean {
  const a = getScrutineeAnalysis(ctx, scrutinee);
  return a !== undefined && a.kind !== "non-enumerable" && a.kind !== "unknown";
}

/**
 * Exhaustiveness for both forms: report TS9226 unless a default covers the
 * rest, and warn about a default that can never run.
 */
function checkCoverage(
  ctx: MacroContext,
  labeled: ts.LabeledStatement,
  scrutinee: ts.Expression,
  coverage: MatchCoverage,
  defaultClause: ts.DefaultClause | undefined
): void {
  if (!defaultClause || onlyThrows(defaultClause)) {
    reportMissingCases(ctx, labeled.label, coverage, DEFAULT_FALLBACK);
    return;
  }
  if (coverage.kind === "complete" && isEnumerable(ctx, scrutinee)) {
    ctx.reportWarning(
      defaultClause,
      "match: unreachable default — the cases already cover every value of the scrutinee's type. " +
        "Remove it, so a value added to the type later is reported as a missing case; a default " +
        "that only throws is kept as a runtime safety net and doesn't turn the check off."
    );
  }
}

// ---------------------------------------------------------------------------
// Literal form
// ---------------------------------------------------------------------------

function literalCoverage(
  ctx: MacroContext,
  scrutinee: ts.Expression,
  values: readonly ts.Expression[]
): MatchCoverage {
  const keys = values.map((label) => valueKey(ctx, label)).filter((k) => k !== undefined);
  // Reuse match.ts's analysis through literal PatternInfos: a key covers
  // itself, whatever expression produced it (a literal, a const, an enum member).
  const patterns: PatternInfo[] = keys.map((k) => ({ kind: "literal", node: keyToLiteral(k) }));
  return findMissingCases(ctx, scrutinee, patterns);
}

/** A literal node whose `getPatternLiteralKey` is `key`. */
function keyToLiteral(key: string): ts.Expression {
  const f = ts.factory;
  if (key.startsWith('"')) return f.createStringLiteral(JSON.parse(key) as string);
  if (key === "true") return f.createTrue();
  if (key === "false") return f.createFalse();
  if (key === "null") return f.createNull();
  if (key === "undefined") return f.createIdentifier("undefined");
  const n = Number(key);
  if (Number.isFinite(n) && n < 0) {
    return f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, f.createNumericLiteral(-n));
  }
  return Number.isFinite(n) ? f.createNumericLiteral(n) : f.createIdentifier(key);
}

// ---------------------------------------------------------------------------
// Pattern form
// ---------------------------------------------------------------------------

/**
 * The binding pattern a (sub-)pattern destructures to: `undefined` for `_`
 * (binds nothing), or `false` when it would need a runtime test (a literal,
 * an extractor or a type test below the top level).
 */
function toBinding(f: ts.NodeFactory, p: PatternInfo): ts.BindingName | undefined | false {
  switch (p.kind) {
    case "wildcard":
      return undefined;
    case "variable":
      return f.createIdentifier(p.name);
    case "array": {
      const elements: ts.ArrayBindingElement[] = [];
      for (const el of p.elements) {
        const b = toBinding(f, el.pattern);
        if (b === false) return false;
        if (b === undefined) {
          if (!el.isRest) elements.push(f.createOmittedExpression());
          continue;
        }
        elements.push(
          f.createBindingElement(
            el.isRest ? f.createToken(ts.SyntaxKind.DotDotDotToken) : undefined,
            undefined,
            b
          )
        );
      }
      // Trailing holes bind nothing; `[a, _]` is `[a]`.
      while (elements.length > 0 && ts.isOmittedExpression(elements[elements.length - 1])) {
        elements.pop();
      }
      return f.createArrayBindingPattern(elements);
    }
    case "object": {
      const elements: ts.BindingElement[] = [];
      for (const prop of p.properties) {
        if (prop.isRest) {
          if (prop.pattern.kind !== "variable") return false;
          elements.push(
            f.createBindingElement(
              f.createToken(ts.SyntaxKind.DotDotDotToken),
              undefined,
              f.createIdentifier(prop.pattern.name)
            )
          );
          continue;
        }
        const b = toBinding(f, prop.pattern);
        if (b === false) return false;
        if (b === undefined) continue;
        const shorthand = ts.isIdentifier(b) && b.text === prop.key;
        elements.push(f.createBindingElement(undefined, shorthand ? undefined : prop.key, b));
      }
      return f.createObjectBindingPattern(elements);
    }
    default:
      return false;
  }
}

function constDecl(f: ts.NodeFactory, name: ts.BindingName, init: ts.Expression): ts.Statement {
  return f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [f.createVariableDeclaration(name, undefined, undefined, init)],
      ts.NodeFlags.Const
    )
  );
}

interface PatternCase {
  /** Top-level literal tests: `{ type: "Point" }` → [["type", "Point"]]. */
  literals: { key: string; node: ts.Expression }[];
  /** The `const` statements that bind the case's names, given the scrutinee. */
  bind: (scrutinee: () => ts.Expression) => ts.Statement[];
  /** The test for the general (`switch (true)`) form. */
  test: (scrutinee: () => ts.Expression, guardNullish: boolean) => ts.Expression;
  /** Discriminant the discriminant switch can use: field and case label. */
  discriminant?: { field: string; label: ts.Expression };
  /** A declaration to put before the switch (a custom extractor's result variable). */
  prelude?: ts.Statement;
  /** The pattern as exhaustiveness sees it (sub-patterns are bindings, not tests). */
  coverage: PatternInfo;
  bindsNames: boolean;
  /**
   * Where each bound name is read from, given the scrutinee (for a guard,
   * which runs before the case's bindings), and the names a rest element
   * binds, which have no single place to read from.
   */
  paths: (scrutinee: () => ts.Expression) => BindingPaths;
}

interface BindingPaths {
  read: Map<string, () => ts.Expression>;
  rest: Set<string>;
}

/** Record where each name `p` binds is read from, `base` being the value `p` matches. */
function collectPaths(
  f: ts.NodeFactory,
  p: PatternInfo,
  base: () => ts.Expression,
  out: BindingPaths
): void {
  const restOf = (q: PatternInfo) => {
    const inner: BindingPaths = { read: new Map(), rest: out.rest };
    collectPaths(f, q, base, inner);
    for (const name of inner.read.keys()) out.rest.add(name);
  };
  switch (p.kind) {
    case "variable":
      out.read.set(p.name, base);
      return;
    case "array":
      p.elements.forEach((el, i) => {
        if (el.isRest && el.pattern.kind === "variable") {
          // `[head, ...tail]`: tail is the rest of the array, `x.slice(1)`.
          out.read.set(el.pattern.name, () =>
            f.createCallExpression(f.createPropertyAccessExpression(base(), "slice"), undefined, [
              f.createNumericLiteral(i),
            ])
          );
        } else if (el.isRest) restOf(el.pattern);
        else collectPaths(f, el.pattern, () => f.createElementAccessExpression(base(), i), out);
      });
      return;
    case "type-constructor":
      // `Date(d)` binds the whole (tested) value.
      collectPaths(f, p.binding, base, out);
      return;
    case "extractor": {
      const fields = p.def.kind === "sum-variant" ? (p.def.payloadFields ?? []) : [];
      p.bindings.forEach((b, i) => {
        const field = fields[i];
        if (field !== undefined)
          collectPaths(f, b, () => payloadAccess(f, base(), field, undefined), out);
      });
      return;
    }
    case "object":
      for (const prop of p.properties) {
        if (prop.isRest) restOf(prop.pattern);
        else collectPaths(f, prop.pattern, () => fieldAccess(f, base(), prop.key), out);
      }
      return;
    default:
      return;
  }
}

/** `base.key`, or `base["key"]` when the key is not an identifier. */
function fieldAccess(f: ts.NodeFactory, base: ts.Expression, key: string): ts.Expression {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? f.createPropertyAccessExpression(base, key)
    : f.createElementAccessExpression(base, f.createStringLiteral(key));
}

/** A `[x, y, ...[]]` array pattern: nothing after its elements (an exact length). */
function isExactArray(p: PatternInfo & { kind: "array" }): boolean {
  const last = p.elements[p.elements.length - 1];
  return (
    !!last && last.isRest && last.pattern.kind === "array" && last.pattern.elements.length === 0
  );
}

/**
 * Does a sub-pattern test the value (PEP-065 D1-a)? A literal, a regex, a
 * type test or an extractor does; an object or array shape only through a
 * part that does, or an exact length (`[x, y, ...[]]`). Anything else
 * destructures.
 */
function needsTest(p: PatternInfo): boolean {
  switch (p.kind) {
    case "literal":
    case "regex":
    case "type-constructor":
    case "extractor":
      return true;
    case "object":
      return p.properties.some((prop) => !prop.isRest && needsTest(prop.pattern));
    case "array":
      return isExactArray(p) || p.elements.some((el) => !el.isRest && needsTest(el.pattern));
    default:
      return false;
  }
}

/**
 * The pattern as exhaustiveness sees it: what it tests, with the bindings and
 * the shapes that only destructure taken out (as wildcards). A shape that
 * tests something keeps its form, which can only make it cover less.
 */
function prune(p: PatternInfo): PatternInfo {
  switch (p.kind) {
    case "variable":
      return { kind: "wildcard" };
    case "object":
      return {
        kind: "object",
        properties: p.properties.flatMap((prop) =>
          prop.isRest || !needsTest(prop.pattern) ? [] : [{ ...prop, pattern: prune(prop.pattern) }]
        ),
        hasRest: false,
      };
    case "array":
      return needsTest(p)
        ? { ...p, elements: p.elements.map((el) => ({ ...el, pattern: prune(el.pattern) })) }
        : { kind: "wildcard" };
    case "extractor":
      return { ...p, bindings: p.bindings.map(prune) };
    case "type-constructor":
      return { ...p, binding: prune(p.binding) };
    default:
      return p;
  }
}

/** `base?.key` (or `base?.["key"]`): a nested read in a test, which must not throw. */
function chainField(f: ts.NodeFactory, base: ts.Expression, key: string): ts.Expression {
  const dot = f.createToken(ts.SyntaxKind.QuestionDotToken);
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? f.createPropertyAccessChain(base, dot, key)
    : f.createElementAccessChain(base, dot, f.createStringLiteral(key));
}

/**
 * Append the tests sub-pattern `p` makes on `base` (PEP-065 D1-a): literals,
 * regexes, type tests and built-in extractors test; object and array shapes
 * recurse (reading nested values with `?.`, so a missing parent fails the
 * test instead of throwing) and test an array's length only when it is
 * exact (`[x, y, ...[]]`). Returns why it can't, for a custom extractor
 * below the top level (its `extract` result would need a variable per test).
 */
function switchTests(
  f: ts.NodeFactory,
  p: PatternInfo,
  base: () => ts.Expression,
  out: ts.Expression[]
): string | undefined {
  switch (p.kind) {
    case "literal":
      out.push(literalCheck(f, base(), p.node));
      return undefined;
    case "regex": {
      const value = base();
      out.push(
        f.createBinaryExpression(
          f.createBinaryExpression(
            f.createTypeOfExpression(value),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createStringLiteral("string")
          ),
          ts.SyntaxKind.AmpersandAmpersandToken,
          f.createCallExpression(f.createPropertyAccessExpression(p.node, "test"), undefined, [
            base(),
          ])
        )
      );
      return undefined;
    }
    case "type-constructor": {
      const test = buildCondition(f, { ...p, binding: { kind: "wildcard" } }, base());
      if (test) out.push(test);
      return switchTests(f, p.binding, base, out);
    }
    case "extractor": {
      if (p.def.kind !== "sum-variant") {
        return (
          `${p.extractorName}(...) below the top level of a match: switch case (its extract() ` +
          `result needs a variable); match it in a case of its own, or use the fluent match()`
        );
      }
      const test = buildCondition(
        f,
        {
          ...p,
          bindings: p.bindings.map(() => ({ kind: "wildcard" }) as PatternInfo),
        },
        base()
      );
      if (test) out.push(test);
      const fields = p.def.payloadFields ?? [];
      for (let i = 0; i < p.bindings.length; i++) {
        const field = fields[i];
        if (field === undefined) continue;
        const problem = switchTests(
          f,
          p.bindings[i],
          () => payloadAccess(f, base(), field, undefined),
          out
        );
        if (problem) return problem;
      }
      return undefined;
    }
    case "object":
      for (const prop of p.properties) {
        if (prop.isRest || !needsTest(prop.pattern)) continue;
        const problem = switchTests(f, prop.pattern, () => chainField(f, base(), prop.key), out);
        if (problem) return problem;
      }
      return undefined;
    case "array": {
      const plain = p.elements.filter((el) => !el.isRest);
      if (isExactArray(p)) {
        const value = base();
        out.push(
          f.createBinaryExpression(
            f.createCallExpression(
              f.createPropertyAccessExpression(f.createIdentifier("Array"), "isArray"),
              undefined,
              [value]
            ),
            ts.SyntaxKind.AmpersandAmpersandToken,
            f.createBinaryExpression(
              f.createPropertyAccessExpression(base(), "length"),
              ts.SyntaxKind.EqualsEqualsEqualsToken,
              f.createNumericLiteral(plain.length)
            )
          )
        );
      }
      for (let i = 0; i < plain.length; i++) {
        if (!needsTest(plain[i].pattern)) continue;
        const problem = switchTests(
          f,
          plain[i].pattern,
          () =>
            f.createElementAccessChain(
              base(),
              f.createToken(ts.SyntaxKind.QuestionDotToken),
              f.createNumericLiteral(i)
            ),
          out
        );
        if (problem) return problem;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Why sub-pattern `p` can't be tested below the top level, or undefined when it can. */
function nestedProblem(p: PatternInfo): string | undefined {
  switch (p.kind) {
    case "extractor":
      if (p.def.kind !== "sum-variant") {
        return (
          `match: ${p.extractorName}(...) can't be tested below the top level of a match: switch ` +
          `case (its extract() result needs a variable); match it in a case of its own, or use ` +
          `the fluent match().`
        );
      }
      return p.bindings.map(nestedProblem).find((x) => x !== undefined);
    case "type-constructor":
      return nestedProblem(p.binding);
    case "object":
      return p.properties.map((prop) => nestedProblem(prop.pattern)).find((x) => x !== undefined);
    case "array":
      return p.elements.map((el) => nestedProblem(el.pattern)).find((x) => x !== undefined);
    case "unsupported":
      return `match: ${p.reason ?? "unsupported pattern in a match: switch case"}`;
    default:
      return undefined;
  }
}

/** `a && b && ...`, or undefined for no tests. */
function allOf(f: ts.NodeFactory, tests: ts.Expression[]): ts.Expression | undefined {
  return tests.length === 0
    ? undefined
    : tests.reduce((a, b) => f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b));
}

/** One `const name = <where it is read from>` per bound name. */
function pathConsts(f: ts.NodeFactory, paths: BindingPaths): ts.Statement[] {
  return [...paths.read].map(([name, read]) => constDecl(f, f.createIdentifier(name), read()));
}

/** Analyse one pattern case; report and return undefined if it can't be compiled. */
function analyzeCase(
  ctx: MacroContext,
  clause: ts.CaseClause,
  pattern: PatternInfo,
  scrutineeType: ts.Type | undefined
): PatternCase | undefined {
  const f = ctx.factory;
  const node = clause.expression;

  if (pattern.kind === "object") {
    const literals: { key: string; node: ts.Expression }[] = [];
    const bindingProps: typeof pattern.properties = [];
    // Properties whose pattern tests below the top level (PEP-065 D1-a):
    // `inner: { tag: "x" }`, `value: Some(v)`, `coordinates: [x, y, ...[]]`.
    const tested: typeof pattern.properties = [];
    for (const prop of pattern.properties) {
      if (!prop.isRest && prop.pattern.kind === "literal") {
        literals.push({ key: prop.key, node: prop.pattern.node });
        continue;
      }
      if (!prop.isRest && needsTest(prop.pattern)) {
        const problem = nestedProblem(prop.pattern);
        if (problem) {
          ctx.reportError(node, problem);
          return undefined;
        }
        tested.push(prop);
        continue;
      }
      bindingProps.push(prop);
    }
    const restProp = bindingProps.find((p) => p.isRest);
    const named = bindingProps.filter((p) => !p.isRest && p.pattern.kind !== "wildcard");
    const paths = (s: () => ts.Expression): BindingPaths => {
      const out: BindingPaths = { read: new Map(), rest: new Set() };
      collectPaths(f, pattern, s, out);
      return out;
    };
    const testedNames = tested.some((prop) => {
      const out: BindingPaths = { read: new Map(), rest: new Set() };
      collectPaths(f, prop.pattern, () => f.createIdentifier("_"), out);
      return out.read.size > 0;
    });
    const bind = (s: () => ts.Expression): ts.Statement[] => {
      if (tested.length > 0) {
        // A tested property can't be destructured (an extractor's payload is
        // read through its descriptor): one const per name, read where it
        // comes from, plus the rest object if there is one.
        const consts = pathConsts(f, paths(s));
        if (!restProp || restProp.pattern.kind !== "variable") return consts;
        const excluded = pattern.properties
          .filter((p) => !p.isRest)
          .map((p) =>
            f.createBindingElement(undefined, p.key, f.createIdentifier(`_excl_${p.key}`))
          );
        const rest = f.createBindingElement(
          f.createToken(ts.SyntaxKind.DotDotDotToken),
          undefined,
          f.createIdentifier(restProp.pattern.name)
        );
        return [...consts, constDecl(f, f.createObjectBindingPattern([...excluded, rest]), s())];
      }
      if (!restProp && named.length === 1) {
        // `{ type: "Point", coordinates: [x, y] }` → `const [x, y] = geom.coordinates;`
        const b = toBinding(f, named[0].pattern) as ts.BindingName;
        return [constDecl(f, b, f.createPropertyAccessExpression(s(), named[0].key))];
      }
      if (!restProp && named.length === 0) return [];
      // A rest binding is the properties the pattern doesn't name, tested ones included.
      const elements: ts.BindingElement[] = [];
      for (const lit of literals) {
        if (restProp) {
          elements.push(
            f.createBindingElement(undefined, lit.key, f.createIdentifier(`_excl_${lit.key}`))
          );
        }
      }
      const obj = toBinding(f, {
        kind: "object",
        properties: bindingProps,
        hasRest: !!restProp,
      }) as ts.ObjectBindingPattern;
      return [constDecl(f, f.createObjectBindingPattern([...elements, ...obj.elements]), s())];
    };
    const test = (s: () => ts.Expression, guardNullish: boolean): ts.Expression => {
      const parts: ts.Expression[] = [];
      if (guardNullish && literals.length === 0) {
        parts.push(
          f.createBinaryExpression(
            f.createTypeOfExpression(s()),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createStringLiteral("object")
          ),
          f.createBinaryExpression(s(), ts.SyntaxKind.ExclamationEqualsEqualsToken, f.createNull())
        );
      } else if (guardNullish) {
        parts.push(
          f.createBinaryExpression(s(), ts.SyntaxKind.ExclamationEqualsToken, f.createNull())
        );
      }
      for (const lit of literals) {
        parts.push(literalCheck(f, f.createPropertyAccessExpression(s(), lit.key), lit.node));
      }
      for (const prop of tested) {
        switchTests(f, prop.pattern, () => fieldAccess(f, s(), prop.key), parts);
      }
      return allOf(f, parts) ?? f.createTrue();
    };
    return {
      literals,
      bind,
      test,
      // A case that tests more than its discriminant can't be a discriminant
      // switch's label: it has to be able to fail on to the next case.
      discriminant:
        literals.length === 1 && tested.length === 0
          ? { field: literals[0].key, label: literals[0].node }
          : undefined,
      // Only what is tested is part of the coverage pattern; every other
      // property is destructured (bound or `undefined`), not tested for
      // presence: `{ k: "b", extra }` covers the `b` variant even where
      // `extra` is optional (the fluent match tests `"extra" in` and doesn't).
      coverage: {
        kind: "object",
        properties: pattern.properties.flatMap((p) =>
          !p.isRest && needsTest(p.pattern) ? [{ ...p, pattern: prune(p.pattern) }] : []
        ),
        hasRest: pattern.hasRest,
      },
      bindsNames: !!restProp || named.length > 0 || testedNames,
      paths,
    };
  }

  if (pattern.kind === "type-constructor" || pattern.kind === "regex") {
    // `String(s)`, `Date(d)`, `Circle(c)` (a class without a Destructure
    // instance: `instanceof`), `/re/`: a test of the whole value; a type
    // test binds the value, which the case's test narrows.
    const problem = nestedProblem(pattern);
    if (problem) {
      ctx.reportError(node, problem);
      return undefined;
    }
    const paths = (s: () => ts.Expression): BindingPaths => {
      const out: BindingPaths = { read: new Map(), rest: new Set() };
      collectPaths(f, pattern, s, out);
      return out;
    };
    return {
      literals: [],
      bind: (s) => pathConsts(f, paths(s)),
      test: (s) => {
        const parts: ts.Expression[] = [];
        switchTests(f, pattern, s, parts);
        return allOf(f, parts) ?? f.createTrue();
      },
      coverage: prune(pattern),
      bindsNames: paths(() => f.createIdentifier("_")).read.size > 0,
      paths,
    };
  }

  if (pattern.kind === "extractor") {
    const { def } = pattern;
    if (def.kind === "custom") return analyzeCustomCase(ctx, clause, pattern);
    if (def.kind !== "sum-variant") {
      ctx.reportError(
        node,
        `match: ${pattern.extractorName}(...) can't be used in a match: switch.`
      );
      return undefined;
    }
    const fields = def.payloadFields ?? [];
    // `self` of an @opaque type is asserted to its payload type (PayloadTyping).
    const typing = scrutineeType && def.payloadTyping?.(scrutineeType);
    const paths = (s: () => ts.Expression): BindingPaths => {
      const out: BindingPaths = { read: new Map(), rest: new Set() };
      pattern.bindings.forEach((b, i) => {
        if (fields[i] !== undefined) {
          collectPaths(f, b, () => payloadAccess(f, s(), fields[i], typing), out);
        }
      });
      return out;
    };
    const wildcarded: PatternInfo = {
      ...pattern,
      bindings: pattern.bindings.map(() => ({ kind: "wildcard" }) as PatternInfo),
    };
    // An argument that tests (`Some(0)`, `Ok({ kind: "a" })`, PEP-065 D1-a):
    // the case tests it too, and binds one const per name.
    const tested = pattern.bindings.some(needsTest);
    if (tested) {
      const problem = nestedProblem(pattern);
      if (problem) {
        ctx.reportError(node, problem);
        return undefined;
      }
      return {
        literals: [],
        bind: (s) => pathConsts(f, paths(s)),
        test: (s, guardNullish) => {
          const parts: ts.Expression[] = [];
          const own = buildCondition(f, wildcarded, s(), !guardNullish);
          if (own) parts.push(own);
          pattern.bindings.forEach((b, i) => {
            const field = fields[i];
            if (field !== undefined && needsTest(b)) {
              switchTests(f, b, () => payloadAccess(f, s(), field, typing), parts);
            }
          });
          return allOf(f, parts) ?? f.createTrue();
        },
        coverage: prune(pattern),
        bindsNames: paths(() => f.createIdentifier("_")).read.size > 0,
        paths,
      };
    }
    const bindings: { field: string; name: ts.BindingName }[] = [];
    for (let i = 0; i < pattern.bindings.length; i++) {
      const b = toBinding(f, pattern.bindings[i]) as ts.BindingName | undefined;
      if (b !== undefined && fields[i] !== undefined) bindings.push({ field: fields[i], name: b });
    }
    const discValue = def.discriminantValue;
    return {
      literals: [],
      bind: (s) =>
        bindings.map(({ field, name }) => constDecl(f, name, payloadAccess(f, s(), field, typing))),
      test: (s, guardNullish) =>
        buildCondition(f, wildcarded, s(), !guardNullish) ?? f.createTrue(),
      discriminant:
        def.discriminantField !== undefined && discValue !== undefined
          ? {
              field: def.discriminantField,
              label:
                typeof discValue === "boolean"
                  ? discValue
                    ? f.createTrue()
                    : f.createFalse()
                  : f.createStringLiteral(discValue),
            }
          : undefined,
      coverage: wildcarded,
      bindsNames: bindings.length > 0,
      paths,
    };
  }

  ctx.reportError(
    node,
    pattern.kind === "array"
      ? "match: a match: switch can't test an array's shape; switch on its length, or use the fluent match()."
      : "match: unsupported pattern in a match: switch (supported: literals, constants, object patterns, extractors, type tests, regexes)."
  );
  return undefined;
}

/**
 * Is `id` a reference to a variable (not a property name, a declared name, a
 * label)? Only references to a pattern's names are rewritten in a guard.
 */
function isReference(id: ts.Identifier): boolean {
  const p = id.parent;
  if (!p) return true;
  if (ts.isPropertyAccessExpression(p)) return p.name !== id;
  if (ts.isQualifiedName(p) || ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) {
    return false;
  }
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (
    (ts.isPropertyAssignment(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p) ||
      ts.isParameter(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isBindingElement(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isClassDeclaration(p) ||
      ts.isClassExpression(p)) &&
    p.name === id
  ) {
    return false;
  }
  return true;
}

/** Add the names `name` declares (an identifier or a destructuring pattern) to `out`. */
function addBindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const el of name.elements) {
    if (!ts.isOmittedExpression(el)) addBindingNames(el.name, out);
  }
}

/**
 * The names declared directly in a scope `node` opens, which hide a pattern
 * name of the same spelling inside it: a function's parameters and its
 * body's declarations, a block's declarations, a `for`'s or a `catch`'s
 * variable.
 */
function scopeDeclarations(node: ts.Node): Set<string> | undefined {
  const out = new Set<string>();
  const statements = (body: ts.Node | undefined) => {
    if (!body || !ts.isBlock(body)) return;
    for (const st of body.statements) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) addBindingNames(d.name, out);
      } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) {
        out.add(st.name.text);
      }
    }
  };
  if (ts.isFunctionLike(node)) {
    for (const param of node.parameters) addBindingNames(param.name, out);
    if (
      (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      out.add(node.name.text);
    }
    statements((node as ts.FunctionLikeDeclaration).body);
    return out;
  }
  if (ts.isBlock(node)) {
    statements(node);
    return out;
  }
  if (
    (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
    node.initializer &&
    ts.isVariableDeclarationList(node.initializer)
  ) {
    for (const d of node.initializer.declarations) addBindingNames(d.name, out);
    return out;
  }
  if (ts.isCatchClause(node) && node.variableDeclaration) {
    addBindingNames(node.variableDeclaration.name, out);
    return out;
  }
  return undefined;
}

/**
 * The guard with each name the case's pattern binds replaced by the place it
 * is read from (`w` → `s.w`): the guard runs as part of the case's test,
 * before the case's own `const` bindings exist. A name the guard itself
 * rebinds (an arrow's parameter, a local) is left alone inside that scope.
 * The replacement keeps the name's source-map range, so an error in it is
 * reported at the name as written. Undefined (after reporting) when the
 * guard reads a rest binding, which has no single place to read from.
 */
function substituteGuard(
  ctx: MacroContext,
  guard: ts.Expression,
  paths: BindingPaths
): ts.Expression | undefined {
  const f = ctx.factory;
  let failed = false;
  const visit = (n: ts.Node, hidden: ReadonlySet<string>): ts.Node => {
    if (ts.isTypeNode(n)) return n;
    if (ts.isIdentifier(n)) {
      if (hidden.has(n.text) || !isReference(n)) return n;
      if (paths.rest.has(n.text)) {
        ctx.reportError(
          n,
          `match: a guard can't read the rest binding \`${n.text}\` (it is built from the ` +
            `properties the pattern doesn't name); bind the property you need, or test it in ` +
            `the case body.`
        );
        failed = true;
        return n;
      }
      const read = paths.read.get(n.text);
      return read ? ts.setSourceMapRange(read(), n) : n;
    }
    if (ts.isShorthandPropertyAssignment(n) && !hidden.has(n.name.text)) {
      const read = paths.read.get(n.name.text);
      if (read) return f.createPropertyAssignment(n.name.text, read());
    }
    const declared = scopeDeclarations(n);
    const inner = declared ? new Set([...hidden, ...declared]) : hidden;
    return ts.visitEachChild(n, (c) => visit(c, inner), ctx.transformContext);
  };
  const out = visit(guard, new Set()) as ts.Expression;
  return failed ? undefined : out;
}

/** Print `labeled`'s leading comments (above `match:`) before `node`. */
function withLeadingComments<T extends ts.Node>(node: T, labeled: ts.LabeledStatement): T {
  return ts.setCommentRange(node, { pos: labeled.pos, end: labeled.statement.pos });
}

function withLeadingCommentsOnFirst(
  stmts: ts.Statement[],
  labeled: ts.LabeledStatement
): ts.Statement[] {
  if (stmts.length > 0) withLeadingComments(stmts[0], labeled);
  return stmts;
}

/**
 * A `Destructure` instance without a descriptor: its `extract` is called once
 * per test, into a variable declared before the switch, and the bindings
 * destructure the result: `case (_ext = destructureEmail.extract(s)) !== undefined:
 * { const { user, domain } = _ext; ... }`.
 */
function analyzeCustomCase(
  ctx: MacroContext,
  clause: ts.CaseClause,
  pattern: PatternInfo & { kind: "extractor" }
): PatternCase | undefined {
  const f = ctx.factory;
  const bindings: (ts.BindingName | undefined)[] = [];
  for (const b of pattern.bindings) {
    const name = toBinding(f, b);
    if (name === false) {
      ctx.reportError(
        clause.expression,
        `match: in a match: switch, ${pattern.extractorName}(...)'s arguments are bindings, not ` +
          `tests. Bind the value and test it in the case body, or use the fluent match().`
      );
      return undefined;
    }
    bindings.push(name);
  }
  const temp = ctx.tryShortName("_ext");
  const ref = () => f.createIdentifier(temp.text);
  const named = bindings.some((b) => b !== undefined);
  return {
    literals: [],
    prelude: f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList([f.createVariableDeclaration(temp)], ts.NodeFlags.Let)
    ),
    bind: () => {
      if (!named) return [];
      if (bindings.length === 1) return [constDecl(f, bindings[0]!, ref())];
      const elements = bindings.map((b) =>
        b === undefined
          ? f.createOmittedExpression()
          : f.createBindingElement(undefined, undefined, b)
      );
      return [constDecl(f, f.createArrayBindingPattern(elements), ref())];
    },
    test: (s) =>
      f.createBinaryExpression(
        f.createParenthesizedExpression(
          f.createAssignment(
            ref(),
            f.createCallExpression(
              f.createPropertyAccessExpression(pattern.def.instance!(ctx), "extract"),
              undefined,
              [s()]
            )
          )
        ),
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        f.createIdentifier("undefined")
      ),
    // It can fail on any value, so for exhaustiveness it covers nothing.
    coverage: pattern,
    bindsNames: named,
    paths: () => {
      const out: BindingPaths = { read: new Map(), rest: new Set() };
      pattern.bindings.forEach((b, i) =>
        collectPaths(
          f,
          b,
          pattern.bindings.length === 1 ? ref : () => f.createElementAccessExpression(ref(), i),
          out
        )
      );
      return out;
    },
  };
}

/**
 * Walk `node`'s statements within the label's reach: not into functions or
 * classes (a label doesn't cross them) or a nested statement with the same
 * label (which a `break` there means instead).
 */
function forEachInLabelScope(
  node: ts.Node,
  label: string,
  visit: (n: ts.Node) => boolean | void
): boolean {
  const walk = (n: ts.Node): boolean => {
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return false;
    if (visit(n)) return true;
    if (ts.isLabeledStatement(n) && n.label.text === label) return false;
    return ts.forEachChild(n, walk) ?? false;
  };
  return ts.forEachChild(node, walk) ?? false;
}

/**
 * Keep the `match:` label on the expanded switch when its body names it
 * (`break match;`): removing the label left the `break` pointing at nothing,
 * a SyntaxError. The label stays `match` unless the body nests another
 * `match:` statement (JavaScript rejects a label inside one of the same name),
 * in which case it is renamed and its `break`s with it.
 */
function relabel(
  ctx: MacroContext,
  labeled: ts.LabeledStatement
): {
  wrap: (sw: ts.SwitchStatement) => ts.Statement;
  /** Renames the label in `break`s, when it is renamed. */
  rewrite?: (s: ts.Statement) => ts.Statement;
} {
  const label = labeled.label.text;
  const sw = labeled.statement;
  const referenced = forEachInLabelScope(
    sw,
    label,
    (n) => (ts.isBreakStatement(n) || ts.isContinueStatement(n)) && n.label?.text === label
  );
  if (!referenced) return { wrap: (s) => s };
  const nested = forEachInLabelScope(
    sw,
    label,
    (n) => ts.isLabeledStatement(n) && n.label.text === label
  );
  const f = ctx.factory;
  if (!nested) {
    return { wrap: (s) => f.createLabeledStatement(f.createIdentifier(label), s) };
  }
  const renamed = ctx.generateUniqueName(label).text;
  const visit = (n: ts.Node): ts.Node => {
    if (ts.isFunctionLike(n) || ts.isClassLike(n)) return n;
    if (ts.isLabeledStatement(n) && n.label.text === label) return n;
    if (ts.isBreakStatement(n) && n.label?.text === label) {
      return ts.setTextRange(f.createBreakStatement(renamed), n);
    }
    return ts.visitEachChild(n, visit, ctx.transformContext);
  };
  return {
    wrap: (s) => f.createLabeledStatement(f.createIdentifier(renamed), s),
    rewrite: (s) => visit(s) as ts.Statement,
  };
}

function expandMatchSwitch(ctx: MacroContext, labeled: ts.LabeledStatement): ts.Statement[] {
  const f = ctx.factory;
  const sw = labeled.statement as ts.SwitchStatement;
  const scrutinee = sw.expression;
  let badLabel = false;
  for (const clause of sw.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const problem = labelProblem(f, clause.expression, scrutinee);
    if (problem) {
      ctx.reportError(clause.expression, problem);
      badLabel = true;
    }
  }
  if (badLabel) return [sw];
  const clauses = classify(f, sw);
  const byClause = new Map(
    clauses.flatMap((c) => (c.kind === "default" ? [] : [[c.clause, c] as const]))
  );
  const defaultClause = clauses.find((c) => c.kind === "default")?.clause as
    | ts.DefaultClause
    | undefined;
  const guarded = clauses.some((c) => c.kind !== "default" && c.guard !== undefined);
  // A guarded case covers nothing: its guard may fail (as `.if()` in the fluent form).
  const unguardedValues = clauses.flatMap((c) => (c.kind === "value" && !c.guard ? [c.label] : []));

  const { wrap, rewrite } = relabel(ctx, labeled);

  // Literal form: the switch itself, unchanged.
  if (!guarded && !clauses.some((c) => c.kind === "pattern")) {
    checkCoverage(
      ctx,
      labeled,
      scrutinee,
      literalCoverage(ctx, scrutinee, unguardedValues),
      defaultClause
    );
    // The same switch node's children, in a node that carries the label's
    // leading comments (the switch's own range starts after `match:`).
    const caseBlock = !rewrite
      ? sw.caseBlock
      : f.updateCaseBlock(
          sw.caseBlock,
          sw.caseBlock.clauses.map((c) =>
            ts.isDefaultClause(c)
              ? f.updateDefaultClause(c, c.statements.map(rewrite))
              : f.updateCaseClause(c, c.expression, c.statements.map(rewrite))
          )
        );
    const same = ts.setTextRange(f.createSwitchStatement(sw.expression, caseBlock), sw);
    ts.setOriginalNode(same, sw);
    return [withLeadingComments(wrap(same), labeled)];
  }

  // Pattern form (or guarded cases).
  const scrutineeType = getScrutineeType(ctx, scrutinee);
  const cases = new Map<ts.CaseClause, PatternCase>();
  let failed = false;
  for (const c of clauses) {
    if (c.kind !== "pattern") continue;
    const pc = analyzeCase(ctx, c.clause, c.pattern, scrutineeType);
    if (!pc) {
      failed = true;
      continue;
    }
    if (pc.bindsNames && c.clause.statements.length === 0 && !c.guard) {
      ctx.reportError(
        c.clause.expression,
        "match: this case binds names but has no statements of its own, so the names would be " +
          "unused (a falling-through case doesn't see them). Bind them in the case that has the body."
      );
      failed = true;
    }
    cases.set(c.clause, pc);
  }
  if (failed) return [sw];
  const casePreludes = [...cases.values()].flatMap((pc) => (pc.prelude ? [pc.prelude] : []));

  const coverage = findMissingCases(ctx, scrutinee, [
    ...clauses.flatMap((c) =>
      c.kind === "pattern" && !c.guard ? [cases.get(c.clause)!.coverage] : []
    ),
    ...unguardedValues.flatMap((label) => {
      const p = analyzePattern(label);
      return p.kind === "literal" ? [p] : [];
    }),
  ]);
  checkCoverage(ctx, labeled, scrutinee, coverage, defaultClause);

  // The scrutinee is read more than once: keep it in a const unless it is an
  // identifier or `this` (a property may be a getter, a call has effects).
  const rereadable = ts.isIdentifier(scrutinee) || scrutinee.kind === ts.SyntaxKind.ThisKeyword;
  const prelude: ts.Statement[] = [...casePreludes];
  let ref: () => ts.Expression = () =>
    ts.isIdentifier(scrutinee) ? f.createIdentifier(scrutinee.text) : f.createThis();
  const hoist = () => {
    const name = ctx.tryShortName(
      ts.isPropertyAccessExpression(scrutinee) ? `_${scrutinee.name.text}` : "_m"
    );
    prelude.push(constDecl(f, name, scrutinee));
    ref = () => f.createIdentifier(name.text);
  };

  const type = scrutineeType;
  const mayBeNullish =
    type !== undefined &&
    (type.isUnion() ? type.types : [type]).some(
      (t) => (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0
    );
  const all = [...cases.values()];
  const field = all[0]?.discriminant?.field;
  const discriminantSwitch =
    !guarded &&
    unguardedValues.length === 0 &&
    !mayBeNullish &&
    field !== undefined &&
    all.every((pc) => pc.discriminant?.field === field && pc.literals.length <= 1);

  // A case with no statements of its own falls through: its bindings (which
  // serve only its guard) are not declared.
  const body = (clause: ts.CaseClause, pc: PatternCase | undefined): ts.Statement[] => {
    if (clause.statements.length === 0) return [];
    const binds = pc ? pc.bind(ref) : [];
    const statements = rewrite ? clause.statements.map(rewrite) : [...clause.statements];
    return binds.length > 0 ? [f.createBlock([...binds, ...statements], true)] : statements;
  };
  const defaultClauseOf = (clause: ts.DefaultClause): ts.DefaultClause =>
    rewrite ? f.updateDefaultClause(clause, clause.statements.map(rewrite)) : clause;

  if (discriminantSwitch) {
    // switch (geom.type) { case "Point": { const [x, y] = geom.coordinates; ... } }
    const anyBinds = all.some((pc) => pc.bindsNames);
    if (anyBinds && !rereadable) hoist();
    const discriminantExpr = f.createPropertyAccessExpression(anyBinds ? ref() : scrutinee, field);
    const newClauses = sw.caseBlock.clauses.map((clause) => {
      if (ts.isDefaultClause(clause)) return defaultClauseOf(clause);
      const pc = cases.get(clause)!;
      return f.createCaseClause(pc.discriminant!.label, body(clause, pc));
    });
    return withLeadingCommentsOnFirst(
      [...prelude, wrap(f.createSwitchStatement(discriminantExpr, f.createCaseBlock(newClauses)))],
      labeled
    );
  }

  // switch (true) { case <test> && <guard>: { <bindings>; ... } }: an if/else
  // chain with switch semantics, so break / fallthrough / continue mean what
  // they say, and a failing guard goes on to the next case.
  if (!rereadable) hoist();
  const guardNullish = !isGuaranteedObject(ctx, scrutinee);
  const tests = new Map<ts.CaseClause, ts.Expression>();
  for (const clause of sw.caseBlock.clauses) {
    if (ts.isDefaultClause(clause)) continue;
    const c = byClause.get(clause)!;
    const pc = cases.get(clause);
    const own =
      c.kind === "pattern" && pc
        ? pc.test(ref, guardNullish)
        : c.kind === "value"
          ? literalCheck(f, ref(), c.label)
          : undefined;
    let guard = c.guard;
    if (guard && pc) {
      guard = substituteGuard(ctx, guard, pc.paths(ref));
      if (!guard) failed = true;
    }
    const test =
      own && guard && own.kind !== ts.SyntaxKind.TrueKeyword
        ? f.createBinaryExpression(own, ts.SyntaxKind.AmpersandAmpersandToken, guard)
        : (guard ?? own ?? f.createTrue());
    tests.set(clause, test);
  }
  if (failed) return [sw];
  const newClauses = sw.caseBlock.clauses.map((clause) =>
    ts.isDefaultClause(clause)
      ? defaultClauseOf(clause)
      : f.createCaseClause(tests.get(clause)!, body(clause, cases.get(clause)))
  );
  return withLeadingCommentsOnFirst(
    [...prelude, wrap(f.createSwitchStatement(f.createTrue(), f.createCaseBlock(newClauses)))],
    labeled
  );
}

export const matchSwitchMacro = defineLabeledBlockMacro({
  name: "matchSwitch",
  label: "match",
  statement: "switch",
  syntaxModule: "@typesugar/std/syntax/match",
  erasableSyntaxModule: true,
  description:
    "match: switch (x) { case ... } — exhaustive switch with destructuring patterns (statement form of match())",
  expand(ctx: MacroContext, mainBlock: ts.LabeledStatement): ts.Statement | ts.Statement[] {
    if (!ts.isSwitchStatement(mainBlock.statement)) return mainBlock;
    const sw = mainBlock.statement;
    return withBuiltinExtractorsFor(ctx, sw.expression, () => expandMatchSwitch(ctx, mainBlock));
  },
});

globalRegistry.register(matchSwitchMacro);
