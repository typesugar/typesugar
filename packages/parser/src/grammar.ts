/**
 * PEG grammar parser and builder for @typesugar/parser
 *
 * Parses PEG grammar definition strings into a `Grammar<T>` IR, then builds
 * recursive-descent parsers from that IR.
 */

import type { Parser, ParseResult, GrammarRule, Grammar } from "./types.js";
import { literal, char, regex, seq, alt, many, map, lazy } from "./combinators.js";

function mkParser<T>(fn: (input: string, pos: number) => ParseResult<T>): Parser<T> {
  return {
    parse(input: string, pos = 0) {
      return fn(input, pos);
    },
    parseAll(input: string): T {
      const result = fn(input, 0);
      if (!result.ok) {
        throw new Error(`Grammar parse error at pos ${result.pos}: expected ${result.expected}`);
      }
      if (result.pos !== input.length) {
        throw new Error(`Grammar parse error: unexpected input at pos ${result.pos}`);
      }
      return result.value;
    },
  };
}

function ok<T>(value: T, pos: number): ParseResult<T> {
  return { ok: true, value, pos };
}

function fail<T>(pos: number, expected: string): ParseResult<T> {
  return { ok: false, pos, expected };
}

// ---------------------------------------------------------------------------
// Grammar tokenization helpers
// ---------------------------------------------------------------------------

const ws: Parser<string[]> = many(regex(/[ \t]/));
const comment: Parser<string> = map(seq(literal("//"), regex(/[^\n]*/)), ([, c]) => c);
const wsOrComment: Parser<unknown[]> = many(alt(regex(/[ \t\r\n]/), comment));

// ---------------------------------------------------------------------------
// Grammar expression parsers (recursive descent over PEG syntax)
// ---------------------------------------------------------------------------

/** Parse a string literal: "..." or '...' */
const quotedLit: Parser<GrammarRule> = mkParser((input, pos) => {
  if (pos >= input.length) return fail(pos, "string literal");
  const q = input[pos];
  if (q !== '"' && q !== "'") return fail(pos, "string literal");
  let i = pos + 1;
  let value = "";
  while (i < input.length && input[i] !== q) {
    if (input[i] === "\\") {
      i++;
      if (i >= input.length) return fail(i, "escape sequence");
      const esc = input[i];
      switch (esc) {
        case "n":
          value += "\n";
          break;
        case "r":
          value += "\r";
          break;
        case "t":
          value += "\t";
          break;
        case "\\":
          value += "\\";
          break;
        default:
          value += esc;
          break;
      }
    } else {
      value += input[i];
    }
    i++;
  }
  if (i >= input.length) return fail(pos, `closing ${q}`);
  i++; // skip closing quote

  // Check for character range: 'a'..'z'
  const rangeResult = literal("..").parse(input, i);
  if (rangeResult.ok && value.length === 1) {
    const afterDots = rangeResult.pos;
    const endQuote = quotedLit.parse(input, afterDots);
    if (endQuote.ok && endQuote.value.type === "literal" && endQuote.value.value.length === 1) {
      return ok(
        { type: "charRange", from: value, to: endQuote.value.value } as GrammarRule,
        endQuote.pos
      );
    }
  }

  return ok({ type: "literal", value } as GrammarRule, i);
});

/** Parse a rule identifier: [a-zA-Z_][a-zA-Z0-9_]* */
const identifier: Parser<string> = regex(/[a-zA-Z_][a-zA-Z0-9_]*/);

/** Parse the '.' wildcard (any character). */
const dotAny: Parser<GrammarRule> = map(char("."), () => ({ type: "any" }) as GrammarRule);

/** Primary expression: literal | reference | '.' | '(' expr ')' */
const primary: Parser<GrammarRule> = lazy(() =>
  mkParser((input, pos) => {
    // Try grouped expression first
    const openParen = char("(").parse(input, pos);
    if (openParen.ok) {
      const inner = wsOrComment.parse(input, openParen.pos);
      const innerPos = inner.ok ? inner.pos : openParen.pos;
      const expr = alternation.parse(input, innerPos);
      if (!expr.ok) return expr;
      const afterWs = wsOrComment.parse(input, expr.pos);
      const close = char(")").parse(input, afterWs.ok ? afterWs.pos : expr.pos);
      if (!close.ok) return fail(close.pos, "')'");
      return ok(expr.value, close.pos);
    }

    // Try literal
    const lit = quotedLit.parse(input, pos);
    if (lit.ok) return lit;

    // Try any-char
    const dot = dotAny.parse(input, pos);
    if (dot.ok) return dot;

    // Try reference
    const id = identifier.parse(input, pos);
    if (id.ok) return ok({ type: "reference", name: id.value } as GrammarRule, id.pos);

    return fail(pos, "expression");
  })
);

/** Suffixed: primary ('*' | '+' | '?')? */
const suffixed: Parser<GrammarRule> = mkParser((input, pos) => {
  const p = primary.parse(input, pos);
  if (!p.ok) return p;
  let cur = p.pos;
  const rule = p.value;

  if (cur < input.length) {
    const ch = input[cur];
    if (ch === "*") {
      return ok({ type: "repetition", rule, min: 0, max: null } as GrammarRule, cur + 1);
    }
    if (ch === "+") {
      return ok({ type: "repetition", rule, min: 1, max: null } as GrammarRule, cur + 1);
    }
    if (ch === "?") {
      return ok({ type: "optional", rule } as GrammarRule, cur + 1);
    }
  }

  return ok(rule, cur);
});

/**
 * Prefixed: '!'? suffixed
 * `!e` is a pure negative lookahead — succeeds (consuming nothing) only if `e` fails.
 */
const prefixed: Parser<GrammarRule> = mkParser((input, pos) => {
  const bang = char("!").parse(input, pos);
  if (bang.ok) {
    const afterWs = ws.parse(input, bang.pos);
    const negPos = afterWs.ok ? afterWs.pos : bang.pos;
    const neg = suffixed.parse(input, negPos);
    if (!neg.ok) return neg;
    return ok(
      { type: "negation", rule: neg.value, then: { type: "literal", value: "" } } as GrammarRule,
      neg.pos
    );
  }
  return suffixed.parse(input, pos);
});

/** Sequence: prefixed+ */
const sequence: Parser<GrammarRule> = mkParser((input, pos) => {
  const items: GrammarRule[] = [];
  let cur = pos;
  for (;;) {
    const wsr = ws.parse(input, cur);
    const nextPos = wsr.ok ? wsr.pos : cur;
    // Stop at rule-terminating characters
    if (nextPos >= input.length) break;
    const ch = input[nextPos];
    if (ch === "|" || ch === ")" || ch === "\n" || ch === "\r" || ch === "/" || ch === "=") break;
    // Also stop if we see another rule definition (identifier followed by '=')
    const idProbe = identifier.parse(input, nextPos);
    if (idProbe.ok) {
      const afterId = ws.parse(input, idProbe.pos);
      const eqPos = afterId.ok ? afterId.pos : idProbe.pos;
      if (eqPos < input.length && input[eqPos] === "=") break;
    }
    const elem = prefixed.parse(input, nextPos);
    if (!elem.ok) break;
    if (elem.pos === nextPos && items.length > 0) break; // no progress
    items.push(elem.value);
    cur = elem.pos;
  }
  if (items.length === 0) return fail(pos, "sequence");
  if (items.length === 1) return ok(items[0], cur);
  return ok({ type: "sequence", rules: items } as GrammarRule, cur);
});

/** Alternation: sequence ('|' sequence)* */
const alternation: Parser<GrammarRule> = mkParser((input, pos) => {
  const first = sequence.parse(input, pos);
  if (!first.ok) return first;
  const alts: GrammarRule[] = [first.value];
  let cur = first.pos;
  for (;;) {
    const wsr = wsOrComment.parse(input, cur);
    const nextPos = wsr.ok ? wsr.pos : cur;
    const pipe = char("|").parse(input, nextPos);
    if (!pipe.ok) break;
    const wsr2 = wsOrComment.parse(input, pipe.pos);
    const seqPos = wsr2.ok ? wsr2.pos : pipe.pos;
    const next = sequence.parse(input, seqPos);
    if (!next.ok) return next;
    alts.push(next.value);
    cur = next.pos;
  }
  if (alts.length === 1) return ok(alts[0], cur);
  return ok({ type: "alternation", rules: alts } as GrammarRule, cur);
});

// ---------------------------------------------------------------------------
// Top-level grammar parser
// ---------------------------------------------------------------------------

/**
 * Parse a PEG grammar definition string into a map of named rules.
 *
 * Grammar syntax:
 * - `rule = expr` — rule definition
 * - `a b c` — sequence
 * - `a | b` — ordered alternation
 * - `a*` — zero or more
 * - `a+` — one or more
 * - `a?` — optional
 * - `"literal"` or `'literal'` — string literal
 * - `'a'..'z'` — character range
 * - `.` — any character
 * - `!a` — negation
 * - `(group)` — grouping
 * - `ruleName` — reference to another rule
 *
 * @throws Error on invalid grammar syntax
 */
export function parseGrammarDef(source: string): Map<string, GrammarRule> {
  const rules = new Map<string, GrammarRule>();
  let pos = 0;

  // Skip leading whitespace/comments
  const skipWs = () => {
    const r = wsOrComment.parse(source, pos);
    if (r.ok) pos = r.pos;
  };

  skipWs();

  while (pos < source.length) {
    // Parse rule name
    const nameResult = identifier.parse(source, pos);
    if (!nameResult.ok) {
      throw new Error(
        `Grammar syntax error at pos ${pos}: expected rule name, got ${JSON.stringify(source.slice(pos, pos + 20))}`
      );
    }
    const name = nameResult.value;
    pos = nameResult.pos;

    // Skip whitespace
    const w1 = ws.parse(source, pos);
    if (w1.ok) pos = w1.pos;

    // Expect '='
    if (pos >= source.length || source[pos] !== "=") {
      throw new Error(`Grammar syntax error at pos ${pos}: expected '=' after rule name '${name}'`);
    }
    pos++; // skip '='

    // Skip whitespace
    const w2 = ws.parse(source, pos);
    if (w2.ok) pos = w2.pos;

    // Parse the rule expression
    const exprResult = alternation.parse(source, pos);
    if (!exprResult.ok) {
      throw new Error(
        `Grammar syntax error at pos ${pos}: expected expression for rule '${name}', got ${JSON.stringify(source.slice(pos, pos + 20))}`
      );
    }

    rules.set(name, exprResult.value);
    pos = exprResult.pos;

    skipWs();
  }

  if (rules.size === 0) {
    throw new Error("Grammar is empty: no rules defined");
  }

  // Validate references
  for (const [name, rule] of rules) {
    validateReferences(rule, rules, name);
  }

  // Check for left recursion
  detectLeftRecursion(rules);

  return rules;
}

/** Validate that all rule references point to defined rules. */
function validateReferences(
  rule: GrammarRule,
  allRules: Map<string, GrammarRule>,
  context: string
): void {
  switch (rule.type) {
    case "reference":
      if (!allRules.has(rule.name)) {
        throw new Error(`Undefined rule '${rule.name}' referenced in '${context}'`);
      }
      break;
    case "sequence":
    case "alternation":
      for (const r of rule.rules) validateReferences(r, allRules, context);
      break;
    case "repetition":
      validateReferences(rule.rule, allRules, context);
      break;
    case "optional":
      validateReferences(rule.rule, allRules, context);
      break;
    case "negation":
      validateReferences(rule.rule, allRules, context);
      validateReferences(rule.then, allRules, context);
      break;
    case "action":
      validateReferences(rule.rule, allRules, context);
      break;
    case "literal":
    case "charRange":
    case "any":
      break;
  }
}

/**
 * Detect direct and indirect left recursion in the grammar.
 * Throws a descriptive error if found.
 */
function detectLeftRecursion(rules: Map<string, GrammarRule>): void {
  for (const [name] of rules) {
    const visited = new Set<string>();
    isLeftRecursive(name, rules, visited, [name]);
  }
}

function isLeftRecursive(
  ruleName: string,
  rules: Map<string, GrammarRule>,
  visited: Set<string>,
  path: string[]
): boolean {
  const rule = rules.get(ruleName);
  if (!rule) return false;
  return firstRefsAre(rule, rules, visited, path);
}

/** Check if a rule can start with a reference that leads to left recursion. */
function firstRefsAre(
  rule: GrammarRule,
  rules: Map<string, GrammarRule>,
  visited: Set<string>,
  path: string[]
): boolean {
  switch (rule.type) {
    case "reference": {
      if (rule.name === path[0]) {
        throw new Error(
          `Left recursion detected: ${path.join(" -> ")} -> ${rule.name}. ` +
            `PEG parsers cannot handle left recursion. ` +
            `Rewrite using iteration (e.g., 'a (op a)*' instead of 'a = a op a').`
        );
      }
      if (visited.has(rule.name)) return false;
      visited.add(rule.name);
      const target = rules.get(rule.name);
      if (!target) return false;
      return firstRefsAre(target, rules, visited, [...path, rule.name]);
    }
    case "sequence":
      if (rule.rules.length > 0) {
        return firstRefsAre(rule.rules[0], rules, visited, path);
      }
      return false;
    case "alternation":
      return rule.rules.some((r) => firstRefsAre(r, rules, new Set(visited), path));
    case "optional":
    case "repetition":
      return firstRefsAre(rule.rule, rules, visited, path);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Parser builder — compile GrammarRule IR into a runnable Parser
// ---------------------------------------------------------------------------

/**
 * Build a `Grammar<T>` from a map of grammar rules.
 *
 * @param rules - Named grammar rules (from `parseGrammarDef`)
 * @param startRule - Which rule to use as the entry point (defaults to the first rule)
 * @returns A Grammar that can parse input strings
 */
export function buildParser<T = string>(
  rules: Map<string, GrammarRule>,
  startRule?: string
): Grammar<T> {
  const start = startRule ?? rules.keys().next().value!;
  if (!rules.has(start)) {
    throw new Error(`Start rule '${start}' not found in grammar`);
  }

  const parsers = new Map<string, Parser<unknown>>();
  // Build lazily to handle mutual recursion
  for (const [name] of rules) {
    parsers.set(
      name,
      mkParser((input, pos) => {
        const built = buildRule(rules.get(name)!, rules, parsers);
        parsers.set(name, built);
        return built.parse(input, pos);
      })
    );
  }

  // Eagerly build all rules now
  for (const [name, rule] of rules) {
    parsers.set(name, buildRule(rule, rules, parsers));
  }

  const startParser = parsers.get(start)!;

  // Track furthest failure for error reporting
  const wrapped: Grammar<T> = {
    rules,
    startRule: start,
    parse(input: string, pos = 0): ParseResult<T> {
      return startParser.parse(input, pos) as ParseResult<T>;
    },
    parseAll(input: string): T {
      let furthestPos = 0;
      let furthestExpected = "unknown";

      const origParsers = new Map(parsers);
      // Wrap each parser to track furthest failure
      for (const [name, p] of origParsers) {
        parsers.set(
          name,
          mkParser((inp, pos) => {
            const r = p.parse(inp, pos);
            if (!r.ok && r.pos >= furthestPos) {
              furthestPos = r.pos;
              furthestExpected = r.expected;
            }
            return r;
          })
        );
      }

      const result = parsers.get(start)!.parse(input, 0);
      // Restore original parsers
      for (const [name, p] of origParsers) parsers.set(name, p);

      if (!result.ok) {
        const { line, col } = lineColOf(input, furthestPos);
        throw new Error(`Parse error at line ${line}, col ${col}: expected ${furthestExpected}`);
      }
      if (result.pos !== input.length) {
        const { line, col } = lineColOf(input, result.pos);
        throw new Error(`Parse error at line ${line}, col ${col}: expected end of input`);
      }
      return result.value as T;
    },
  };

  return wrapped;
}

function lineColOf(input: string, pos: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < input.length; i++) {
    if (input[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

/** Compile a single GrammarRule into a Parser. */
function buildRule(
  rule: GrammarRule,
  allRules: Map<string, GrammarRule>,
  parsers: Map<string, Parser<unknown>>
): Parser<unknown> {
  switch (rule.type) {
    case "literal":
      return mkParser((input, pos) => {
        if (input.startsWith(rule.value, pos)) {
          return ok(rule.value, pos + rule.value.length);
        }
        return fail(pos, JSON.stringify(rule.value));
      });

    case "charRange":
      return mkParser((input, pos) => {
        if (pos < input.length && input[pos] >= rule.from && input[pos] <= rule.to) {
          return ok(input[pos], pos + 1);
        }
        return fail(pos, `'${rule.from}'..'${rule.to}'`);
      });

    case "any":
      return mkParser((input, pos) => {
        if (pos < input.length) return ok(input[pos], pos + 1);
        return fail(pos, "any character");
      });

    case "sequence": {
      const subs = rule.rules.map((r) => buildRule(r, allRules, parsers));
      return mkParser((input, pos) => {
        const values: unknown[] = [];
        let cur = pos;
        for (const sub of subs) {
          const r = sub.parse(input, cur);
          if (!r.ok) return r;
          values.push(r.value);
          cur = r.pos;
        }
        return ok(values, cur);
      });
    }

    case "alternation": {
      const subs = rule.rules.map((r) => buildRule(r, allRules, parsers));
      return mkParser((input, pos) => {
        let bestFail: ParseResult<unknown> | null = null;
        for (const sub of subs) {
          const r = sub.parse(input, pos);
          if (r.ok) return r;
          if (!bestFail || r.pos > bestFail.pos) bestFail = r;
        }
        return bestFail ?? fail(pos, "alternation");
      });
    }

    case "repetition": {
      const sub = buildRule(rule.rule, allRules, parsers);
      return mkParser((input, pos) => {
        const values: unknown[] = [];
        let cur = pos;
        for (;;) {
          if (rule.max !== null && values.length >= rule.max) break;
          const r = sub.parse(input, cur);
          if (!r.ok) break;
          if (r.pos === cur) break; // prevent infinite loop
          values.push(r.value);
          cur = r.pos;
        }
        if (values.length < rule.min) {
          return fail(pos, `at least ${rule.min} repetition(s)`);
        }
        return ok(values, cur);
      });
    }

    case "optional": {
      const sub = buildRule(rule.rule, allRules, parsers);
      return mkParser((input, pos) => {
        const r = sub.parse(input, pos);
        if (r.ok) return r;
        return ok(null, pos);
      });
    }

    case "negation": {
      const neg = buildRule(rule.rule, allRules, parsers);
      const then = buildRule(rule.then, allRules, parsers);
      return mkParser((input, pos) => {
        const r = neg.parse(input, pos);
        if (r.ok) return fail(pos, "negation to fail");
        return then.parse(input, pos);
      });
    }

    case "reference": {
      return mkParser((input, pos) => {
        const target = parsers.get(rule.name);
        if (!target) return fail(pos, `rule '${rule.name}'`);
        return target.parse(input, pos);
      });
    }

    case "action": {
      const sub = buildRule(rule.rule, allRules, parsers);
      return mkParser((input, pos) => {
        const r = sub.parse(input, pos);
        if (!r.ok) return r;
        // Actions are a future concern — for now, pass through
        return r;
      });
    }
  }
}
