/**
 * Phase 2 codegen for the `grammar` macro, built directly as TypeScript AST.
 *
 * Produces the same inline recursive-descent parser as `generateParserCode`
 * (codegen.ts), but as `ts.factory` nodes rather than source text, so the macro
 * never round-trips generated code through `ctx.parseExpression` (CLAUDE.md:
 * "prefer AST over string manipulation"). `codegen.ts` remains the
 * typescript-free string API exported from the runtime entry; the two emitters
 * must stay in step, which `codegen-parity.test.ts` checks by running both.
 *
 * BUILD-TIME ONLY: imports `typescript`; only `macros.ts` may import this.
 *
 * Hygiene: every helper and rule function is declared inside the emitted IIFE's
 * own function scope, so nothing leaks into or captures from the user's scope.
 * The only free identifiers are the globals `Map` and `Error`.
 *
 * @module
 */

import * as ts from "typescript";
import type { GrammarRule } from "./types.js";

type F = ts.NodeFactory;

/**
 * Build an expression that evaluates to a Grammar-like parser object for `rules`.
 *
 * @param factory - The node factory to build with (`ctx.factory` in a macro)
 * @param rules - Named grammar rules (from `parseGrammarDef`)
 * @param startRule - Entry rule (defaults to the first rule)
 */
export function generateParserAst(
  factory: F,
  rules: Map<string, GrammarRule>,
  startRule?: string
): ts.Expression {
  return new AstEmitter(factory).program(rules, startRule ?? rules.keys().next().value!);
}

class AstEmitter {
  private counter = 0;

  constructor(private readonly f: F) {}

  // -------------------------------------------------------------------------
  // Small node helpers
  // -------------------------------------------------------------------------

  private id(name: string): ts.Identifier {
    return this.f.createIdentifier(name);
  }

  private fresh(prefix: string): string {
    return `${prefix}${this.counter++}`;
  }

  private str(value: string): ts.StringLiteral {
    return this.f.createStringLiteral(value);
  }

  private num(value: number): ts.Expression {
    return value < 0
      ? this.f.createPrefixUnaryExpression(
          ts.SyntaxKind.MinusToken,
          this.f.createNumericLiteral(-value)
        )
      : this.f.createNumericLiteral(value);
  }

  private call(callee: ts.Expression | string, args: ts.Expression[]): ts.CallExpression {
    return this.f.createCallExpression(
      typeof callee === "string" ? this.id(callee) : callee,
      undefined,
      args
    );
  }

  private prop(obj: ts.Expression | string, name: string): ts.PropertyAccessExpression {
    return this.f.createPropertyAccessExpression(
      typeof obj === "string" ? this.id(obj) : obj,
      name
    );
  }

  private bin(
    left: ts.Expression,
    op: ts.BinaryOperator,
    right: ts.Expression
  ): ts.BinaryExpression {
    return this.f.createBinaryExpression(left, op, right);
  }

  private not(e: ts.Expression): ts.Expression {
    return this.f.createPrefixUnaryExpression(ts.SyntaxKind.ExclamationToken, e);
  }

  private ret(e: ts.Expression): ts.ReturnStatement {
    return this.f.createReturnStatement(e);
  }

  private ifThen(cond: ts.Expression, then: ts.Statement | ts.Statement[]): ts.IfStatement {
    return this.f.createIfStatement(
      cond,
      Array.isArray(then) ? this.f.createBlock(then, true) : then
    );
  }

  private varDecl(decls: Array<[string, ts.Expression]>): ts.VariableStatement {
    return this.f.createVariableStatement(
      undefined,
      this.f.createVariableDeclarationList(
        decls.map(([n, init]) => this.f.createVariableDeclaration(n, undefined, undefined, init)),
        ts.NodeFlags.None
      )
    );
  }

  private assign(name: string, value: ts.Expression): ts.ExpressionStatement {
    return this.f.createExpressionStatement(
      this.bin(this.id(name), ts.SyntaxKind.EqualsToken, value)
    );
  }

  private params(names: string[]): ts.ParameterDeclaration[] {
    return names.map((n) => this.f.createParameterDeclaration(undefined, undefined, n));
  }

  private funcExpr(paramNames: string[], body: ts.Statement[]): ts.FunctionExpression {
    return this.f.createFunctionExpression(
      undefined,
      undefined,
      undefined,
      undefined,
      this.params(paramNames),
      undefined,
      this.f.createBlock(body, true)
    );
  }

  private funcDecl(
    name: string,
    paramNames: string[],
    body: ts.Statement[]
  ): ts.FunctionDeclaration {
    return this.f.createFunctionDeclaration(
      undefined,
      undefined,
      name,
      undefined,
      this.params(paramNames),
      undefined,
      this.f.createBlock(body, true)
    );
  }

  /** `(function(input, pos) { <body> })(input, <posExpr>)` */
  private sub(body: ts.Statement[], posExpr: ts.Expression): ts.CallExpression {
    return this.call(this.f.createParenthesizedExpression(this.funcExpr(["input", "pos"], body)), [
      this.id("input"),
      posExpr,
    ]);
  }

  private okCall(value: ts.Expression, pos: ts.Expression): ts.CallExpression {
    return this.call("__ok", [value, pos]);
  }

  private failCall(pos: ts.Expression, expected: string): ts.CallExpression {
    return this.call("__fail", [pos, this.str(expected)]);
  }

  /** `input.slice(a, b)` */
  private slice(a: ts.Expression, b: ts.Expression): ts.CallExpression {
    return this.call(this.prop("input", "slice"), [a, b]);
  }

  private elem(obj: string, index: ts.Expression): ts.ElementAccessExpression {
    return this.f.createElementAccessExpression(this.id(obj), index);
  }

  private posPlus(n: number): ts.Expression {
    return this.bin(this.id("pos"), ts.SyntaxKind.PlusToken, this.num(n));
  }

  /** A JSON-compatible value as an object/array/primitive literal. */
  private json(value: unknown): ts.Expression {
    if (value === null) return this.f.createNull();
    if (typeof value === "string") return this.str(value);
    if (typeof value === "number") return this.num(value);
    if (typeof value === "boolean") return value ? this.f.createTrue() : this.f.createFalse();
    if (Array.isArray(value))
      return this.f.createArrayLiteralExpression(value.map((v) => this.json(v)));
    if (typeof value === "object") {
      return this.f.createObjectLiteralExpression(
        Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => this.f.createPropertyAssignment(this.str(k), this.json(v)))
      );
    }
    throw new Error(`grammar codegen: unexpected value in rule IR: ${String(value)}`);
  }

  // -------------------------------------------------------------------------
  // Program
  // -------------------------------------------------------------------------

  program(rules: Map<string, GrammarRule>, start: string): ts.Expression {
    const f = this.f;
    const startFn = `$${sanitizeName(start)}`;
    const body: ts.Statement[] = [];

    body.push(f.createExpressionStatement(this.str("use strict")));

    // function __ok(value, pos) { return { ok: true, value, pos, expected: "" }; }
    body.push(
      this.funcDecl(
        "__ok",
        ["value", "pos"],
        [
          this.ret(
            f.createObjectLiteralExpression([
              f.createPropertyAssignment("ok", f.createTrue()),
              f.createPropertyAssignment("value", this.id("value")),
              f.createPropertyAssignment("pos", this.id("pos")),
              f.createPropertyAssignment("expected", this.str("")),
            ])
          ),
        ]
      )
    );
    // function __fail(pos, expected) { return { ok: false, value: undefined, pos, expected }; }
    body.push(
      this.funcDecl(
        "__fail",
        ["pos", "expected"],
        [
          this.ret(
            f.createObjectLiteralExpression([
              f.createPropertyAssignment("ok", f.createFalse()),
              f.createPropertyAssignment("value", this.id("undefined")),
              f.createPropertyAssignment("pos", this.id("pos")),
              f.createPropertyAssignment("expected", this.id("expected")),
            ])
          ),
        ]
      )
    );

    // Furthest failure across rule invocations (same granularity as the runtime parseAll).
    body.push(
      this.varDecl([
        ["__furthestPos", this.num(0)],
        ["__furthestExpected", this.str("unknown")],
      ])
    );
    body.push(
      this.funcDecl(
        "__track",
        ["r"],
        [
          this.ifThen(
            this.bin(
              this.not(this.prop("r", "ok")),
              ts.SyntaxKind.AmpersandAmpersandToken,
              this.bin(
                this.prop("r", "pos"),
                ts.SyntaxKind.GreaterThanEqualsToken,
                this.id("__furthestPos")
              )
            ),
            [
              this.assign("__furthestPos", this.prop("r", "pos")),
              this.assign("__furthestExpected", this.prop("r", "expected")),
            ]
          ),
          this.ret(this.id("r")),
        ]
      )
    );

    // One function per rule: function $name(input, pos) { return __track((function(input, pos) {...})(input, pos)); }
    for (const [name, rule] of rules) {
      body.push(
        this.funcDecl(
          `$${sanitizeName(name)}`,
          ["input", "pos"],
          [this.ret(this.call("__track", [this.sub(this.rule(rule), this.id("pos"))]))]
        )
      );
    }

    // function __lineCol(input, pos) { ... }
    body.push(
      this.funcDecl(
        "__lineCol",
        ["input", "pos"],
        [
          this.varDecl([
            ["line", this.num(1)],
            ["col", this.num(1)],
          ]),
          f.createForStatement(
            f.createVariableDeclarationList(
              [f.createVariableDeclaration("i", undefined, undefined, this.num(0))],
              ts.NodeFlags.None
            ),
            this.bin(
              this.bin(this.id("i"), ts.SyntaxKind.LessThanToken, this.id("pos")),
              ts.SyntaxKind.AmpersandAmpersandToken,
              this.bin(this.id("i"), ts.SyntaxKind.LessThanToken, this.prop("input", "length"))
            ),
            f.createPostfixUnaryExpression(this.id("i"), ts.SyntaxKind.PlusPlusToken),
            f.createBlock(
              [
                f.createIfStatement(
                  this.bin(
                    this.elem("input", this.id("i")),
                    ts.SyntaxKind.EqualsEqualsEqualsToken,
                    this.str("\n")
                  ),
                  f.createBlock(
                    [
                      f.createExpressionStatement(
                        f.createPostfixUnaryExpression(this.id("line"), ts.SyntaxKind.PlusPlusToken)
                      ),
                      this.assign("col", this.num(1)),
                    ],
                    true
                  ),
                  f.createBlock(
                    [
                      f.createExpressionStatement(
                        f.createPostfixUnaryExpression(this.id("col"), ts.SyntaxKind.PlusPlusToken)
                      ),
                    ],
                    true
                  )
                ),
              ],
              true
            )
          ),
          this.ret(
            f.createObjectLiteralExpression([
              f.createPropertyAssignment("line", this.id("line")),
              f.createPropertyAssignment("col", this.id("col")),
            ])
          ),
        ]
      )
    );

    // var __rules = new Map(); __rules.set(name, <IR>); ...
    body.push(this.varDecl([["__rules", f.createNewExpression(this.id("Map"), undefined, [])]]));
    for (const [name, rule] of rules) {
      body.push(
        f.createExpressionStatement(
          this.call(this.prop("__rules", "set"), [this.str(name), this.json(rule)])
        )
      );
    }

    const parseErr = (lc: string, tail: ts.Expression): ts.ThrowStatement =>
      f.createThrowStatement(
        f.createNewExpression(this.id("Error"), undefined, [
          this.bin(
            this.bin(
              this.bin(
                this.bin(
                  this.bin(
                    this.str("Parse error at line "),
                    ts.SyntaxKind.PlusToken,
                    this.prop(lc, "line")
                  ),
                  ts.SyntaxKind.PlusToken,
                  this.str(", col ")
                ),
                ts.SyntaxKind.PlusToken,
                this.prop(lc, "col")
              ),
              ts.SyntaxKind.PlusToken,
              this.str(": expected ")
            ),
            ts.SyntaxKind.PlusToken,
            tail
          ),
        ])
      );

    const parseFn = this.funcExpr(
      ["input", "pos"],
      [
        this.ifThen(
          this.bin(this.id("pos"), ts.SyntaxKind.EqualsEqualsEqualsToken, this.id("undefined")),
          this.assign("pos", this.num(0))
        ),
        this.ret(this.call(startFn, [this.id("input"), this.id("pos")])),
      ]
    );

    const parseAllFn = this.funcExpr(
      ["input"],
      [
        this.assign("__furthestPos", this.num(0)),
        this.assign("__furthestExpected", this.str("unknown")),
        this.varDecl([["result", this.call(startFn, [this.id("input"), this.num(0)])]]),
        this.ifThen(this.not(this.prop("result", "ok")), [
          this.varDecl([
            ["lc", this.call("__lineCol", [this.id("input"), this.id("__furthestPos")])],
          ]),
          parseErr("lc", this.id("__furthestExpected")),
        ]),
        this.ifThen(
          this.bin(
            this.prop("result", "pos"),
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            this.prop("input", "length")
          ),
          [
            this.varDecl([
              ["lc2", this.call("__lineCol", [this.id("input"), this.prop("result", "pos")])],
            ]),
            parseErr("lc2", this.str("end of input")),
          ]
        ),
        this.ret(this.prop("result", "value")),
      ]
    );

    body.push(
      this.ret(
        f.createObjectLiteralExpression(
          [
            f.createPropertyAssignment("rules", this.id("__rules")),
            f.createPropertyAssignment("startRule", this.str(start)),
            f.createPropertyAssignment("parse", parseFn),
            f.createPropertyAssignment("parseAll", parseAllFn),
          ],
          true
        )
      )
    );

    return this.call(f.createParenthesizedExpression(this.funcExpr([], body)), []);
  }

  // -------------------------------------------------------------------------
  // Rules — each returns a function body that yields a ParseResult, with
  // `input` and `pos` in scope (mirrors emitRule in codegen.ts).
  // -------------------------------------------------------------------------

  private rule(rule: GrammarRule): ts.Statement[] {
    switch (rule.type) {
      case "literal":
        return this.literal(rule.value);
      case "charRange":
        return this.charRange(rule.from, rule.to);
      case "any":
        return [
          this.ifThen(
            this.bin(this.id("pos"), ts.SyntaxKind.LessThanToken, this.prop("input", "length")),
            [this.ret(this.okCall(this.elem("input", this.id("pos")), this.posPlus(1)))]
          ),
          this.ret(this.failCall(this.id("pos"), "any character")),
        ];
      case "sequence":
        return this.sequence(rule.rules);
      case "alternation":
        return this.alternation(rule.rules);
      case "repetition":
        return this.repetition(rule.rule, rule.min, rule.max);
      case "optional": {
        const r = this.fresh("opt");
        return [
          this.varDecl([[r, this.sub(this.rule(rule.rule), this.id("pos"))]]),
          this.ifThen(this.prop(r, "ok"), this.ret(this.id(r))),
          this.ret(this.okCall(this.f.createNull(), this.id("pos"))),
        ];
      }
      case "negation": {
        const neg = this.fresh("neg");
        const then = this.fresh("then");
        return [
          this.varDecl([[neg, this.sub(this.rule(rule.rule), this.id("pos"))]]),
          this.ifThen(
            this.prop(neg, "ok"),
            this.ret(this.failCall(this.id("pos"), "negation to fail"))
          ),
          this.varDecl([[then, this.sub(this.rule(rule.then), this.id("pos"))]]),
          this.ret(this.id(then)),
        ];
      }
      case "lookahead": {
        const la = this.fresh("la");
        return [
          this.varDecl([[la, this.sub(this.rule(rule.rule), this.id("pos"))]]),
          this.ifThen(this.prop(la, "ok"), this.ret(this.okCall(this.str(""), this.id("pos")))),
          this.ret(this.failCall(this.id("pos"), "positive lookahead")),
        ];
      }
      case "reference":
        return [
          this.ret(this.call(`$${sanitizeName(rule.name)}`, [this.id("input"), this.id("pos")])),
        ];
      case "action":
        // Actions are a future concern; emit the inner rule (as codegen.ts does).
        return this.rule(rule.rule);
    }
  }

  private literal(value: string): ts.Statement[] {
    if (value.length === 0) return [this.ret(this.okCall(this.str(""), this.id("pos")))];
    return [
      this.ifThen(
        this.bin(
          this.slice(this.id("pos"), this.posPlus(value.length)),
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          this.str(value)
        ),
        [this.ret(this.okCall(this.str(value), this.posPlus(value.length)))]
      ),
      this.ret(this.failCall(this.id("pos"), JSON.stringify(value))),
    ];
  }

  private charRange(from: string, to: string): ts.Statement[] {
    const cur = this.elem("input", this.id("pos"));
    const cond = this.bin(
      this.bin(
        this.bin(this.id("pos"), ts.SyntaxKind.LessThanToken, this.prop("input", "length")),
        ts.SyntaxKind.AmpersandAmpersandToken,
        this.bin(cur, ts.SyntaxKind.GreaterThanEqualsToken, this.str(from))
      ),
      ts.SyntaxKind.AmpersandAmpersandToken,
      this.bin(this.elem("input", this.id("pos")), ts.SyntaxKind.LessThanEqualsToken, this.str(to))
    );
    return [
      this.ifThen(cond, [
        this.ret(this.okCall(this.elem("input", this.id("pos")), this.posPlus(1))),
      ]),
      this.ret(this.failCall(this.id("pos"), `'${from}'..'${to}'`)),
    ];
  }

  private sequence(rules: GrammarRule[]): ts.Statement[] {
    const out: ts.Statement[] = [];
    const vals: ts.Expression[] = [];
    const cur = this.fresh("p");
    out.push(this.varDecl([[cur, this.id("pos")]]));
    for (const r of rules) {
      const rv = this.fresh("r");
      out.push(this.varDecl([[rv, this.sub(this.rule(r), this.id(cur))]]));
      out.push(this.ifThen(this.not(this.prop(rv, "ok")), this.ret(this.id(rv))));
      out.push(this.assign(cur, this.prop(rv, "pos")));
      vals.push(this.prop(rv, "value"));
    }
    out.push(
      this.ret(
        this.okCall(
          vals.length === 1 ? vals[0] : this.f.createArrayLiteralExpression(vals),
          this.id(cur)
        )
      )
    );
    return out;
  }

  private alternation(rules: GrammarRule[]): ts.Statement[] {
    const out: ts.Statement[] = [];
    const best = this.fresh("bf");
    out.push(this.varDecl([[best, this.f.createNull()]]));
    for (const r of rules) {
      const av = this.fresh("a");
      out.push(this.varDecl([[av, this.sub(this.rule(r), this.id("pos"))]]));
      out.push(this.ifThen(this.prop(av, "ok"), this.ret(this.id(av))));
      out.push(
        this.ifThen(
          this.bin(
            this.not(this.id(best)),
            ts.SyntaxKind.BarBarToken,
            this.bin(this.prop(av, "pos"), ts.SyntaxKind.GreaterThanToken, this.prop(best, "pos"))
          ),
          this.assign(best, this.id(av))
        )
      );
    }
    out.push(
      this.ret(
        this.bin(
          this.id(best),
          ts.SyntaxKind.BarBarToken,
          this.failCall(this.id("pos"), "alternation")
        )
      )
    );
    return out;
  }

  private repetition(rule: GrammarRule, min: number, max: number | null): ts.Statement[] {
    const items = this.fresh("items");
    const cur = this.fresh("rp");
    const rv = this.fresh("rr");
    const loop: ts.Statement[] = [];
    if (max !== null) {
      loop.push(
        this.ifThen(
          this.bin(this.prop(items, "length"), ts.SyntaxKind.GreaterThanEqualsToken, this.num(max)),
          this.f.createBreakStatement()
        )
      );
    }
    loop.push(this.varDecl([[rv, this.sub(this.rule(rule), this.id(cur))]]));
    loop.push(this.ifThen(this.not(this.prop(rv, "ok")), this.f.createBreakStatement()));
    loop.push(
      this.ifThen(
        this.bin(this.prop(rv, "pos"), ts.SyntaxKind.EqualsEqualsEqualsToken, this.id(cur)),
        this.f.createBreakStatement()
      )
    );
    loop.push(
      this.f.createExpressionStatement(
        this.call(this.prop(items, "push"), [this.prop(rv, "value")])
      )
    );
    loop.push(this.assign(cur, this.prop(rv, "pos")));

    const out: ts.Statement[] = [
      this.varDecl([
        [items, this.f.createArrayLiteralExpression([])],
        [cur, this.id("pos")],
      ]),
      this.f.createForStatement(undefined, undefined, undefined, this.f.createBlock(loop, true)),
    ];
    if (min > 0) {
      out.push(
        this.ifThen(
          this.bin(this.prop(items, "length"), ts.SyntaxKind.LessThanToken, this.num(min)),
          this.ret(this.failCall(this.id("pos"), `at least ${min} repetition(s)`))
        )
      );
    }
    out.push(this.ret(this.okCall(this.id(items), this.id(cur))));
    return out;
  }
}

/** Sanitize a rule name so it's a valid JS identifier suffix (same as codegen.ts). */
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}
