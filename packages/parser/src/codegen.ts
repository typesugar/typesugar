/**
 * Phase 2: Compile-time code generation for PEG grammars.
 *
 * Transforms a parsed PEG grammar IR (Map<string, GrammarRule>) into a
 * TypeScript AST expression (`ts.Expression`) for an inline recursive-descent
 * parser. The generated code has zero runtime grammar interpretation — the
 * grammar is fully compiled away.
 *
 * The parser is emitted as an IIFE that evaluates to a Grammar<T> object:
 * - parse(input, pos?) -> ParseResult<T>
 * - parseAll(input) -> T
 * - rules (Map of the original grammar rules)
 * - startRule (name of the entry rule)
 *
 * Per PEP-057 (AST-purity audit), this module builds `ts.factory.create*` nodes
 * directly instead of concatenating source strings and re-parsing. Because it now
 * imports `typescript`, it is BUILD-TIME ONLY — the macro definition in
 * `macros.ts` consumes the returned `ts.Expression` directly. It is intentionally
 * NOT re-exported from the runtime `.` entry (`index.ts`); see PEP-050.
 *
 * @module
 */

import * as ts from "typescript";
import type { GrammarRule } from "./types.js";

const K = ts.SyntaxKind;

// ---------------------------------------------------------------------------
// Variable-name counter (deterministic per invocation)
// ---------------------------------------------------------------------------

/** Counter for generating unique variable names within a codegen run */
let varCounter = 0;

function freshVar(prefix: string): string {
  return `${prefix}${varCounter++}`;
}

/** Reset the internal variable counter. Call before each codegen invocation. */
export function resetVarCounter(): void {
  varCounter = 0;
}

/** Sanitize a rule name so it's a valid JS identifier suffix */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ---------------------------------------------------------------------------
// Tiny AST-builder helpers (thread the macro's NodeFactory through)
// ---------------------------------------------------------------------------

function id(f: ts.NodeFactory, name: string): ts.Identifier {
  return f.createIdentifier(name);
}

function str(f: ts.NodeFactory, value: string): ts.StringLiteral {
  return f.createStringLiteral(value);
}

function num(f: ts.NodeFactory, value: number): ts.NumericLiteral {
  return f.createNumericLiteral(value);
}

function prop(f: ts.NodeFactory, obj: ts.Expression, name: string): ts.PropertyAccessExpression {
  return f.createPropertyAccessExpression(obj, name);
}

function elem(
  f: ts.NodeFactory,
  obj: ts.Expression,
  arg: ts.Expression
): ts.ElementAccessExpression {
  return f.createElementAccessExpression(obj, arg);
}

function bin(
  f: ts.NodeFactory,
  left: ts.Expression,
  op: ts.BinaryOperator,
  right: ts.Expression
): ts.BinaryExpression {
  return f.createBinaryExpression(left, op, right);
}

function not(f: ts.NodeFactory, e: ts.Expression): ts.PrefixUnaryExpression {
  return f.createPrefixUnaryExpression(K.ExclamationToken, e);
}

function call(f: ts.NodeFactory, callee: ts.Expression, args: ts.Expression[]): ts.CallExpression {
  return f.createCallExpression(callee, undefined, args);
}

function ret(f: ts.NodeFactory, expr?: ts.Expression): ts.ReturnStatement {
  return f.createReturnStatement(expr);
}

function param(f: ts.NodeFactory, name: string): ts.ParameterDeclaration {
  return f.createParameterDeclaration(
    undefined,
    undefined,
    id(f, name),
    undefined,
    undefined,
    undefined
  );
}

/** `var name = init;` (or multiple declarators when passed several). Uses `var` (NodeFlags.None). */
function varStmt(f: ts.NodeFactory, decls: ts.VariableDeclaration[]): ts.VariableStatement {
  return f.createVariableStatement(undefined, f.createVariableDeclarationList(decls));
}

function varDecl(f: ts.NodeFactory, name: string, init: ts.Expression): ts.VariableDeclaration {
  return f.createVariableDeclaration(id(f, name), undefined, undefined, init);
}

function pa(f: ts.NodeFactory, name: string, value: ts.Expression): ts.PropertyAssignment {
  return f.createPropertyAssignment(id(f, name), value);
}

/** Fold a list of expressions into a `a + b + c` string/number concatenation. */
function concat(f: ts.NodeFactory, parts: ts.Expression[]): ts.Expression {
  return parts.reduce((acc, p) => bin(f, acc, K.PlusToken, p));
}

/**
 * Build the inline sub-parser IIFE:
 *   (function(input, pos) { <emitRule(rule)> })(input, <posArg>)
 *
 * Each sub-rule is wrapped in its own function scope so its ParseResult can be
 * captured — exactly as the previous string-based codegen did.
 */
function subParser(f: ts.NodeFactory, rule: GrammarRule, posArg: ts.Expression): ts.Expression {
  const fn = f.createFunctionExpression(
    undefined,
    undefined,
    undefined,
    undefined,
    [param(f, "input"), param(f, "pos")],
    undefined,
    f.createBlock(emitRule(f, rule), true)
  );
  return call(f, f.createParenthesizedExpression(fn), [id(f, "input"), posArg]);
}

// ---------------------------------------------------------------------------
// Value → AST literal (JSON-safe): mirrors the old `JSON.stringify(rule)` embed
// ---------------------------------------------------------------------------

/**
 * Convert a plain JSON-safe value (the GrammarRule IR) into an equivalent
 * `ts.Expression` literal. Replaces the old `JSON.stringify(rule)` string embed.
 */
function valueToAst(f: ts.NodeFactory, value: unknown): ts.Expression {
  if (value === null) return f.createNull();

  switch (typeof value) {
    case "string":
      return str(f, value);
    case "number":
      return value < 0
        ? f.createPrefixUnaryExpression(K.MinusToken, num(f, -value))
        : num(f, value);
    case "boolean":
      return value ? f.createTrue() : f.createFalse();
    case "undefined":
      return id(f, "undefined");
  }

  if (Array.isArray(value)) {
    return f.createArrayLiteralExpression(
      value.map((v) => valueToAst(f, v)),
      false
    );
  }

  if (typeof value === "object") {
    const props = Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      f.createPropertyAssignment(str(f, k), valueToAst(f, v))
    );
    return f.createObjectLiteralExpression(props, false);
  }

  // Unreachable for GrammarRule IR (functions/symbols never appear).
  return id(f, "undefined");
}

// ---------------------------------------------------------------------------
// Code generation from GrammarRule IR
// ---------------------------------------------------------------------------

/**
 * Generate a TypeScript AST expression for an inline recursive-descent parser
 * from a map of grammar rules.
 *
 * @param factory - The macro's `ts.NodeFactory` (e.g. `ctx.factory`)
 * @param rules - Named grammar rules (from `parseGrammarDef`)
 * @param startRule - Which rule is the entry point (defaults to first rule)
 * @returns A `ts.Expression` (an IIFE) that evaluates to a Grammar-like object
 */
export function generateParserCode(
  factory: ts.NodeFactory,
  rules: Map<string, GrammarRule>,
  startRule?: string
): ts.Expression {
  varCounter = 0; // Reset per invocation for deterministic output
  const f = factory;
  const start = startRule ?? rules.keys().next().value!;

  const body: ts.Statement[] = [];

  // "use strict"; (directive prologue)
  body.push(f.createExpressionStatement(str(f, "use strict")));

  // function __ok(value, pos) { return { ok: true, value: value, pos: pos, expected: "" }; }
  body.push(
    f.createFunctionDeclaration(
      undefined,
      undefined,
      id(f, "__ok"),
      undefined,
      [param(f, "value"), param(f, "pos")],
      undefined,
      f.createBlock(
        [
          ret(
            f,
            f.createObjectLiteralExpression(
              [
                pa(f, "ok", f.createTrue()),
                pa(f, "value", id(f, "value")),
                pa(f, "pos", id(f, "pos")),
                pa(f, "expected", str(f, "")),
              ],
              false
            )
          ),
        ],
        true
      )
    )
  );

  // function __fail(pos, expected) { return { ok: false, value: undefined, pos: pos, expected: expected }; }
  body.push(
    f.createFunctionDeclaration(
      undefined,
      undefined,
      id(f, "__fail"),
      undefined,
      [param(f, "pos"), param(f, "expected")],
      undefined,
      f.createBlock(
        [
          ret(
            f,
            f.createObjectLiteralExpression(
              [
                pa(f, "ok", f.createFalse()),
                pa(f, "value", id(f, "undefined")),
                pa(f, "pos", id(f, "pos")),
                pa(f, "expected", id(f, "expected")),
              ],
              false
            )
          ),
        ],
        true
      )
    )
  );

  // A parse function for each rule: function $name(input, pos) { <emitRule> }
  for (const [name, rule] of rules) {
    body.push(
      f.createFunctionDeclaration(
        undefined,
        undefined,
        id(f, `$${sanitizeName(name)}`),
        undefined,
        [param(f, "input"), param(f, "pos")],
        undefined,
        f.createBlock(emitRule(f, rule), true)
      )
    );
  }

  // The __lineCol helper for error reporting.
  body.push(emitLineCol(f));

  // Build the rules Map for the Grammar interface.
  body.push(
    varStmt(f, [varDecl(f, "__rules", f.createNewExpression(id(f, "Map"), undefined, []))])
  );
  for (const [name, rule] of rules) {
    body.push(
      f.createExpressionStatement(
        call(f, prop(f, id(f, "__rules"), "set"), [str(f, name), valueToAst(f, rule)])
      )
    );
  }

  // Return the Grammar object.
  body.push(ret(f, emitGrammarObject(f, start)));

  // Wrap everything in an IIFE: (function() { ... })()
  const iife = f.createFunctionExpression(
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    undefined,
    f.createBlock(body, true)
  );
  return call(f, f.createParenthesizedExpression(iife), []);
}

/** `function __lineCol(input, pos) { ... }` */
function emitLineCol(f: ts.NodeFactory): ts.FunctionDeclaration {
  // if (input[i] === "\n") { line++; col = 1; } else { col++; }
  const loopBody = f.createIfStatement(
    bin(f, elem(f, id(f, "input"), id(f, "i")), K.EqualsEqualsEqualsToken, str(f, "\n")),
    f.createBlock(
      [
        f.createExpressionStatement(f.createPostfixUnaryExpression(id(f, "line"), K.PlusPlusToken)),
        f.createExpressionStatement(bin(f, id(f, "col"), K.EqualsToken, num(f, 1))),
      ],
      true
    ),
    f.createBlock(
      [f.createExpressionStatement(f.createPostfixUnaryExpression(id(f, "col"), K.PlusPlusToken))],
      true
    )
  );

  return f.createFunctionDeclaration(
    undefined,
    undefined,
    id(f, "__lineCol"),
    undefined,
    [param(f, "input"), param(f, "pos")],
    undefined,
    f.createBlock(
      [
        varStmt(f, [varDecl(f, "line", num(f, 1)), varDecl(f, "col", num(f, 1))]),
        f.createForStatement(
          f.createVariableDeclarationList([varDecl(f, "i", num(f, 0))]),
          bin(
            f,
            bin(f, id(f, "i"), K.LessThanToken, id(f, "pos")),
            K.AmpersandAmpersandToken,
            bin(f, id(f, "i"), K.LessThanToken, prop(f, id(f, "input"), "length"))
          ),
          f.createPostfixUnaryExpression(id(f, "i"), K.PlusPlusToken),
          f.createBlock([loopBody], true)
        ),
        ret(
          f,
          f.createObjectLiteralExpression(
            [pa(f, "line", id(f, "line")), pa(f, "col", id(f, "col"))],
            false
          )
        ),
      ],
      true
    )
  );
}

/** Build the returned Grammar object literal. */
function emitGrammarObject(f: ts.NodeFactory, start: string): ts.ObjectLiteralExpression {
  const startFn = id(f, `$${sanitizeName(start)}`);

  // parse: function(input, pos) { if (pos === undefined) pos = 0; return $start(input, pos); }
  const parseFn = f.createFunctionExpression(
    undefined,
    undefined,
    undefined,
    undefined,
    [param(f, "input"), param(f, "pos")],
    undefined,
    f.createBlock(
      [
        f.createIfStatement(
          bin(f, id(f, "pos"), K.EqualsEqualsEqualsToken, id(f, "undefined")),
          f.createExpressionStatement(bin(f, id(f, "pos"), K.EqualsToken, num(f, 0)))
        ),
        ret(f, call(f, startFn, [id(f, "input"), id(f, "pos")])),
      ],
      true
    )
  );

  // Two `throw new Error(...)` for the parseAll failure branches.
  const failBranch = (tail: ts.Expression): ts.Statement[] => [
    varStmt(f, [
      varDecl(
        f,
        "lc",
        call(f, id(f, "__lineCol"), [id(f, "input"), prop(f, id(f, "result"), "pos")])
      ),
    ]),
    f.createThrowStatement(
      f.createNewExpression(id(f, "Error"), undefined, [
        concat(f, [
          str(f, "Parse error at line "),
          prop(f, id(f, "lc"), "line"),
          str(f, ", col "),
          prop(f, id(f, "lc"), "col"),
          tail,
        ]),
      ])
    ),
  ];

  // parseAll: function(input) { ... }
  const parseAllFn = f.createFunctionExpression(
    undefined,
    undefined,
    undefined,
    undefined,
    [param(f, "input")],
    undefined,
    f.createBlock(
      [
        varStmt(f, [
          varDecl(f, "__furthestPos", num(f, 0)),
          varDecl(f, "__furthestExpected", str(f, "unknown")),
        ]),
        varStmt(f, [varDecl(f, "result", call(f, startFn, [id(f, "input"), num(f, 0)]))]),
        f.createIfStatement(
          not(f, prop(f, id(f, "result"), "ok")),
          f.createBlock(
            failBranch(concat(f, [str(f, ": expected "), prop(f, id(f, "result"), "expected")])),
            true
          )
        ),
        f.createIfStatement(
          bin(
            f,
            prop(f, id(f, "result"), "pos"),
            K.ExclamationEqualsEqualsToken,
            prop(f, id(f, "input"), "length")
          ),
          f.createBlock(failBranch(str(f, ": expected end of input")), true)
        ),
        ret(f, prop(f, id(f, "result"), "value")),
      ],
      true
    )
  );

  return f.createObjectLiteralExpression(
    [
      pa(f, "rules", id(f, "__rules")),
      pa(f, "startRule", str(f, start)),
      pa(f, "parse", parseFn),
      pa(f, "parseAll", parseAllFn),
    ],
    true
  );
}

/**
 * Emit statements for a single GrammarRule node.
 * The statements, when executed, produce a ParseResult. They assume `input`
 * and `pos` are in scope.
 */
function emitRule(f: ts.NodeFactory, rule: GrammarRule): ts.Statement[] {
  switch (rule.type) {
    case "literal":
      return emitLiteral(f, rule.value);
    case "charRange":
      return emitCharRange(f, rule.from, rule.to);
    case "any":
      return emitAny(f);
    case "sequence":
      return emitSequence(f, rule.rules);
    case "alternation":
      return emitAlternation(f, rule.rules);
    case "repetition":
      return emitRepetition(f, rule.rule, rule.min, rule.max);
    case "optional":
      return emitOptional(f, rule.rule);
    case "negation":
      return emitNegation(f, rule.rule, rule.then);
    case "lookahead":
      return emitLookahead(f, rule.rule);
    case "reference":
      return emitReference(f, rule.name);
    case "action":
      // Actions are a future concern; emit the inner rule
      return emitRule(f, rule.rule);
  }
}

function emitLiteral(f: ts.NodeFactory, value: string): ts.Statement[] {
  if (value.length === 0) {
    return [ret(f, call(f, id(f, "__ok"), [str(f, ""), id(f, "pos")]))];
  }

  const n = value.length;
  const slice = call(f, prop(f, id(f, "input"), "slice"), [
    id(f, "pos"),
    bin(f, id(f, "pos"), K.PlusToken, num(f, n)),
  ]);

  return [
    f.createIfStatement(
      bin(f, slice, K.EqualsEqualsEqualsToken, str(f, value)),
      f.createBlock(
        [
          ret(
            f,
            call(f, id(f, "__ok"), [str(f, value), bin(f, id(f, "pos"), K.PlusToken, num(f, n))])
          ),
        ],
        true
      )
    ),
    ret(f, call(f, id(f, "__fail"), [id(f, "pos"), str(f, JSON.stringify(value))])),
  ];
}

function emitCharRange(f: ts.NodeFactory, from: string, to: string): ts.Statement[] {
  const cond = bin(
    f,
    bin(
      f,
      bin(f, id(f, "pos"), K.LessThanToken, prop(f, id(f, "input"), "length")),
      K.AmpersandAmpersandToken,
      bin(f, elem(f, id(f, "input"), id(f, "pos")), K.GreaterThanEqualsToken, str(f, from))
    ),
    K.AmpersandAmpersandToken,
    bin(f, elem(f, id(f, "input"), id(f, "pos")), K.LessThanEqualsToken, str(f, to))
  );

  return [
    f.createIfStatement(
      cond,
      f.createBlock(
        [
          ret(
            f,
            call(f, id(f, "__ok"), [
              elem(f, id(f, "input"), id(f, "pos")),
              bin(f, id(f, "pos"), K.PlusToken, num(f, 1)),
            ])
          ),
        ],
        true
      )
    ),
    ret(f, call(f, id(f, "__fail"), [id(f, "pos"), str(f, `'${from}'..'${to}'`)])),
  ];
}

function emitAny(f: ts.NodeFactory): ts.Statement[] {
  return [
    f.createIfStatement(
      bin(f, id(f, "pos"), K.LessThanToken, prop(f, id(f, "input"), "length")),
      f.createBlock(
        [
          ret(
            f,
            call(f, id(f, "__ok"), [
              elem(f, id(f, "input"), id(f, "pos")),
              bin(f, id(f, "pos"), K.PlusToken, num(f, 1)),
            ])
          ),
        ],
        true
      )
    ),
    ret(f, call(f, id(f, "__fail"), [id(f, "pos"), str(f, "any character")])),
  ];
}

function emitSequence(f: ts.NodeFactory, rules: GrammarRule[]): ts.Statement[] {
  const stmts: ts.Statement[] = [];
  const vals: ts.Expression[] = [];
  const curPos = freshVar("p");

  stmts.push(varStmt(f, [varDecl(f, curPos, id(f, "pos"))]));

  for (const rule of rules) {
    const rVar = freshVar("r");
    stmts.push(varStmt(f, [varDecl(f, rVar, subParser(f, rule, id(f, curPos)))]));
    stmts.push(f.createIfStatement(not(f, prop(f, id(f, rVar), "ok")), ret(f, id(f, rVar))));
    stmts.push(
      f.createExpressionStatement(bin(f, id(f, curPos), K.EqualsToken, prop(f, id(f, rVar), "pos")))
    );
    vals.push(prop(f, id(f, rVar), "value"));
  }

  if (vals.length === 1) {
    stmts.push(ret(f, call(f, id(f, "__ok"), [vals[0], id(f, curPos)])));
  } else {
    stmts.push(
      ret(f, call(f, id(f, "__ok"), [f.createArrayLiteralExpression(vals, false), id(f, curPos)]))
    );
  }

  return stmts;
}

function emitAlternation(f: ts.NodeFactory, rules: GrammarRule[]): ts.Statement[] {
  const stmts: ts.Statement[] = [];
  const bestFail = freshVar("bf");
  stmts.push(varStmt(f, [varDecl(f, bestFail, f.createNull())]));

  for (const rule of rules) {
    const rVar = freshVar("a");
    stmts.push(varStmt(f, [varDecl(f, rVar, subParser(f, rule, id(f, "pos")))]));
    stmts.push(f.createIfStatement(prop(f, id(f, rVar), "ok"), ret(f, id(f, rVar))));
    // if (!bestFail || rVar.pos > bestFail.pos) bestFail = rVar;
    const cond = bin(
      f,
      not(f, id(f, bestFail)),
      K.BarBarToken,
      bin(f, prop(f, id(f, rVar), "pos"), K.GreaterThanToken, prop(f, id(f, bestFail), "pos"))
    );
    stmts.push(
      f.createIfStatement(
        cond,
        f.createExpressionStatement(bin(f, id(f, bestFail), K.EqualsToken, id(f, rVar)))
      )
    );
  }

  stmts.push(
    ret(
      f,
      bin(
        f,
        id(f, bestFail),
        K.BarBarToken,
        call(f, id(f, "__fail"), [id(f, "pos"), str(f, "alternation")])
      )
    )
  );
  return stmts;
}

function emitRepetition(
  f: ts.NodeFactory,
  rule: GrammarRule,
  min: number,
  max: number | null
): ts.Statement[] {
  const stmts: ts.Statement[] = [];
  const items = freshVar("items");
  const curPos = freshVar("rp");
  const rVar = freshVar("rr");

  stmts.push(
    varStmt(f, [
      varDecl(f, items, f.createArrayLiteralExpression([], false)),
      varDecl(f, curPos, id(f, "pos")),
    ])
  );

  const loopBody: ts.Statement[] = [];
  if (max !== null) {
    loopBody.push(
      f.createIfStatement(
        bin(f, prop(f, id(f, items), "length"), K.GreaterThanEqualsToken, num(f, max)),
        f.createBreakStatement()
      )
    );
  }
  loopBody.push(varStmt(f, [varDecl(f, rVar, subParser(f, rule, id(f, curPos)))]));
  loopBody.push(f.createIfStatement(not(f, prop(f, id(f, rVar), "ok")), f.createBreakStatement()));
  loopBody.push(
    f.createIfStatement(
      bin(f, prop(f, id(f, rVar), "pos"), K.EqualsEqualsEqualsToken, id(f, curPos)),
      f.createBreakStatement()
    )
  );
  loopBody.push(
    f.createExpressionStatement(
      call(f, prop(f, id(f, items), "push"), [prop(f, id(f, rVar), "value")])
    )
  );
  loopBody.push(
    f.createExpressionStatement(bin(f, id(f, curPos), K.EqualsToken, prop(f, id(f, rVar), "pos")))
  );

  stmts.push(f.createForStatement(undefined, undefined, undefined, f.createBlock(loopBody, true)));

  if (min > 0) {
    stmts.push(
      f.createIfStatement(
        bin(f, prop(f, id(f, items), "length"), K.LessThanToken, num(f, min)),
        ret(f, call(f, id(f, "__fail"), [id(f, "pos"), str(f, `at least ${min} repetition(s)`)]))
      )
    );
  }

  stmts.push(ret(f, call(f, id(f, "__ok"), [id(f, items), id(f, curPos)])));
  return stmts;
}

function emitOptional(f: ts.NodeFactory, rule: GrammarRule): ts.Statement[] {
  const rVar = freshVar("opt");
  return [
    varStmt(f, [varDecl(f, rVar, subParser(f, rule, id(f, "pos")))]),
    f.createIfStatement(prop(f, id(f, rVar), "ok"), ret(f, id(f, rVar))),
    ret(f, call(f, id(f, "__ok"), [f.createNull(), id(f, "pos")])),
  ];
}

function emitNegation(
  f: ts.NodeFactory,
  negRule: GrammarRule,
  thenRule: GrammarRule
): ts.Statement[] {
  const negVar = freshVar("neg");
  const thenVar = freshVar("then");

  return [
    varStmt(f, [varDecl(f, negVar, subParser(f, negRule, id(f, "pos")))]),
    f.createIfStatement(
      prop(f, id(f, negVar), "ok"),
      ret(f, call(f, id(f, "__fail"), [id(f, "pos"), str(f, "negation to fail")]))
    ),
    // The `then` part: for pure `!expr`, then is { type: "literal", value: "" }
    // which returns __ok("", pos) — i.e., consume nothing.
    varStmt(f, [varDecl(f, thenVar, subParser(f, thenRule, id(f, "pos")))]),
    ret(f, id(f, thenVar)),
  ];
}

function emitLookahead(f: ts.NodeFactory, rule: GrammarRule): ts.Statement[] {
  const laVar = freshVar("la");
  return [
    varStmt(f, [varDecl(f, laVar, subParser(f, rule, id(f, "pos")))]),
    f.createIfStatement(
      prop(f, id(f, laVar), "ok"),
      ret(f, call(f, id(f, "__ok"), [str(f, ""), id(f, "pos")]))
    ),
    ret(f, call(f, id(f, "__fail"), [id(f, "pos"), str(f, "positive lookahead")])),
  ];
}

function emitReference(f: ts.NodeFactory, name: string): ts.Statement[] {
  return [ret(f, call(f, id(f, `$${sanitizeName(name)}`), [id(f, "input"), id(f, "pos")]))];
}
