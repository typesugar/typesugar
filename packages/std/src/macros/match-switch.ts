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
 * Below the discriminant, a pattern DESTRUCTURES; it does not test.
 * `coordinates: [x, y]` reads the first two elements whatever the length, as
 * `const [x, y] = geom.coordinates` does. Literals deeper than the top level
 * are therefore errors. A guard (`case P if cond`) is not valid syntax; test
 * the condition in the case body.
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

type Clause =
  | { kind: "value"; clause: ts.CaseClause }
  | { kind: "pattern"; clause: ts.CaseClause; pattern: PatternInfo }
  | { kind: "default"; clause: ts.DefaultClause };

/** A pattern case: object pattern, or a call to a built-in extractor (`Some(v)`). */
function isPatternSyntax(expr: ts.Expression): boolean {
  if (ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)) return true;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return analyzePattern(expr).kind === "extractor";
  }
  return false;
}

/** `None` / `Nil`: a pattern in a switch that has other patterns, a value otherwise. */
function isZeroArgExtractor(expr: ts.Expression): boolean {
  if (!ts.isIdentifier(expr)) return false;
  return analyzePattern(expr).kind === "extractor";
}

function classify(sw: ts.SwitchStatement): Clause[] {
  const raw = sw.caseBlock.clauses;
  const patternMode = raw.some((c) => ts.isCaseClause(c) && isPatternSyntax(c.expression));
  return raw.map((clause): Clause => {
    if (ts.isDefaultClause(clause)) return { kind: "default", clause };
    const e = clause.expression;
    if (isPatternSyntax(e) || (patternMode && isZeroArgExtractor(e))) {
      return { kind: "pattern", clause, pattern: analyzePattern(e) };
    }
    return { kind: "value", clause };
  });
}

/** The key (in match.ts's literal-key form) a value case covers, if it is one value. */
function valueKey(ctx: MacroContext, expr: ts.Expression): string | undefined {
  const asPattern = analyzePattern(expr);
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
  values: readonly ts.CaseClause[]
): MatchCoverage {
  const keys = values.map((c) => valueKey(ctx, c.expression)).filter((k) => k !== undefined);
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
    for (const prop of pattern.properties) {
      if (!prop.isRest && prop.pattern.kind === "literal") {
        literals.push({ key: prop.key, node: prop.pattern.node });
        continue;
      }
      if (!prop.isRest && toBinding(f, prop.pattern) === false) {
        ctx.reportError(
          node,
          `match: in a match: switch, only top-level properties can be tested; "${prop.key}"'s ` +
            `pattern needs a runtime test. Destructure it and test the value in the case body, or ` +
            `use the fluent match() for nested tests.`
        );
        return undefined;
      }
      bindingProps.push(prop);
    }
    const restProp = bindingProps.find((p) => p.isRest);
    const named = bindingProps.filter((p) => !p.isRest && p.pattern.kind !== "wildcard");
    const bind = (s: () => ts.Expression): ts.Statement[] => {
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
      if (literals.length === 0) {
        if (!guardNullish) return f.createTrue();
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
      return parts.reduce((a, b) =>
        f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b)
      );
    };
    return {
      literals,
      bind,
      test,
      discriminant:
        literals.length === 1 ? { field: literals[0].key, label: literals[0].node } : undefined,
      coverage: {
        kind: "object",
        properties: pattern.properties.map((p) =>
          p.isRest || p.pattern.kind === "literal" ? p : { ...p, pattern: { kind: "wildcard" } }
        ),
        hasRest: pattern.hasRest,
      },
      bindsNames: !!restProp || named.length > 0,
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
    const bindings: { field: string; name: ts.BindingName }[] = [];
    for (let i = 0; i < pattern.bindings.length; i++) {
      const b = toBinding(f, pattern.bindings[i]);
      if (b === false) {
        ctx.reportError(
          node,
          `match: in a match: switch, ${pattern.extractorName}(...)'s arguments are bindings, not ` +
            `tests. Bind the value and test it in the case body, or use the fluent match().`
        );
        return undefined;
      }
      if (b !== undefined && fields[i] !== undefined) bindings.push({ field: fields[i], name: b });
    }
    const wildcarded: PatternInfo = {
      ...pattern,
      bindings: pattern.bindings.map(() => ({ kind: "wildcard" }) as PatternInfo),
    };
    const discValue = def.discriminantValue;
    // `self` of an @opaque type is asserted to its payload type (PayloadTyping).
    const typing = scrutineeType && def.payloadTyping?.(scrutineeType);
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
    };
  }

  ctx.reportError(
    node,
    pattern.kind === "array"
      ? "match: a match: switch can't test an array's shape; switch on its length, or use the fluent match()."
      : "match: unsupported pattern in a match: switch (supported: literals, constants, object patterns, built-in extractors)."
  );
  return undefined;
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
  const clauses = classify(sw);
  const defaultClause = clauses.find((c) => c.kind === "default")?.clause as
    | ts.DefaultClause
    | undefined;
  const values = clauses.flatMap((c) => (c.kind === "value" ? [c.clause] : []));

  const { wrap, rewrite } = relabel(ctx, labeled);

  // Literal form: the switch itself, unchanged.
  if (!clauses.some((c) => c.kind === "pattern")) {
    checkCoverage(ctx, labeled, scrutinee, literalCoverage(ctx, scrutinee, values), defaultClause);
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

  // Pattern form.
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
    if (pc.bindsNames && c.clause.statements.length === 0) {
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
    ...[...cases.values()].map((pc) => pc.coverage),
    ...values.flatMap((c) => {
      const p = analyzePattern(c.expression);
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
  const field = all[0].discriminant?.field;
  const discriminantSwitch =
    values.length === 0 &&
    !mayBeNullish &&
    field !== undefined &&
    all.every((pc) => pc.discriminant?.field === field && pc.literals.length <= 1);

  const body = (clause: ts.CaseClause, pc: PatternCase | undefined): ts.Statement[] => {
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

  // switch (true) { case <test>: { <bindings>; ... } }: an if/else chain with
  // switch semantics, so break / fallthrough / continue mean what they say.
  if (!rereadable) hoist();
  const guardNullish = !isGuaranteedObject(ctx, scrutinee);
  const newClauses = sw.caseBlock.clauses.map((clause) => {
    if (ts.isDefaultClause(clause)) return defaultClauseOf(clause);
    const pc = cases.get(clause);
    const test = pc ? pc.test(ref, guardNullish) : literalCheck(f, ref(), clause.expression);
    return f.createCaseClause(test, body(clause, pc));
  });
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
