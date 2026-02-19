/**
 * State Machine Parser Example
 *
 * Demonstrates using the State monad to build a parser
 * that tracks position and accumulates results.
 *
 * This shows how State can be used for:
 * - Tracking position in input
 * - Building parsers combinatorially
 * - Error recovery
 */

import { State } from "../data/state";
import { Option, Some, None } from "../data/option";
import { Either, Left, Right } from "../data/either";
import { List } from "../data/list";
import { pipe } from "../syntax/pipe";

// ============================================================================
// Parser Types
// ============================================================================

/**
 * Parser state - tracks position in input
 */
interface ParserState {
  readonly input: string;
  readonly position: number;
  readonly line: number;
  readonly column: number;
}

/**
 * Parse error
 */
interface ParseError {
  readonly message: string;
  readonly position: number;
  readonly line: number;
  readonly column: number;
}

/**
 * Parse result - either success or error
 */
type ParseResult<A> = Either<ParseError, A>;

/**
 * Parser type - State monad with parse result
 */
type Parser<A> = State<ParserState, ParseResult<A>>;

// ============================================================================
// Basic Parsers
// ============================================================================

/**
 * Create initial parser state from input
 */
function initState(input: string): ParserState {
  return {
    input,
    position: 0,
    line: 1,
    column: 1,
  };
}

/**
 * Create a parse error at current position
 */
function makeError(state: ParserState, message: string): ParseError {
  return {
    message,
    position: state.position,
    line: state.line,
    column: state.column,
  };
}

/**
 * Get current character (or None if at end)
 */
function currentChar(state: ParserState): Option<string> {
  if (state.position >= state.input.length) {
    return None;
  }
  return Some(state.input[state.position]);
}

/**
 * Advance the position by one character
 */
function advance(state: ParserState): ParserState {
  if (state.position >= state.input.length) {
    return state;
  }

  const char = state.input[state.position];
  const isNewline = char === "\n";

  return {
    input: state.input,
    position: state.position + 1,
    line: isNewline ? state.line + 1 : state.line,
    column: isNewline ? 1 : state.column + 1,
  };
}

// ============================================================================
// Primitive Parsers
// ============================================================================

/**
 * Parser that always succeeds with a value
 */
function pure<A>(value: A): Parser<A> {
  return State.pure(Right(value));
}

/**
 * Parser that always fails with a message
 */
function fail<A>(message: string): Parser<A> {
  return State.inspect((state) => Left(makeError(state, message)));
}

/**
 * Parse any single character
 */
const anyChar: Parser<string> = new State((state) => {
  const char = currentChar(state);
  if (char._tag === "None") {
    return [Left(makeError(state, "Unexpected end of input")), state];
  }
  return [Right(char.value), advance(state)];
});

/**
 * Parse a specific character
 */
function char(expected: string): Parser<string> {
  return new State((state) => {
    const char = currentChar(state);
    if (char._tag === "None") {
      return [
        Left(makeError(state, `Expected '${expected}', got end of input`)),
        state,
      ];
    }
    if (char.value !== expected) {
      return [
        Left(makeError(state, `Expected '${expected}', got '${char.value}'`)),
        state,
      ];
    }
    return [Right(char.value), advance(state)];
  });
}

/**
 * Parse a character satisfying a predicate
 */
function satisfy(
  predicate: (c: string) => boolean,
  description: string,
): Parser<string> {
  return new State((state) => {
    const c = currentChar(state);
    if (c._tag === "None") {
      return [
        Left(makeError(state, `Expected ${description}, got end of input`)),
        state,
      ];
    }
    if (!predicate(c.value)) {
      return [
        Left(makeError(state, `Expected ${description}, got '${c.value}'`)),
        state,
      ];
    }
    return [Right(c.value), advance(state)];
  });
}

/**
 * Parse a specific string
 */
function string(expected: string): Parser<string> {
  return new State((state) => {
    const remaining = state.input.slice(state.position);
    if (!remaining.startsWith(expected)) {
      return [
        Left(
          makeError(
            state,
            `Expected "${expected}", got "${remaining.slice(0, expected.length)}"`,
          ),
        ),
        state,
      ];
    }

    // Advance for each character
    let newState = state;
    for (let i = 0; i < expected.length; i++) {
      newState = advance(newState);
    }
    return [Right(expected), newState];
  });
}

/**
 * Parse end of input
 */
const eof: Parser<void> = new State((state) => {
  if (state.position < state.input.length) {
    return [Left(makeError(state, "Expected end of input")), state];
  }
  return [Right(undefined), state];
});

// ============================================================================
// Character Classes
// ============================================================================

/**
 * Parse a digit
 */
const digit: Parser<string> = satisfy((c) => /[0-9]/.test(c), "digit");

/**
 * Parse a letter
 */
const letter: Parser<string> = satisfy((c) => /[a-zA-Z]/.test(c), "letter");

/**
 * Parse a lowercase letter
 */
const lower: Parser<string> = satisfy(
  (c) => /[a-z]/.test(c),
  "lowercase letter",
);

/**
 * Parse an uppercase letter
 */
const upper: Parser<string> = satisfy(
  (c) => /[A-Z]/.test(c),
  "uppercase letter",
);

/**
 * Parse an alphanumeric character
 */
const alphaNum: Parser<string> = satisfy(
  (c) => /[a-zA-Z0-9]/.test(c),
  "alphanumeric character",
);

/**
 * Parse whitespace
 */
const whitespace: Parser<string> = satisfy((c) => /\s/.test(c), "whitespace");

/**
 * Parse a newline
 */
const newline: Parser<string> = char("\n");

// ============================================================================
// Combinators
// ============================================================================

/**
 * Map over a parser's result
 */
function map<A, B>(pa: Parser<A>, f: (a: A) => B): Parser<B> {
  return pa.map((result) =>
    result._tag === "Left"
      ? (result as Either<ParseError, B>)
      : Right(f(result.right)),
  );
}

/**
 * FlatMap (bind) for parsers
 */
function flatMap<A, B>(pa: Parser<A>, f: (a: A) => Parser<B>): Parser<B> {
  return pa.flatMap((resultA) => {
    if (resultA._tag === "Left") {
      return State.pure<ParserState, ParseResult<B>>(
        resultA as Either<ParseError, B>,
      );
    }
    return f(resultA.right);
  });
}

/**
 * Try parser, backtracking on failure
 */
function attempt<A>(pa: Parser<A>): Parser<A> {
  return new State((state) => {
    const [result, newState] = pa.run(state);
    if (result._tag === "Left") {
      // Backtrack to original state
      return [result, state];
    }
    return [result, newState];
  });
}

/**
 * Try first parser, fall back to second on failure
 */
function or<A>(pa: Parser<A>, pb: Parser<A>): Parser<A> {
  return new State((state) => {
    const [resultA, stateA] = attempt(pa).run(state);
    if (resultA._tag === "Right") {
      return [resultA, stateA];
    }
    return pb.run(state);
  });
}

/**
 * Choose from multiple parsers
 */
function choice<A>(...parsers: Parser<A>[]): Parser<A> {
  return parsers.reduce((acc, p) => or(acc, p));
}

/**
 * Parse zero or more occurrences
 */
function many<A>(pa: Parser<A>): Parser<A[]> {
  return new State((state) => {
    const results: A[] = [];
    let currentState = state;

    while (true) {
      const [result, newState] = attempt(pa).run(currentState);
      if (result._tag === "Left") {
        break;
      }
      results.push(result.right);
      currentState = newState;
    }

    return [Right(results), currentState];
  });
}

/**
 * Parse one or more occurrences
 */
function many1<A>(pa: Parser<A>): Parser<A[]> {
  return flatMap(pa, (first) => map(many(pa), (rest) => [first, ...rest]));
}

/**
 * Parse separated by a separator
 */
function sepBy<A, S>(pa: Parser<A>, sep: Parser<S>): Parser<A[]> {
  return or(
    flatMap(pa, (first) =>
      map(many(flatMap(sep, () => pa)), (rest) => [first, ...rest]),
    ),
    pure([]),
  );
}

/**
 * Parse separated by a separator (at least one)
 */
function sepBy1<A, S>(pa: Parser<A>, sep: Parser<S>): Parser<A[]> {
  return flatMap(pa, (first) =>
    map(many(flatMap(sep, () => pa)), (rest) => [first, ...rest]),
  );
}

/**
 * Parse between delimiters
 */
function between<A, O, C>(
  open: Parser<O>,
  close: Parser<C>,
  pa: Parser<A>,
): Parser<A> {
  return flatMap(open, () => flatMap(pa, (a) => map(close, () => a)));
}

/**
 * Skip whitespace
 */
const skipSpaces: Parser<void> = map(many(whitespace), () => undefined);

/**
 * Lexeme - parse and skip trailing whitespace
 */
function lexeme<A>(pa: Parser<A>): Parser<A> {
  return flatMap(pa, (a) => map(skipSpaces, () => a));
}

// ============================================================================
// JSON Parser Example
// ============================================================================

/**
 * JSON value type
 */
type JsonValue =
  | { type: "null" }
  | { type: "boolean"; value: boolean }
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "array"; value: JsonValue[] }
  | { type: "object"; value: Array<[string, JsonValue]> };

/**
 * Parse null
 */
const jsonNull: Parser<JsonValue> = map(string("null"), () => ({
  type: "null" as const,
}));

/**
 * Parse boolean
 */
const jsonBoolean: Parser<JsonValue> = choice(
  map(string("true"), () => ({ type: "boolean" as const, value: true })),
  map(string("false"), () => ({ type: "boolean" as const, value: false })),
);

/**
 * Parse number (simplified)
 */
const jsonNumber: Parser<JsonValue> = map(
  flatMap(
    or(
      map(
        flatMap(char("-"), () => many1(digit)),
        ([_, digits]) => "-" + digits.join(""),
      ),
      map(many1(digit), (digits) => digits.join("")),
    ),
    (intPart) =>
      or(
        flatMap(char("."), () =>
          map(
            many1(digit),
            (fracDigits) => intPart + "." + fracDigits.join(""),
          ),
        ),
        pure(intPart),
      ),
  ),
  (numStr) => ({ type: "number" as const, value: parseFloat(numStr) }),
);

/**
 * Parse string (simplified - no escape sequences)
 */
const jsonString: Parser<JsonValue> = between(
  char('"'),
  char('"'),
  map(
    many(satisfy((c) => c !== '"' && c !== "\n", "string character")),
    (chars) => ({
      type: "string" as const,
      value: chars.join(""),
    }),
  ),
);

/**
 * Forward declaration for recursive parsers
 */
let jsonValue: Parser<JsonValue>;

/**
 * Parse array
 */
const jsonArray: Parser<JsonValue> = between(
  lexeme(char("[")),
  char("]"),
  map(
    sepBy(new State((s) => lexeme(jsonValue).run(s)), lexeme(char(","))),
    (values) => ({ type: "array" as const, value: values }),
  ),
);

/**
 * Parse object key-value pair
 */
const jsonPair: Parser<[string, JsonValue]> = flatMap(
  lexeme(
    between(
      char('"'),
      char('"'),
      map(many(satisfy((c) => c !== '"', "key character")), (chars) =>
        chars.join(""),
      ),
    ),
  ),
  (key) =>
    flatMap(lexeme(char(":")), () =>
      map(
        new State((s) => jsonValue.run(s)),
        (value) => [key, value] as [string, JsonValue],
      ),
    ),
);

/**
 * Parse object
 */
const jsonObject: Parser<JsonValue> = between(
  lexeme(char("{")),
  char("}"),
  map(sepBy(lexeme(jsonPair), lexeme(char(","))), (pairs) => ({
    type: "object" as const,
    value: pairs,
  })),
);

/**
 * Complete JSON value parser
 */
jsonValue = lexeme(
  choice(jsonNull, jsonBoolean, jsonNumber, jsonString, jsonArray, jsonObject),
);

/**
 * Parse complete JSON document
 */
const json: Parser<JsonValue> = flatMap(skipSpaces, () =>
  flatMap(jsonValue, (value) => map(eof, () => value)),
);

// ============================================================================
// Running the Parser
// ============================================================================

/**
 * Run a parser on input
 */
export function runParser<A>(
  parser: Parser<A>,
  input: string,
): Either<ParseError, A> {
  const [result, _] = parser.run(initState(input));
  return result;
}

/**
 * Parse JSON
 */
export function parseJson(input: string): Either<ParseError, JsonValue> {
  return runParser(json, input);
}

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Format a JSON value for display
 */
function formatJson(value: JsonValue, indent: number = 0): string {
  const spaces = "  ".repeat(indent);
  switch (value.type) {
    case "null":
      return "null";
    case "boolean":
      return String(value.value);
    case "number":
      return String(value.value);
    case "string":
      return `"${value.value}"`;
    case "array":
      if (value.value.length === 0) return "[]";
      return (
        "[\n" +
        value.value
          .map((v) => spaces + "  " + formatJson(v, indent + 1))
          .join(",\n") +
        "\n" +
        spaces +
        "]"
      );
    case "object":
      if (value.value.length === 0) return "{}";
      return (
        "{\n" +
        value.value
          .map(([k, v]) => `${spaces}  "${k}": ${formatJson(v, indent + 1)}`)
          .join(",\n") +
        "\n" +
        spaces +
        "}"
      );
  }
}

/**
 * Run the parser example
 */
export function runParserExample(): void {
  console.log("=== State Machine Parser Example ===\n");

  const examples = [
    "null",
    "true",
    "42",
    '"hello world"',
    "[1, 2, 3]",
    '{"name": "Alice", "age": 30}',
    '{"users": [{"name": "Bob"}, {"name": "Carol"}]}',
  ];

  for (const example of examples) {
    console.log(`Input: ${example}`);
    const result = parseJson(example);
    if (result._tag === "Left") {
      console.log(
        `Error: ${result.left.message} at line ${result.left.line}, column ${result.left.column}`,
      );
    } else {
      console.log(`Parsed: ${formatJson(result.right)}`);
    }
    console.log("");
  }

  // Example with error
  console.log("Input: {invalid}");
  const errorResult = parseJson("{invalid}");
  if (errorResult._tag === "Left") {
    console.log(
      `Error: ${errorResult.left.message} at line ${errorResult.left.line}, column ${errorResult.left.column}`,
    );
  }
}
