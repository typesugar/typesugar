/**
 * Condition-string evaluator shared by `config.evaluate`/`config.when` and
 * (via `evaluateConditionExpr` in ast-utils.ts) `cfg()`/`@cfgAttr`.
 *
 * This is a small tokenizer + recursive-descent parser over a fixed grammar,
 * not regex matching on the whole string, so that:
 *
 * - `===`/`!==` (the form the conditional-compilation guide documents) work
 *   the same as `==`/`!=` (deep review 2026-10, core #16/#51);
 * - `||`/`&&` inside a quoted string are not treated as operators;
 * - anything outside the grammar THROWS a `ConfigConditionError` instead of
 *   silently evaluating to false. A silent false strips code from every
 *   build with no diagnostic; a throw inside a macro is reported at the call
 *   site by the transformer's macro-expansion error handling.
 *
 * Grammar:
 *
 *   or      := and ("||" and)*
 *   and     := unary ("&&" unary)*
 *   unary   := "!" unary | primary
 *   primary := "(" or ")" | operand (eqop operand)?
 *   eqop    := "==" | "===" | "!=" | "!=="
 *   operand := path | 'string' | "string" | number | true | false | null | undefined
 *   path    := segment ("." segment)*      segment := [A-Za-z0-9_$-]+
 *
 * A path is looked up through `lookup`; an operand on its own is a truthiness
 * check. Equality is "same printed value" (`String(a) === String(b)`), so a
 * string-typed env value `"2"` equals the literal `2`, except that a missing
 * (null/undefined) value only equals `null`/`undefined` — `missing ==
 * 'undefined'` is false.
 */

/** Thrown for a condition string the grammar above does not accept. */
export class ConfigConditionError extends Error {
  constructor(
    readonly condition: string,
    reason: string
  ) {
    super(
      `Unsupported config condition "${condition}": ${reason}. ` +
        `Supported: dotted paths, 'strings', numbers, true/false/null/undefined, ` +
        `== === != !==, &&, ||, !, and parentheses.`
    );
    this.name = "ConfigConditionError";
  }
}

type Token =
  | { kind: "path"; value: string }
  | { kind: "literal"; value: string | number | boolean | null | undefined }
  | { kind: "op"; value: string };

const OPERATORS = ["===", "!==", "==", "!=", "&&", "||", "!", "(", ")"];
const KEYWORDS: Record<string, boolean | null | undefined> = {
  true: true,
  false: false,
  null: null,
  undefined: undefined,
};

function tokenize(condition: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < condition.length) {
    const ch = condition[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const op = OPERATORS.find((o) => condition.startsWith(o, i));
    if (op) {
      tokens.push({ kind: "op", value: op });
      i += op.length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let text = "";
      while (j < condition.length && condition[j] !== ch) {
        if (condition[j] === "\\" && j + 1 < condition.length) j++;
        text += condition[j];
        j++;
      }
      if (j >= condition.length) {
        throw new ConfigConditionError(condition, "unterminated string literal");
      }
      tokens.push({ kind: "literal", value: text });
      i = j + 1;
      continue;
    }
    const num = /^-?\d+(?:\.\d+)?(?![\w$.-])/.exec(condition.slice(i));
    if (num) {
      tokens.push({ kind: "literal", value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*/.exec(condition.slice(i));
    if (word) {
      const text = word[0];
      if (Object.prototype.hasOwnProperty.call(KEYWORDS, text)) {
        tokens.push({ kind: "literal", value: KEYWORDS[text] });
      } else {
        tokens.push({ kind: "path", value: text });
      }
      i += text.length;
      continue;
    }
    throw new ConfigConditionError(condition, `unexpected character '${ch}' at offset ${i}`);
  }
  return tokens;
}

function looselyEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined);
  }
  return String(a) === String(b);
}

/**
 * Evaluate `condition` against values supplied by `lookup(path)`.
 * Throws `ConfigConditionError` for anything outside the grammar.
 */
export function evaluateConfigCondition(
  condition: string,
  lookup: (path: string) => unknown
): boolean {
  const tokens = tokenize(condition);
  let pos = 0;

  const fail = (reason: string): never => {
    throw new ConfigConditionError(condition, reason);
  };
  const peekOp = (value: string): boolean =>
    pos < tokens.length && tokens[pos].kind === "op" && tokens[pos].value === value;

  const parseOperand = (): unknown => {
    const tok = tokens[pos];
    if (!tok) return fail("expected a value but the condition ended");
    if (tok.kind === "path") {
      pos++;
      return lookup(tok.value);
    }
    if (tok.kind === "literal") {
      pos++;
      return tok.value;
    }
    return fail(`expected a value but found '${tok.value}'`);
  };

  const parsePrimary = (): boolean => {
    if (peekOp("(")) {
      pos++;
      const inner = parseOr();
      if (!peekOp(")")) fail("missing ')'");
      pos++;
      return inner;
    }
    const left = parseOperand();
    const tok = tokens[pos];
    if (tok?.kind === "op" && ["==", "===", "!=", "!=="].includes(tok.value)) {
      pos++;
      const right = parseOperand();
      const equal = looselyEqual(left, right);
      return tok.value.startsWith("!") ? !equal : equal;
    }
    return !!left;
  };

  const parseUnary = (): boolean => {
    if (peekOp("!")) {
      pos++;
      return !parseUnary();
    }
    return parsePrimary();
  };

  const parseAnd = (): boolean => {
    let result = parseUnary();
    while (peekOp("&&")) {
      pos++;
      const rhs = parseUnary();
      result = result && rhs;
    }
    return result;
  };

  function parseOr(): boolean {
    let result = parseAnd();
    while (peekOp("||")) {
      pos++;
      const rhs = parseAnd();
      result = result || rhs;
    }
    return result;
  }

  // An empty condition is "nothing enabled" (long-standing, tested behaviour).
  if (tokens.length === 0) return false;
  const result = parseOr();
  if (pos < tokens.length) {
    const tok = tokens[pos];
    fail(`unexpected '${String(tok.value)}' after a complete expression`);
  }
  return result;
}
