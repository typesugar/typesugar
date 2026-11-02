/**
 * Predicate Expression Parser (runtime-pure)
 *
 * The prover receives goals and facts as predicate STRINGS (normalized from
 * the TS AST by `parser/predicate.ts`, or written by hand / produced by
 * refinement-predicate templates such as `"$ > 0 && Number.isFinite($)"`).
 * Everything the prover concludes must be justified by the *structure* of
 * those strings, so they are parsed here into a small expression tree rather
 * than matched with regexes or `String.includes` (which is how the earlier
 * rules ended up "proving" `x >= 0` from `x * x > 0`, or splitting
 * `a || b && c` on `&&`).
 *
 * This module deliberately does NOT import `typescript`: the prover is part
 * of the `@typesugar/contracts` runtime entry (PEP-050), so it needs its own
 * parser. It only accepts a conservative subset of JavaScript expression
 * syntax; anything else (regex literals, template strings, arrow functions,
 * object/array literals, assignment, `in`/`instanceof`, ...) is a parse
 * failure, and a predicate that fails to parse is simply not used — which is
 * always sound for a prover (it can only make it prove less).
 *
 * This is analysis of predicate text, not code generation: nothing parsed
 * here is ever emitted.
 */

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "nullish"; value: "null" | "undefined" }
  | { kind: "id"; name: string }
  | { kind: "member"; object: Expr; name: string }
  | { kind: "call"; callee: Expr; args: Expr[] }
  | { kind: "unary"; op: "-" | "+" | "!" | "~" | "typeof"; arg: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { kind: "cond"; test: Expr; whenTrue: Expr; whenFalse: Expr };

export type BinaryOp =
  | "||"
  | "&&"
  | "??"
  | "|"
  | "^"
  | "&"
  | "=="
  | "!="
  | "==="
  | "!=="
  | "<"
  | "<="
  | ">"
  | ">="
  | "<<"
  | ">>"
  | ">>>"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**";

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "punc"; v: string };

const PUNCTUATORS = [
  ">>>",
  "===",
  "!==",
  "**",
  "<=",
  ">=",
  "==",
  "!=",
  "&&",
  "||",
  "??",
  "<<",
  ">>",
  "(",
  ")",
  ",",
  ".",
  "!",
  "~",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "&",
  "|",
  "^",
  "?",
  ":",
];

const ID_START = /[\p{L}_$]/u;
const ID_PART = /[\p{L}\p{N}_$]/u;

function tokenize(src: string): Token[] | undefined {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // Numbers: decimal (with fraction / exponent / numeric separators), hex.
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?(?:[eE][+-]?[0-9_]+)?)/.exec(
        src.slice(i)
      );
      if (!m || m[0].length === 0) return undefined;
      const text = m[0];
      // BigInt literals (`10n`) and anything glued to an identifier char are
      // outside the subset.
      const next = src[i + text.length];
      if (next !== undefined && ID_PART.test(next)) return undefined;
      const value = Number(text.replace(/_/g, ""));
      if (Number.isNaN(value)) return undefined;
      tokens.push({ t: "num", v: value });
      i += text.length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let out = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\") {
          // Only the trivially-unambiguous escapes; anything else is a parse
          // failure rather than a guess at what the string means.
          const e = src[j + 1];
          const simple: Record<string, string> = {
            n: "\n",
            t: "\t",
            r: "\r",
            "\\": "\\",
            '"': '"',
            "'": "'",
          };
          if (e === undefined || !(e in simple)) return undefined;
          out += simple[e];
          j += 2;
          continue;
        }
        if (src[j] === "\n") return undefined;
        out += src[j];
        j++;
      }
      if (j >= src.length) return undefined;
      tokens.push({ t: "str", v: out });
      i = j + 1;
      continue;
    }
    if (ID_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j])) j++;
      tokens.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const p = PUNCTUATORS.find((q) => src.startsWith(q, i));
    if (!p) return undefined;
    // Reject `=>`, `=`, `?.`, etc. — `=` alone isn't in the table, and
    // `?.` would tokenize as `?` + `.`, which the parser rejects below.
    if (p === "?" && src[i + 1] === ".") return undefined;
    tokens.push({ t: "punc", v: p });
    i += p.length;
  }
  return tokens;
}

const KEYWORDS_REJECTED = new Set([
  "new",
  "function",
  "class",
  "this",
  "super",
  "void",
  "delete",
  "in",
  "instanceof",
  "await",
  "yield",
  "async",
  "import",
  "let",
  "const",
  "var",
]);

class Parser {
  private pos = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }

  private isPunc(v: string): boolean {
    const t = this.peek();
    return t !== undefined && t.t === "punc" && t.v === v;
  }

  private eat(v: string): boolean {
    if (this.isPunc(v)) {
      this.pos++;
      return true;
    }
    return false;
  }

  done(): boolean {
    return this.pos === this.toks.length;
  }

  parseExpr(): Expr {
    return this.parseConditional();
  }

  private parseConditional(): Expr {
    const test = this.parseBinary(0);
    if (this.eat("?")) {
      const whenTrue = this.parseConditional();
      if (!this.eat(":")) throw new Error("expected :");
      const whenFalse = this.parseConditional();
      return { kind: "cond", test, whenTrue, whenFalse };
    }
    return test;
  }

  // Precedence climbing over JS binary operators (low → high).
  private static readonly LEVELS: BinaryOp[][] = [
    ["||", "??"],
    ["&&"],
    ["|"],
    ["^"],
    ["&"],
    ["==", "!=", "===", "!=="],
    ["<", "<=", ">", ">="],
    ["<<", ">>", ">>>"],
    ["+", "-"],
    ["*", "/", "%"],
  ];

  private parseBinary(level: number): Expr {
    if (level >= Parser.LEVELS.length) return this.parseExponent();
    let left = this.parseBinary(level + 1);
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== "punc") break;
      const op = Parser.LEVELS[level].find((o) => o === t.v);
      if (!op) break;
      this.pos++;
      const right = this.parseBinary(level + 1);
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseExponent(): Expr {
    const base = this.parseUnary();
    if (this.eat("**")) {
      // Right-associative. (`-x ** 2` is a JS syntax error; we accept a
      // superset here only for `**` applied to a postfix operand.)
      if (base.kind === "unary") throw new Error("unparenthesized unary before **");
      const exp = this.parseExponent();
      return { kind: "binary", op: "**", left: base, right: exp };
    }
    return base;
  }

  private parseUnary(): Expr {
    for (const op of ["!", "-", "+", "~"] as const) {
      if (this.eat(op)) return { kind: "unary", op, arg: this.parseUnary() };
    }
    const t = this.peek();
    if (t && t.t === "id" && t.v === "typeof") {
      this.pos++;
      return { kind: "unary", op: "typeof", arg: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.eat(".")) {
        const t = this.peek();
        if (!t || t.t !== "id") throw new Error("expected property name");
        this.pos++;
        e = { kind: "member", object: e, name: t.v };
        continue;
      }
      if (this.eat("(")) {
        const args: Expr[] = [];
        if (!this.eat(")")) {
          for (;;) {
            args.push(this.parseExpr());
            if (this.eat(")")) break;
            if (!this.eat(",")) throw new Error("expected , or )");
          }
        }
        e = { kind: "call", callee: e, args };
        continue;
      }
      return e;
    }
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (!t) throw new Error("unexpected end");
    this.pos++;
    if (t.t === "num") return { kind: "num", value: t.v };
    if (t.t === "str") return { kind: "str", value: t.v };
    if (t.t === "id") {
      if (t.v === "true") return { kind: "bool", value: true };
      if (t.v === "false") return { kind: "bool", value: false };
      if (t.v === "null") return { kind: "nullish", value: "null" };
      if (t.v === "undefined") return { kind: "nullish", value: "undefined" };
      if (KEYWORDS_REJECTED.has(t.v)) throw new Error(`unsupported keyword ${t.v}`);
      return { kind: "id", name: t.v };
    }
    if (t.v === "(") {
      const inner = this.parseExpr();
      if (!this.eat(")")) throw new Error("expected )");
      return inner;
    }
    throw new Error(`unexpected ${t.v}`);
  }
}

const parseCache = new Map<string, Expr | null>();

/**
 * Parse a predicate string. Returns `undefined` for anything outside the
 * supported subset (the caller must then treat the predicate as opaque).
 */
export function parsePredicate(src: string): Expr | undefined {
  const cached = parseCache.get(src);
  if (cached !== undefined) return cached ?? undefined;
  let result: Expr | undefined;
  const toks = tokenize(src);
  if (toks && toks.length > 0) {
    try {
      const p = new Parser(toks);
      const e = p.parseExpr();
      result = p.done() ? e : undefined;
    } catch {
      result = undefined;
    }
  }
  if (parseCache.size > 5000) parseCache.clear();
  parseCache.set(src, result ?? null);
  return result;
}

/**
 * Canonical, fully parenthesized rendering — two expressions are
 * structurally equal iff their keys are equal.
 */
export function exprKey(e: Expr): string {
  switch (e.kind) {
    case "num":
      return Object.is(e.value, -0) ? "-0" : String(e.value);
    case "str":
      return JSON.stringify(e.value);
    case "bool":
      return String(e.value);
    case "nullish":
      return e.value;
    case "id":
      return e.name;
    case "member":
      return `${exprKey(e.object)}.${e.name}`;
    case "call":
      return `${exprKey(e.callee)}(${e.args.map(exprKey).join(",")})`;
    case "unary":
      return `(${e.op}${e.op === "typeof" ? " " : ""}${exprKey(e.arg)})`;
    case "binary":
      return `(${exprKey(e.left)}${e.op}${exprKey(e.right)})`;
    case "cond":
      return `(${exprKey(e.test)}?${exprKey(e.whenTrue)}:${exprKey(e.whenFalse)})`;
  }
}

/** Split a top-level `a && b && c` into its conjuncts (non-`&&` → `[e]`). */
export function conjuncts(e: Expr): Expr[] {
  if (e.kind === "binary" && e.op === "&&") {
    return [...conjuncts(e.left), ...conjuncts(e.right)];
  }
  return [e];
}

/**
 * A "variable path" — an identifier or a chain of plain property accesses on
 * one (`x`, `s.length`, `a.b.c`). Returns its canonical name, or undefined.
 */
export function variablePath(e: Expr): string | undefined {
  if (e.kind === "id") return e.name;
  if (e.kind === "member") {
    const base = variablePath(e.object);
    return base === undefined ? undefined : `${base}.${e.name}`;
  }
  return undefined;
}

/** The root identifiers mentioned anywhere in an expression. */
export function freeRoots(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.kind) {
    case "id":
      out.add(e.name);
      break;
    case "member":
      freeRoots(e.object, out);
      break;
    case "call":
      freeRoots(e.callee, out);
      e.args.forEach((a) => freeRoots(a, out));
      break;
    case "unary":
      freeRoots(e.arg, out);
      break;
    case "binary":
      freeRoots(e.left, out);
      freeRoots(e.right, out);
      break;
    case "cond":
      freeRoots(e.test, out);
      freeRoots(e.whenTrue, out);
      freeRoots(e.whenFalse, out);
      break;
    default:
      break;
  }
  return out;
}

/** Numeric literal value, accepting a unary minus/plus on a literal. */
export function numericValue(e: Expr): number | undefined {
  if (e.kind === "num") return e.value;
  if (e.kind === "unary" && (e.op === "-" || e.op === "+") && e.arg.kind === "num") {
    return e.op === "-" ? -e.arg.value : e.arg.value;
  }
  return undefined;
}

/** Root identifier of a variable path / member chain. */
export function rootOf(e: Expr): string | undefined {
  if (e.kind === "id") return e.name;
  if (e.kind === "member") return rootOf(e.object);
  return undefined;
}
