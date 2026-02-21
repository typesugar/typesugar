/**
 * Programmatic parser combinator API for @typesugar/parser
 *
 * All combinators return `Parser<T>` values that can be composed freely.
 * PEG semantics: ordered alternation, first match wins.
 */

import type { Parser, ParseResult } from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Create a Parser<T> from a raw parse function. */
function mkParser<T>(parseFn: (input: string, pos: number) => ParseResult<T>): Parser<T> {
  return {
    parse(input: string, pos = 0): ParseResult<T> {
      return parseFn(input, pos);
    },
    parseAll(input: string): T {
      const result = parseFn(input, 0);
      if (!result.ok) {
        throw new ParseError(input, result.pos, result.expected);
      }
      if (result.pos !== input.length) {
        throw new ParseError(input, result.pos, "end of input");
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
// Error reporting
// ---------------------------------------------------------------------------

/** Descriptive parse error with position context. */
export class ParseError extends Error {
  /** Zero-based position in the input where parsing failed. */
  readonly pos: number;
  /** What the parser expected at the failure position. */
  readonly expected: string;

  constructor(input: string, pos: number, expected: string) {
    const { line, col } = lineCol(input, pos);
    const snippet = input.slice(Math.max(0, pos - 10), pos + 20);
    super(`Parse error at line ${line}, col ${col}: expected ${expected}\n  ...${snippet}...`);
    this.name = "ParseError";
    this.pos = pos;
    this.expected = expected;
  }
}

/** Convert a zero-based offset to 1-based line/col. */
function lineCol(input: string, pos: number): { line: number; col: number } {
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

// ---------------------------------------------------------------------------
// Primitive parsers
// ---------------------------------------------------------------------------

/** Match an exact string literal. */
export function literal(s: string): Parser<string> {
  return mkParser((input, pos) => {
    if (input.startsWith(s, pos)) {
      return ok(s, pos + s.length);
    }
    return fail(pos, JSON.stringify(s));
  });
}

/** Match a single specific character. */
export function char(c: string): Parser<string> {
  return mkParser((input, pos) => {
    if (pos < input.length && input[pos] === c) {
      return ok(c, pos + 1);
    }
    return fail(pos, JSON.stringify(c));
  });
}

/** Match a single character in the inclusive range [from, to]. */
export function charRange(from: string, to: string): Parser<string> {
  return mkParser((input, pos) => {
    if (pos < input.length && input[pos] >= from && input[pos] <= to) {
      return ok(input[pos], pos + 1);
    }
    return fail(pos, `'${from}'..'${to}'`);
  });
}

/** Match any single character. */
export function anyChar(): Parser<string> {
  return mkParser((input, pos) => {
    if (pos < input.length) {
      return ok(input[pos], pos + 1);
    }
    return fail(pos, "any character");
  });
}

/** Match a regex anchored at the current position. */
export function regex(pattern: RegExp): Parser<string> {
  const anchored = new RegExp(pattern.source, "y");
  return mkParser((input, pos) => {
    anchored.lastIndex = pos;
    const m = anchored.exec(input);
    if (m) {
      return ok(m[0], pos + m[0].length);
    }
    return fail(pos, `/${pattern.source}/`);
  });
}

/** Match end of input. */
export function eof(): Parser<null> {
  return mkParser((input, pos) => {
    if (pos >= input.length) {
      return ok(null, pos);
    }
    return fail(pos, "end of input");
  });
}

// ---------------------------------------------------------------------------
// Sequence combinators
// ---------------------------------------------------------------------------

/** Sequence two parsers. */
export function seq<A, B>(a: Parser<A>, b: Parser<B>): Parser<[A, B]> {
  return mkParser((input, pos) => {
    const ra = a.parse(input, pos);
    if (!ra.ok) return ra as ParseResult<[A, B]>;
    const rb = b.parse(input, ra.pos);
    if (!rb.ok) return rb as ParseResult<[A, B]>;
    return ok([ra.value, rb.value] as [A, B], rb.pos);
  });
}

/** Sequence three parsers. */
export function seq3<A, B, C>(a: Parser<A>, b: Parser<B>, c: Parser<C>): Parser<[A, B, C]> {
  return mkParser((input, pos) => {
    const ra = a.parse(input, pos);
    if (!ra.ok) return ra as ParseResult<[A, B, C]>;
    const rb = b.parse(input, ra.pos);
    if (!rb.ok) return rb as ParseResult<[A, B, C]>;
    const rc = c.parse(input, rb.pos);
    if (!rc.ok) return rc as ParseResult<[A, B, C]>;
    return ok([ra.value, rb.value, rc.value] as [A, B, C], rc.pos);
  });
}

// ---------------------------------------------------------------------------
// Alternation
// ---------------------------------------------------------------------------

/** Ordered alternation (PEG): try `a` first, then `b`. */
export function alt<A, B>(a: Parser<A>, b: Parser<B>): Parser<A | B> {
  return mkParser((input, pos) => {
    const ra = a.parse(input, pos);
    if (ra.ok) return ra;
    const rb = b.parse(input, pos);
    if (rb.ok) return rb;
    return fail(Math.max(ra.pos, rb.pos), `${ra.expected} or ${rb.expected}`);
  });
}

// ---------------------------------------------------------------------------
// Repetition
// ---------------------------------------------------------------------------

/** Zero or more repetitions. Always succeeds. */
export function many<T>(p: Parser<T>): Parser<T[]> {
  return mkParser((input, pos) => {
    const results: T[] = [];
    let cur = pos;
    for (;;) {
      const r = p.parse(input, cur);
      if (!r.ok) break;
      if (r.pos === cur) break; // prevent infinite loop on zero-width match
      results.push(r.value);
      cur = r.pos;
    }
    return ok(results, cur);
  });
}

/** One or more repetitions. */
export function many1<T>(p: Parser<T>): Parser<T[]> {
  return mkParser((input, pos) => {
    const first = p.parse(input, pos);
    if (!first.ok) return first as ParseResult<T[]>;
    const results: T[] = [first.value];
    let cur = first.pos;
    for (;;) {
      const r = p.parse(input, cur);
      if (!r.ok) break;
      if (r.pos === cur) break;
      results.push(r.value);
      cur = r.pos;
    }
    return ok(results, cur);
  });
}

/** Optional: succeed with `null` if `p` fails without consuming. */
export function optional<T>(p: Parser<T>): Parser<T | null> {
  return mkParser((input, pos) => {
    const r = p.parse(input, pos);
    if (r.ok) return r;
    return ok(null, pos);
  });
}

// ---------------------------------------------------------------------------
// Lookahead / negation
// ---------------------------------------------------------------------------

/** Negative lookahead: succeed with null only if `p` fails at the current position. Does not consume input. */
export function not<T>(p: Parser<T>): Parser<null> {
  return mkParser((input, pos) => {
    const r = p.parse(input, pos);
    if (r.ok) return fail(pos, `not ${JSON.stringify(r.value)}`);
    return ok(null, pos);
  });
}

// ---------------------------------------------------------------------------
// Transformation
// ---------------------------------------------------------------------------

/** Transform a parser's result with a function. */
export function map<A, B>(p: Parser<A>, f: (a: A) => B): Parser<B> {
  return mkParser((input, pos) => {
    const r = p.parse(input, pos);
    if (!r.ok) return r as ParseResult<B>;
    return ok(f(r.value), r.pos);
  });
}

// ---------------------------------------------------------------------------
// Separation combinators
// ---------------------------------------------------------------------------

/** Zero or more items separated by `sep`. */
export function sepBy<T, S>(item: Parser<T>, sep: Parser<S>): Parser<T[]> {
  return mkParser((input, pos) => {
    const first = item.parse(input, pos);
    if (!first.ok) return ok([], pos);
    const results: T[] = [first.value];
    let cur = first.pos;
    for (;;) {
      const rs = sep.parse(input, cur);
      if (!rs.ok) break;
      const ri = item.parse(input, rs.pos);
      if (!ri.ok) break;
      results.push(ri.value);
      cur = ri.pos;
    }
    return ok(results, cur);
  });
}

/** One or more items separated by `sep`. */
export function sepBy1<T, S>(item: Parser<T>, sep: Parser<S>): Parser<T[]> {
  return mkParser((input, pos) => {
    const first = item.parse(input, pos);
    if (!first.ok) return first as ParseResult<T[]>;
    const results: T[] = [first.value];
    let cur = first.pos;
    for (;;) {
      const rs = sep.parse(input, cur);
      if (!rs.ok) break;
      const ri = item.parse(input, rs.pos);
      if (!ri.ok) break;
      results.push(ri.value);
      cur = ri.pos;
    }
    return ok(results, cur);
  });
}

/** Parse `p` between `open` and `close`, returning only the inner result. */
export function between<O, T, C>(open: Parser<O>, p: Parser<T>, close: Parser<C>): Parser<T> {
  return mkParser((input, pos) => {
    const ro = open.parse(input, pos);
    if (!ro.ok) return ro as ParseResult<T>;
    const rp = p.parse(input, ro.pos);
    if (!rp.ok) return rp;
    const rc = close.parse(input, rp.pos);
    if (!rc.ok) return rc as ParseResult<T>;
    return ok(rp.value, rc.pos);
  });
}

/** Lazy parser for recursive grammars. `f` is called on first use. */
export function lazy<T>(f: () => Parser<T>): Parser<T> {
  let cached: Parser<T> | null = null;
  return mkParser((input, pos) => {
    if (!cached) cached = f();
    return cached.parse(input, pos);
  });
}

// ---------------------------------------------------------------------------
// Convenience character-class parsers
// ---------------------------------------------------------------------------

/** Match a single ASCII digit [0-9]. */
export function digit(): Parser<string> {
  return charRange("0", "9");
}

/** Match a single ASCII letter [a-zA-Z]. */
export function letter(): Parser<string> {
  return alt(charRange("a", "z"), charRange("A", "Z"));
}

/** Match one or more whitespace characters. */
export function whitespace(): Parser<string> {
  return map(many1(regex(/[ \t\r\n]/)), (cs) => cs.join(""));
}

/** Parse `p` surrounded by optional whitespace. */
export function token<T>(p: Parser<T>): Parser<T> {
  const ws = many(regex(/[ \t\r\n]/));
  return mkParser((input, pos) => {
    const r1 = ws.parse(input, pos);
    const rp = p.parse(input, r1.ok ? r1.pos : pos);
    if (!rp.ok) return rp;
    const r2 = ws.parse(input, rp.pos);
    return ok(rp.value, r2.ok ? r2.pos : rp.pos);
  });
}

// ---------------------------------------------------------------------------
// Convenience numeric/string parsers
// ---------------------------------------------------------------------------

/** Parse an integer (with optional leading minus). */
export function integer(): Parser<number> {
  return map(seq(optional(char("-")), many1(digit())), ([sign, digits]) => {
    const n = parseInt(digits.join(""), 10);
    return sign ? -n : n;
  });
}

/** Parse a floating-point number (with optional leading minus and decimal part). */
export function float(): Parser<number> {
  return mkParser((input, pos) => {
    const r = regex(/-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/).parse(input, pos);
    if (!r.ok) return fail(pos, "float");
    return ok(parseFloat(r.value), r.pos);
  });
}

/** Parse a double-quoted string with backslash escape support. */
export function quotedString(): Parser<string> {
  return mkParser((input, pos) => {
    if (pos >= input.length || input[pos] !== '"') {
      return fail(pos, "quoted string");
    }
    let i = pos + 1;
    let value = "";
    while (i < input.length) {
      const ch = input[i];
      if (ch === "\\") {
        i++;
        if (i >= input.length) return fail(i, "escape character");
        const esc = input[i];
        switch (esc) {
          case '"':
            value += '"';
            break;
          case "\\":
            value += "\\";
            break;
          case "n":
            value += "\n";
            break;
          case "r":
            value += "\r";
            break;
          case "t":
            value += "\t";
            break;
          case "/":
            value += "/";
            break;
          default:
            value += esc;
            break;
        }
        i++;
      } else if (ch === '"') {
        return ok(value, i + 1);
      } else {
        value += ch;
        i++;
      }
    }
    return fail(pos, "closing quote");
  });
}
