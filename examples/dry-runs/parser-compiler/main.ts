/**
 * MiniLang — A small expression language parser/compiler
 *
 * Uses TypeSugar libraries:
 * - typesugar (comptime, pipe, derive, Eq, Clone, Debug)
 * - @typesugar/parser (grammar macro, PEG combinators)
 * - @typesugar/graph (stateMachine for lexer states, digraph for AST deps)
 * - @typesugar/fp (Option, Either for parse results)
 * - @typesugar/std (match for AST pattern matching)
 * - @typesugar/collections (HashMap for symbol tables)
 * - @typesugar/hlist (heterogeneous lists for token sequences)
 */

// ============================================================
// Imports
// ============================================================

import { comptime, pipe, derive, Eq, Clone, Debug } from "typesugar";
import { grammar, digit, many1, map, token } from "@typesugar/parser";
import { stateMachine, verify, digraph, hasCycles } from "@typesugar/graph";
import { Some, None } from "@typesugar/fp";
import type { Option } from "@typesugar/fp";
import { Left, Right, fold, getOrElse, isRight } from "@typesugar/fp/data/either";
import type { Either } from "@typesugar/fp";
import { HashMap } from "@typesugar/collections";
import { eqString, hashString } from "@typesugar/std";
import { hlist, head, tail, length } from "@typesugar/hlist";

// ============================================================
// 1. Compile-time metadata
// ============================================================

const LANG_VERSION = comptime("0.1.0");
const BUILD_DATE = comptime(() => new Date().toISOString().slice(0, 10));

console.log(`MiniLang v${LANG_VERSION} (built ${BUILD_DATE})`);

// ============================================================
// 2. Lexer state machine (compile-time verified)
// ============================================================

const lexerStates = stateMachine`
  @initial Start
  @terminal Done

  Start     --digit-->    InNumber
  Start     --alpha-->    InIdent
  Start     --operator--> EmitOp
  Start     --paren-->    EmitParen
  Start     --space-->    Start
  Start     --eof-->      Done
  InNumber  --digit-->    InNumber
  InNumber  --other-->    EmitNumber
  InIdent   --alnum-->    InIdent
  InIdent   --other-->    EmitIdent
  EmitOp    --any-->      Start
  EmitParen --any-->      Start
  EmitNumber --any-->     Start
  EmitIdent  --any-->     Start
`;

const checks = verify(lexerStates);
console.log("Lexer FSM valid?", checks.valid);
console.log("States:", lexerStates.states);

// ============================================================
// 3. AST node types with @derive
// ============================================================

@derive(Eq, Clone, Debug)
class NumberLit {
  readonly kind = "number" as const;
  constructor(public value: number) {}
}

@derive(Eq, Clone, Debug)
class Ident {
  readonly kind = "ident" as const;
  constructor(public name: string) {}
}

@derive(Eq, Clone, Debug)
class BinOp {
  readonly kind = "binop" as const;
  constructor(
    public op: string,
    public left: Expr,
    public right: Expr
  ) {}
}

@derive(Eq, Clone, Debug)
class LetExpr {
  readonly kind = "let" as const;
  constructor(
    public name: string,
    public init: Expr,
    public body: Expr
  ) {}
}

type Expr = NumberLit | Ident | BinOp | LetExpr;

// ============================================================
// 4. Grammar macro — PEG grammar for MiniLang
// ============================================================

const miniLangGrammar = grammar`
  expr     = letExpr | addExpr
  letExpr  = 'let' ident '=' addExpr 'in' expr
  addExpr  = mulExpr (('+' | '-') mulExpr)*
  mulExpr  = atom (('*' | '/') atom)*
  atom     = number | ident | '(' expr ')'
  number   = '-'? '0'..'9'+
  ident    = 'a'..'z' ('a'..'z' | '0'..'9' | '_')*
`;

// ============================================================
// 5. Token types using HList for heterogeneous token sequences
// ============================================================

type Token =
  | { type: "number"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "paren"; value: string }
  | { type: "keyword"; value: string };

// Example token sequence as heterogeneous list
const sampleTokens = hlist(
  { type: "keyword" as const, value: "let" },
  { type: "ident" as const, value: "x" },
  { type: "op" as const, value: "=" },
  { type: "number" as const, value: 42 }
);
console.log("\nSample token count:", length(sampleTokens));
console.log("First token:", head(sampleTokens));

// ============================================================
// 6. Symbol table using HashMap
// ============================================================

const symbolTable = new HashMap<string, number>(eqString, hashString);

function defineVar(name: string, value: number): void {
  symbolTable.set(name, value);
}

function lookupVar(name: string): Option<number> {
  const val = symbolTable.get(name);
  return val !== undefined ? Some(val) : None;
}

// ============================================================
// 7. Tokenizer
// ============================================================

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t") { i++; continue; }
    if (ch >= "0" && ch <= "9") {
      let num = "";
      while (i < input.length && input[i] >= "0" && input[i] <= "9") {
        num += input[i++];
      }
      tokens.push({ type: "number", value: parseInt(num, 10) });
    } else if (ch >= "a" && ch <= "z") {
      let id = "";
      while (i < input.length && (input[i] >= "a" && input[i] <= "z" || input[i] === "_" || input[i] >= "0" && input[i] <= "9")) {
        id += input[i++];
      }
      if (id === "let" || id === "in") {
        tokens.push({ type: "keyword", value: id });
      } else {
        tokens.push({ type: "ident", value: id });
      }
    } else if ("+-*/".includes(ch)) {
      tokens.push({ type: "op", value: ch }); i++;
    } else if ("()".includes(ch)) {
      tokens.push({ type: "paren", value: ch }); i++;
    } else if (ch === "=") {
      tokens.push({ type: "op", value: ch }); i++;
    } else {
      i++; // skip unknown
    }
  }
  return tokens;
}

// ============================================================
// 8. Recursive descent parser using Either for errors
// ============================================================

function parseExpr(tokens: Token[], pos: number): Either<string, [Expr, number]> {
  if (pos >= tokens.length) return Left("unexpected end of input");
  const tok = tokens[pos];

  // let expression
  if (tok.type === "keyword" && tok.value === "let") {
    const nameTok = tokens[pos + 1];
    if (!nameTok || nameTok.type !== "ident") return Left("expected identifier after 'let'");
    const eqTok = tokens[pos + 2];
    if (!eqTok || eqTok.value !== "=") return Left("expected '=' after identifier");
    const valueResult = parseExpr(tokens, pos + 3);
    if (!isRight(valueResult)) return valueResult;
    const [valueExpr, nextPos] = valueResult.right;
    const inTok = tokens[nextPos];
    if (!inTok || inTok.value !== "in") return Left("expected 'in' after value expression");
    const bodyResult = parseExpr(tokens, nextPos + 1);
    if (!isRight(bodyResult)) return bodyResult;
    const [bodyExpr, finalPos] = bodyResult.right;
    return Right([new LetExpr(nameTok.value, valueExpr, bodyExpr), finalPos]);
  }

  return parseAddExpr(tokens, pos);
}

function parseAddExpr(tokens: Token[], pos: number): Either<string, [Expr, number]> {
  const leftResult = parseMulExpr(tokens, pos);
  if (!isRight(leftResult)) return leftResult;
  let [expr, curPos] = leftResult.right;

  while (curPos < tokens.length) {
    const opTok = tokens[curPos];
    if (opTok.type !== "op" || (opTok.value !== "+" && opTok.value !== "-")) break;
    const rightResult = parseMulExpr(tokens, curPos + 1);
    if (!isRight(rightResult)) return rightResult;
    const [right, nextPos] = rightResult.right;
    expr = new BinOp(opTok.value, expr, right);
    curPos = nextPos;
  }
  return Right([expr, curPos]);
}

function parseMulExpr(tokens: Token[], pos: number): Either<string, [Expr, number]> {
  const leftResult = parseAtom(tokens, pos);
  if (!isRight(leftResult)) return leftResult;
  let [expr, curPos] = leftResult.right;

  while (curPos < tokens.length) {
    const opTok = tokens[curPos];
    if (opTok.type !== "op" || (opTok.value !== "*" && opTok.value !== "/")) break;
    const rightResult = parseAtom(tokens, curPos + 1);
    if (!isRight(rightResult)) return rightResult;
    const [right, nextPos] = rightResult.right;
    expr = new BinOp(opTok.value, expr, right);
    curPos = nextPos;
  }
  return Right([expr, curPos]);
}

function parseAtom(tokens: Token[], pos: number): Either<string, [Expr, number]> {
  if (pos >= tokens.length) return Left("unexpected end of input");
  const tok = tokens[pos];

  if (tok.type === "number") {
    return Right([new NumberLit(tok.value), pos + 1]);
  }
  if (tok.type === "ident") {
    return Right([new Ident(tok.value), pos + 1]);
  }
  if (tok.type === "paren" && tok.value === "(") {
    const innerResult = parseExpr(tokens, pos + 1);
    if (!isRight(innerResult)) return innerResult;
    const [expr, nextPos] = innerResult.right;
    if (nextPos >= tokens.length || tokens[nextPos].value !== ")") {
      return Left("expected closing ')'");
    }
    return Right([expr, nextPos + 1]);
  }
  return Left(`unexpected token: ${tok.value}`);
}

// ============================================================
// 9. Evaluator — switch on discriminant + HashMap for env
// ============================================================

function evaluate(expr: Expr, env: HashMap<string, number>): Either<string, number> {
  switch (expr.kind) {
    case "number":
      return Right(expr.value);
    case "ident": {
      const val = env.get(expr.name);
      return val !== undefined ? Right(val) : Left(`undefined variable: ${expr.name}`);
    }
    case "binop": {
      const leftVal = evaluate(expr.left, env);
      if (!isRight(leftVal)) return leftVal;
      const rightVal = evaluate(expr.right, env);
      if (!isRight(rightVal)) return rightVal;
      const a = leftVal.right, b = rightVal.right;
      switch (expr.op) {
        case "+": return Right(a + b);
        case "-": return Right(a - b);
        case "*": return Right(a * b);
        case "/": return b === 0 ? Left("division by zero") : Right(a / b);
        default: return Left(`unknown operator: ${expr.op}`);
      }
    }
    case "let": {
      const valResult = evaluate(expr.init, env);
      if (!isRight(valResult)) return valResult;
      const newEnv = new HashMap<string, number>(eqString, hashString);
      for (const [k, v] of env.entries()) {
        newEnv.set(k, v);
      }
      newEnv.set(expr.name, valResult.right);
      return evaluate(expr.body, newEnv);
    }
  }
}

// ============================================================
// 10. Pattern matching on simple types (works well with match macro)
// ============================================================

function describeToken(tok: Token): string {
  // NOTE: match(tok.type) fails with "Property 'case' does not exist on type 'never'"
  // because tok.type is a union of string literals. Using switch instead.
  switch (tok.type) {
    case "number": return "numeric literal";
    case "ident": return "identifier";
    case "op": return "operator";
    case "paren": return "parenthesis";
    case "keyword": return "keyword";
    default: return "unknown";
  }
}

// ============================================================
// 11. AST dependency graph
// ============================================================

const astDeps = digraph`
  Expr -> NumberLit, Ident, BinOp, LetExpr
  BinOp -> Expr
  LetExpr -> Expr
`;

console.log("\nAST dependency graph:");
console.log("Has cycles?", hasCycles(astDeps));

// ============================================================
// 12. Combinator-based number parser
// ============================================================

const numberParser = map(many1(digit()), (ds: string[]) => parseInt(ds.join(""), 10));
const parsedNum = token(numberParser).parse("123", 0);
console.log("\nCombinator parsed number:", parsedNum?.ok ? parsedNum.value : "error");

// ============================================================
// 13. Run the full pipeline using pipe
// ============================================================

function runProgram(source: string): string {
  return pipe(
    source,
    (src: string) => tokenize(src),
    (tokens: Token[]) => parseExpr(tokens, 0),
    (result: Either<string, [Expr, number]>) => {
      if (!isRight(result)) return `Parse error: ${result.left}`;
      const [ast, _pos] = result.right;
      const env = new HashMap<string, number>(eqString, hashString);
      const evalResult = evaluate(ast, env);
      return fold(
        evalResult,
        (err: string) => `Eval error: ${err}`,
        (val: number) => `Result: ${val}`
      );
    }
  );
}

// ============================================================
// 14. Test expressions
// ============================================================

console.log("\n--- MiniLang Evaluator ---");
const programs = [
  "2 + 3",
  "2 + 3 * 4",
  "(2 + 3) * 4",
  "10 / 2 - 1",
  "let x = 5 in x + 3",
  "let x = 10 in let y = 20 in x + y",
];

for (const prog of programs) {
  console.log(`  ${prog} => ${runProgram(prog)}`);
}

// ============================================================
// 15. Grammar macro test
// ============================================================

console.log("\n--- Grammar Macro Parse ---");
const grammarTests = ["2 + 3", "(1 + 2) * 3", "42"];
for (const input of grammarTests) {
  try {
    miniLangGrammar.parse(input.trim(), 0);
    console.log(`  "${input}" => parsed OK`);
  } catch (e: any) {
    console.log(`  "${input}" => ${e.message}`);
  }
}

// ============================================================
// 16. Option-based lookups
// ============================================================

console.log("\n--- Symbol Table ---");
defineVar("pi", 3);
defineVar("e", 2);

// NOTE: Option dot-syntax (.map/.getOrElse) works via the transformer,
// but `typesugar expand` doesn't apply extension method rewrites.
// Demonstrating dot-syntax that works with the full pipeline:
const piVal = lookupVar("pi").map((v: number) => v * 100).getOrElse(() => 0);
const unknownVal = lookupVar("unknown").getOrElse(() => -1);
console.log("  pi * 100:", piVal);
console.log("  unknown:", unknownVal);

// ============================================================
// 17. Token description with match
// ============================================================

console.log("\n--- Token Descriptions ---");
const testTokens: Token[] = [
  { type: "number", value: 42 },
  { type: "ident", value: "x" },
  { type: "op", value: "+" },
  { type: "keyword", value: "let" },
];
for (const tok of testTokens) {
  console.log(`  ${JSON.stringify(tok)} => ${describeToken(tok)}`);
}

// Structural equality from @derive(Eq)
const n1 = new NumberLit(42);
const n2 = new NumberLit(42);
const n3 = new NumberLit(99);
console.log("\n--- Derived Eq ---");
console.log("  NumberLit(42) === NumberLit(42):", n1 === n2);
console.log("  NumberLit(42) === NumberLit(99):", n1 === n3);

console.log("\nDone.");
