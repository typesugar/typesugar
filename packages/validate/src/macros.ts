/**
 * @typesugar/validate — Macro definitions (BUILD-TIME ONLY).
 *
 * This entry imports `typescript` and is loaded by the transformer at build time
 * (via the `./macros` subpath). It must NOT be imported by application runtime
 * code — the runtime stubs + helpers live in the package's `.` entry. See PEP-050.
 *
 * Provides the expression macros: is<T>(), assert<T>(), validate<T>().
 *
 * Code generation is two-layered, all built with `ts.factory`:
 *
 * - `pred(type, x)` builds a pure boolean expression that is true iff `x`
 *   inhabits `type` (used directly by `is<T>()`, and for union members /
 *   recursive references inside the error-reporting layer).
 * - `checks(type, x, path)` builds statements that push `{ path, message }`
 *   records onto a local `errors` array (used by `validate<T>()` and
 *   `assert<T>()`). Nested checks only run once their container has been
 *   confirmed to be an object/array, so `null` input never crashes.
 *
 * Any type the generator cannot check precisely (type parameters, template
 * literal types, unique symbols, conditional types, ...) is a compile-time
 * ERROR, and the generated check for it is `false` (fail closed) — never a
 * silently-always-true check.
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

// ============================================================================
// Generator state
// ============================================================================

interface Gen {
  readonly ctx: MacroContext;
  readonly callExpr: ts.CallExpression;
  readonly macroName: string;
  /** Hoisted predicate functions for recursive types. */
  readonly helpers: ts.Statement[];
  /** Object types currently being expanded by `pred` (recursion detection). */
  readonly predStack: Map<ts.Type, { name: ts.Identifier; used: boolean }>;
  /** Object types currently being expanded by `checks`. */
  readonly checkStack: Set<ts.Type>;
  /** Types whose recursive helper has already been emitted. */
  readonly helperNames: Map<ts.Type, ts.Identifier>;
  /** `strictNullChecks` of the program being transformed. */
  readonly strictNullChecks: boolean;
  depth: number;
}

const MAX_DEPTH = 64;

/** Global classes whose instances are checked with `instanceof`. */
const INSTANCEOF_GLOBALS = new Set([
  "Date",
  "RegExp",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Promise",
  "Error",
  "ArrayBuffer",
  "DataView",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

type Kind =
  | { k: "any" }
  | { k: "never" }
  | { k: "typeof"; tag: string }
  | { k: "eq"; value: ts.Expression }
  | { k: "union"; members: readonly ts.Type[] }
  | { k: "intersection-prim"; members: readonly ts.Type[] }
  | { k: "array"; elem: ts.Type }
  | { k: "tuple"; ref: ts.TypeReference }
  | { k: "instance"; name: string }
  | { k: "function" }
  | { k: "nonprimitive" }
  | { k: "object" }
  | { k: "unsupported"; why: string };

const PRIMITIVE_LIKE =
  ts.TypeFlags.StringLike |
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.ESSymbolLike;

function classify(g: Gen, type: ts.Type): Kind {
  const f = g.ctx.factory;
  const checker = g.ctx.typeChecker;
  const flags = type.flags;

  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return { k: "any" };
  if (flags & ts.TypeFlags.Never) return { k: "never" };
  // `boolean` is internally `true | false`; check it before the union case.
  if (flags & ts.TypeFlags.Boolean) return { k: "typeof", tag: "boolean" };
  if (flags & ts.TypeFlags.String) return { k: "typeof", tag: "string" };
  if (flags & ts.TypeFlags.Number) return { k: "typeof", tag: "number" };
  if (flags & ts.TypeFlags.BigInt) return { k: "typeof", tag: "bigint" };
  if (flags & ts.TypeFlags.ESSymbol) return { k: "typeof", tag: "symbol" };
  if (flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void))
    return { k: "eq", value: f.createIdentifier("undefined") };
  if (flags & ts.TypeFlags.Null) return { k: "eq", value: f.createNull() };
  if (flags & ts.TypeFlags.StringLiteral)
    return { k: "eq", value: f.createStringLiteral((type as ts.StringLiteralType).value) };
  if (flags & ts.TypeFlags.NumberLiteral) {
    const v = (type as ts.NumberLiteralType).value;
    return {
      k: "eq",
      value:
        v < 0 || Object.is(v, -0)
          ? f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, f.createNumericLiteral(-v))
          : f.createNumericLiteral(v),
    };
  }
  if (flags & ts.TypeFlags.BigIntLiteral) {
    const v = (type as ts.BigIntLiteralType).value;
    const lit = f.createBigIntLiteral(v.base10Value + "n");
    return {
      k: "eq",
      value: v.negative ? f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, lit) : lit,
    };
  }
  if (flags & ts.TypeFlags.BooleanLiteral) {
    return {
      k: "eq",
      value: checker.typeToString(type) === "true" ? f.createTrue() : f.createFalse(),
    };
  }
  if (type.isUnion()) return { k: "union", members: type.types };
  // A non-union enum type (e.g. an enum with computed members) — its values are numbers.
  if (flags & ts.TypeFlags.Enum) return { k: "typeof", tag: "number" };
  if (type.isIntersection()) {
    const prims = type.types.filter((t) => t.flags & PRIMITIVE_LIKE);
    // Branded primitives (`string & { __brand: "X" }`): the object part is a
    // phantom type with no runtime representation, so only the primitive
    // part can (and should) be checked.
    if (prims.length > 0) return { k: "intersection-prim", members: prims };
    if (type.types.every((t) => t.flags & ts.TypeFlags.Object)) return { k: "object" };
    return { k: "unsupported", why: "intersection of non-object types" };
  }
  if (flags & ts.TypeFlags.NonPrimitive) return { k: "nonprimitive" };
  if (flags & ts.TypeFlags.UniqueESSymbol)
    return { k: "unsupported", why: "unique symbol types have no checkable runtime identity" };
  if (flags & (ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping))
    return { k: "unsupported", why: "template literal / string-mapping types" };
  if (flags & ts.TypeFlags.TypeParameter)
    return { k: "unsupported", why: "type parameters are not known at compile time" };
  if (flags & ts.TypeFlags.Object) {
    if (checker.isTupleType(type)) return { k: "tuple", ref: type as ts.TypeReference };
    if (checker.isArrayType(type)) {
      const elem = checker.getTypeArguments(type as ts.TypeReference)[0];
      return { k: "array", elem: elem ?? checker.getAnyType() };
    }
    const sym = type.getSymbol();
    if (
      sym &&
      INSTANCEOF_GLOBALS.has(sym.name) &&
      (sym.declarations ?? []).length > 0 &&
      (sym.declarations ?? []).every((d) =>
        g.ctx.program.isSourceFileDefaultLibrary(d.getSourceFile())
      )
    ) {
      return { k: "instance", name: sym.name };
    }
    if (
      checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
      checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0
    ) {
      return { k: "function" };
    }
    return { k: "object" };
  }
  return { k: "unsupported", why: `type kind not supported (flags ${flags})` };
}

function typeStr(g: Gen, type: ts.Type): string {
  return g.ctx.typeChecker.typeToString(type);
}

function unsupported(g: Gen, type: ts.Type, label: string, why: string): ts.Expression {
  g.ctx.reportError(
    g.callExpr,
    `${g.macroName}<...>(): cannot generate a runtime check for type '${typeStr(g, type)}' ` +
      `at ${label}: ${why}. Narrow the type, or validate this part by hand.`
  );
  // Fail closed: if the error is ignored, the generated validator rejects.
  return g.ctx.factory.createFalse();
}

// ============================================================================
// Small AST helpers
// ============================================================================

function and(f: ts.NodeFactory, parts: ts.Expression[]): ts.Expression {
  const real = parts.filter((p) => p.kind !== ts.SyntaxKind.TrueKeyword);
  if (real.length === 0) return f.createTrue();
  return real
    .map((p) => f.createParenthesizedExpression(p) as ts.Expression)
    .reduce((a, b) => f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b));
}

function or(f: ts.NodeFactory, parts: ts.Expression[]): ts.Expression {
  if (parts.length === 0) return f.createFalse();
  if (parts.some((p) => p.kind === ts.SyntaxKind.TrueKeyword)) return f.createTrue();
  return parts
    .map((p) => f.createParenthesizedExpression(p) as ts.Expression)
    .reduce((a, b) => f.createBinaryExpression(a, ts.SyntaxKind.BarBarToken, b));
}

function not(f: ts.NodeFactory, e: ts.Expression): ts.Expression {
  return f.createPrefixUnaryExpression(
    ts.SyntaxKind.ExclamationToken,
    f.createParenthesizedExpression(e)
  );
}

function typeofIs(f: ts.NodeFactory, x: ts.Expression, tag: string): ts.Expression {
  return f.createBinaryExpression(
    f.createTypeOfExpression(x),
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    f.createStringLiteral(tag)
  );
}

function strictEq(f: ts.NodeFactory, x: ts.Expression, v: ts.Expression): ts.Expression {
  return f.createBinaryExpression(x, ts.SyntaxKind.EqualsEqualsEqualsToken, v);
}

function isObjectExpr(f: ts.NodeFactory, x: ts.Expression): ts.Expression {
  return and(f, [
    typeofIs(f, x, "object"),
    f.createBinaryExpression(x, ts.SyntaxKind.ExclamationEqualsEqualsToken, f.createNull()),
  ]);
}

function isArrayExpr(f: ts.NodeFactory, x: ts.Expression): ts.Expression {
  return f.createCallExpression(
    f.createPropertyAccessExpression(f.createIdentifier("Array"), "isArray"),
    undefined,
    [x]
  );
}

/**
 * `(x as Record<string, unknown>)` / `(x as unknown[])`. The value under test
 * is `unknown`, and TypeScript does not narrow a property path such as
 * `value.addr` from a `typeof … === "object"` test, so every read of a member
 * or element goes through one of these casts to keep the generated code
 * type-correct under strictOutput.
 */
function asRecord(f: ts.NodeFactory, x: ts.Expression): ts.Expression {
  return f.createParenthesizedExpression(
    f.createAsExpression(
      x,
      f.createTypeReferenceNode("Record", [
        f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
      ])
    )
  );
}

function asArray(f: ts.NodeFactory, x: ts.Expression): ts.Expression {
  return f.createParenthesizedExpression(
    f.createAsExpression(
      x,
      f.createArrayTypeNode(f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword))
    )
  );
}

function lengthOf(f: ts.NodeFactory, x: ts.Expression): ts.Expression {
  return f.createPropertyAccessExpression(x, "length");
}

/** ASCII identifier test for property names (a name check, not code rewriting). */
function isPlainIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/** `x.name` when `name` is an identifier, otherwise `x["name"]`. */
function memberAccess(f: ts.NodeFactory, x: ts.Expression, name: string): ts.Expression {
  const r = asRecord(f, x);
  return isPlainIdentifier(name)
    ? f.createPropertyAccessExpression(r, f.createIdentifier(name))
    : f.createElementAccessExpression(r, f.createStringLiteral(name));
}

function memberLabel(name: string): string {
  return isPlainIdentifier(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

/** Properties that have a string name we can read at runtime (skips symbol / #private keys). */
function checkableProperties(g: Gen, type: ts.Type): ts.Symbol[] {
  return g.ctx.typeChecker.getPropertiesOfType(type).filter((p) => {
    const esc = p.escapedName as string;
    return !esc.startsWith("__@") && !esc.startsWith("__#");
  });
}

function stringIndexType(g: Gen, type: ts.Type): ts.Type | undefined {
  const infos = g.ctx.typeChecker.getIndexInfosOfType(type);
  const info =
    infos.find((i) => i.keyType.flags & ts.TypeFlags.String) ??
    infos.find((i) => i.keyType.flags & ts.TypeFlags.Number);
  return info?.type;
}

/** `xs.every((e) => body(e))` */
function everyExpr(
  f: ts.NodeFactory,
  xs: ts.Expression,
  body: (e: ts.Identifier) => ts.Expression
): ts.Expression {
  const e = f.createUniqueName("e");
  return f.createCallExpression(f.createPropertyAccessExpression(xs, "every"), undefined, [
    f.createArrowFunction(
      undefined,
      undefined,
      [f.createParameterDeclaration(undefined, undefined, e)],
      undefined,
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      body(e)
    ),
  ]);
}

function objectKeys(f: ts.NodeFactory, x: ts.Expression): ts.Expression {
  return f.createCallExpression(
    f.createPropertyAccessExpression(f.createIdentifier("Object"), "keys"),
    undefined,
    [x]
  );
}

/**
 * Without `strictNullChecks` the checker erases `null`/`undefined` from
 * unions (`string | null` is just `string`), so a field the user explicitly
 * declared nullable would wrongly reject `null`. Recover those alternatives
 * from the declared type node. (With strictNullChecks the type itself carries
 * them and this returns nothing.)
 */
function declaredNullish(g: Gen, typeNode: ts.TypeNode | undefined): ts.Expression[] {
  if (g.strictNullChecks || !typeNode) return [];
  let n: ts.TypeNode = typeNode;
  while (ts.isParenthesizedTypeNode(n)) n = n.type;
  const members = ts.isUnionTypeNode(n) ? n.types : [n];
  const out: ts.Expression[] = [];
  for (const m of members) {
    if (ts.isLiteralTypeNode(m) && m.literal.kind === ts.SyntaxKind.NullKeyword) {
      out.push(g.ctx.factory.createNull());
    } else if (m.kind === ts.SyntaxKind.UndefinedKeyword) {
      out.push(g.ctx.factory.createIdentifier("undefined"));
    }
  }
  return out;
}

function propTypeNode(prop: ts.Symbol): ts.TypeNode | undefined {
  const d = prop.valueDeclaration;
  return d && (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d) || ts.isParameter(d))
    ? d.type
    : undefined;
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_$]/g, "_").slice(0, 40) || "T";
}

// ============================================================================
// Predicate layer
// ============================================================================

function pred(g: Gen, type: ts.Type, x: ts.Expression, label: string): ts.Expression {
  const f = g.ctx.factory;
  if (g.depth > MAX_DEPTH) return unsupported(g, type, label, "type is nested too deeply");
  const kind = classify(g, type);
  switch (kind.k) {
    case "any":
      return f.createTrue();
    case "never":
      return f.createFalse();
    case "typeof":
      return typeofIs(f, x, kind.tag);
    case "eq":
      return strictEq(f, x, kind.value);
    case "union": {
      const members = collapseBooleans(g, kind.members);
      return or(
        f,
        members.map((m) => (m === "boolean" ? typeofIs(f, x, "boolean") : pred(g, m, x, label)))
      );
    }
    case "intersection-prim":
      return and(
        f,
        kind.members.map((m) => pred(g, m, x, label))
      );
    case "instance":
      return f.createBinaryExpression(
        x,
        ts.SyntaxKind.InstanceOfKeyword,
        f.createIdentifier(kind.name)
      );
    case "function":
      return typeofIs(f, x, "function");
    case "nonprimitive":
      return or(f, [isObjectExpr(f, x), typeofIs(f, x, "function")]);
    case "unsupported":
      return unsupported(g, type, label, kind.why);
    case "array":
    case "tuple":
    case "object":
      return structuralPred(g, type, kind, x, label);
  }
}

/** Replace a `true` + `false` literal pair in a union by the `boolean` marker. */
function collapseBooleans(g: Gen, members: readonly ts.Type[]): (ts.Type | "boolean")[] {
  const isBoolLit = (t: ts.Type) => (t.flags & ts.TypeFlags.BooleanLiteral) !== 0;
  const bools = members.filter(isBoolLit);
  if (bools.length < 2) return [...members];
  const out: (ts.Type | "boolean")[] = members.filter((t) => !isBoolLit(t));
  out.push("boolean");
  return out;
}

/**
 * Array / tuple / object predicates. These are the only kinds that can
 * recurse, so recursion is detected here: a type re-entered while it is
 * still being expanded is emitted once as a hoisted helper function and
 * referenced by name.
 */
function structuralPred(
  g: Gen,
  type: ts.Type,
  kind: Kind,
  x: ts.Expression,
  label: string
): ts.Expression {
  const f = g.ctx.factory;
  const existing = g.helperNames.get(type);
  if (existing) return f.createCallExpression(existing, undefined, [x]);
  const onStack = g.predStack.get(type);
  if (onStack) {
    onStack.used = true;
    return f.createCallExpression(onStack.name, undefined, [x]);
  }

  const entry = {
    name: f.createUniqueName("__is_" + sanitize(typeStr(g, type))),
    used: false,
  };
  g.predStack.set(type, entry);
  g.depth++;
  let body = structuralBody(g, type, kind, x, label);
  if (entry.used) {
    // Recursive: emit `function __is_T(v) { return <body over v>; }` once.
    const v = f.createUniqueName("v");
    body = structuralBody(g, type, kind, v, label);
    g.helpers.push(
      f.createFunctionDeclaration(
        undefined,
        undefined,
        entry.name,
        undefined,
        [
          f.createParameterDeclaration(
            undefined,
            undefined,
            v,
            undefined,
            f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)
          ),
        ],
        f.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword),
        f.createBlock([f.createReturnStatement(body)], true)
      )
    );
    g.helperNames.set(type, entry.name);
    body = f.createCallExpression(entry.name, undefined, [x]);
  }
  g.depth--;
  g.predStack.delete(type);
  return body;
}

function structuralBody(
  g: Gen,
  type: ts.Type,
  kind: Kind,
  x: ts.Expression,
  label: string
): ts.Expression {
  const f = g.ctx.factory;
  const checker = g.ctx.typeChecker;

  if (kind.k === "array") {
    return and(f, [
      isArrayExpr(f, x),
      everyExpr(f, asArray(f, x), (e) => pred(g, kind.elem, e, label + "[]")),
    ]);
  }

  if (kind.k === "tuple") {
    const t = tupleInfo(g, kind.ref);
    if ("why" in t) return unsupported(g, type, label, t.why);
    const parts: ts.Expression[] = [
      isArrayExpr(f, x),
      f.createBinaryExpression(
        lengthOf(f, asArray(f, x)),
        ts.SyntaxKind.GreaterThanEqualsToken,
        f.createNumericLiteral(t.minLength)
      ),
    ];
    if (!t.rest) {
      parts.push(
        f.createBinaryExpression(
          lengthOf(f, asArray(f, x)),
          ts.SyntaxKind.LessThanEqualsToken,
          f.createNumericLiteral(t.fixed.length)
        )
      );
    }
    t.fixed.forEach((el, i) => {
      const ex = f.createElementAccessExpression(asArray(f, x), f.createNumericLiteral(i));
      const p = pred(g, el.type, ex, `${label}[${i}]`);
      parts.push(el.optional ? or(f, [strictEq(f, ex, f.createIdentifier("undefined")), p]) : p);
    });
    if (t.rest) {
      const restType = t.rest;
      const sliced = f.createCallExpression(
        f.createPropertyAccessExpression(asArray(f, x), "slice"),
        undefined,
        [f.createNumericLiteral(t.fixed.length)]
      );
      parts.push(everyExpr(f, sliced, (e) => pred(g, restType, e, `${label}[...]`)));
    }
    return and(f, parts);
  }

  // Plain object.
  const parts: ts.Expression[] = [isObjectExpr(f, x)];
  for (const prop of checkableProperties(g, type)) {
    const propType = checker.getTypeOfSymbolAtLocation(prop, g.callExpr);
    const acc = memberAccess(f, x, prop.name);
    const p = pred(g, propType, acc, label + memberLabel(prop.name));
    const extra = declaredNullish(g, propTypeNode(prop)).map((v) => strictEq(f, acc, v));
    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
    if (optional) extra.unshift(strictEq(f, acc, f.createIdentifier("undefined")));
    parts.push(extra.length > 0 ? or(f, [...extra, p]) : p);
  }
  const idx = stringIndexType(g, type);
  if (idx) {
    parts.push(
      everyExpr(f, objectKeys(f, asRecord(f, x)), (k) =>
        pred(g, idx, f.createElementAccessExpression(asRecord(f, x), k), label + "[key]")
      )
    );
  }
  return and(f, parts);
}

interface TupleShape {
  fixed: { type: ts.Type; optional: boolean }[];
  rest?: ts.Type;
  minLength: number;
}

function tupleInfo(g: Gen, ref: ts.TypeReference): TupleShape | { why: string } {
  const target = ref.target as ts.TupleType;
  const args = g.ctx.typeChecker.getTypeArguments(ref);
  const flags = target.elementFlags;
  const fixed: TupleShape["fixed"] = [];
  let rest: ts.Type | undefined;
  for (let i = 0; i < flags.length; i++) {
    const fl = flags[i];
    if (fl & ts.ElementFlags.Variadic) return { why: "variadic tuple elements" };
    if (fl & ts.ElementFlags.Rest) {
      if (i !== flags.length - 1) return { why: "tuple rest element that is not last" };
      rest = args[i];
    } else {
      fixed.push({ type: args[i], optional: (fl & ts.ElementFlags.Optional) !== 0 });
    }
  }
  return { fixed, rest, minLength: target.minLength };
}

// ============================================================================
// Error-reporting layer
// ============================================================================

function errorPush(f: ts.NodeFactory, pathExpr: ts.Expression, message: string): ts.Statement {
  return f.createExpressionStatement(
    f.createCallExpression(
      f.createPropertyAccessExpression(f.createIdentifier("errors"), "push"),
      undefined,
      [
        f.createObjectLiteralExpression([
          f.createPropertyAssignment(f.createIdentifier("path"), pathExpr),
          f.createPropertyAssignment(f.createIdentifier("message"), f.createStringLiteral(message)),
        ]),
      ]
    )
  );
}

function appendPath(
  f: ts.NodeFactory,
  pathExpr: ts.Expression,
  suffix: ts.Expression
): ts.Expression {
  return f.createBinaryExpression(pathExpr, ts.SyntaxKind.PlusToken, suffix);
}

function predCheck(
  g: Gen,
  type: ts.Type,
  x: ts.Expression,
  pathExpr: ts.Expression,
  label: string
): ts.Statement[] {
  const f = g.ctx.factory;
  const p = pred(g, type, x, label);
  if (p.kind === ts.SyntaxKind.TrueKeyword) return [];
  const kind = classify(g, type);
  const message = kind.k === "typeof" ? `expected ${kind.tag}` : `expected ${typeStr(g, type)}`;
  return [f.createIfStatement(not(f, p), f.createBlock([errorPush(f, pathExpr, message)], true))];
}

function checks(
  g: Gen,
  type: ts.Type,
  x: ts.Expression,
  pathExpr: ts.Expression,
  label: string
): ts.Statement[] {
  const f = g.ctx.factory;
  const kind = classify(g, type);

  // `T | undefined` / `T | null` with a single structural `T`: report T's
  // detailed errors when the value is present.
  if (kind.k === "union") {
    const nullish = kind.members.filter(
      (m) => m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Null)
    );
    const rest = kind.members.filter((m) => !nullish.includes(m));
    if (rest.length === 1 && nullish.length > 0) {
      const inner = classify(g, rest[0]);
      if (inner.k === "object" || inner.k === "array" || inner.k === "tuple") {
        return [
          f.createIfStatement(
            not(
              f,
              or(
                f,
                nullish.map((n) => pred(g, n, x, label))
              )
            ),
            f.createBlock(checks(g, rest[0], x, pathExpr, label), true)
          ),
        ];
      }
    }
    return predCheck(g, type, x, pathExpr, label);
  }

  if (kind.k !== "object" && kind.k !== "array" && kind.k !== "tuple") {
    return predCheck(g, type, x, pathExpr, label);
  }

  // Recursive reference: fall back to the (hoisted-helper) predicate.
  if (g.checkStack.has(type) || g.depth > MAX_DEPTH) {
    return predCheck(g, type, x, pathExpr, label);
  }
  g.checkStack.add(type);
  g.depth++;
  try {
    if (kind.k === "array") {
      const i = f.createUniqueName("i");
      const elemChecks = checks(
        g,
        kind.elem,
        f.createElementAccessExpression(asArray(f, x), i),
        appendPath(
          f,
          pathExpr,
          f.createBinaryExpression(
            f.createStringLiteral("["),
            ts.SyntaxKind.PlusToken,
            f.createBinaryExpression(i, ts.SyntaxKind.PlusToken, f.createStringLiteral("]"))
          )
        ),
        label + "[]"
      );
      const elseBlock =
        elemChecks.length > 0
          ? f.createBlock(
              [
                f.createForStatement(
                  f.createVariableDeclarationList(
                    [
                      f.createVariableDeclaration(
                        i,
                        undefined,
                        undefined,
                        f.createNumericLiteral(0)
                      ),
                    ],
                    ts.NodeFlags.Let
                  ),
                  f.createBinaryExpression(
                    i,
                    ts.SyntaxKind.LessThanToken,
                    lengthOf(f, asArray(f, x))
                  ),
                  f.createPostfixUnaryExpression(i, ts.SyntaxKind.PlusPlusToken),
                  f.createBlock(elemChecks, true)
                ),
              ],
              true
            )
          : undefined;
      return [
        f.createIfStatement(
          not(f, isArrayExpr(f, x)),
          f.createBlock([errorPush(f, pathExpr, "expected array")], true),
          elseBlock
        ),
      ];
    }

    if (kind.k === "tuple") {
      const t = tupleInfo(g, kind.ref);
      if ("why" in t) {
        return predCheck(g, type, x, pathExpr, label);
      }
      const shape: ts.Expression[] = [
        isArrayExpr(f, x),
        f.createBinaryExpression(
          lengthOf(f, asArray(f, x)),
          ts.SyntaxKind.GreaterThanEqualsToken,
          f.createNumericLiteral(t.minLength)
        ),
      ];
      if (!t.rest) {
        shape.push(
          f.createBinaryExpression(
            lengthOf(f, asArray(f, x)),
            ts.SyntaxKind.LessThanEqualsToken,
            f.createNumericLiteral(t.fixed.length)
          )
        );
      }
      const inner: ts.Statement[] = [];
      t.fixed.forEach((el, idx) => {
        const ex = f.createElementAccessExpression(asArray(f, x), f.createNumericLiteral(idx));
        const c = checks(
          g,
          el.type,
          ex,
          appendPath(f, pathExpr, f.createStringLiteral(`[${idx}]`)),
          `${label}[${idx}]`
        );
        if (c.length === 0) return;
        inner.push(
          el.optional
            ? f.createIfStatement(
                f.createBinaryExpression(
                  ex,
                  ts.SyntaxKind.ExclamationEqualsEqualsToken,
                  f.createIdentifier("undefined")
                ),
                f.createBlock(c, true)
              )
            : f.createBlock(c, true)
        );
      });
      if (t.rest) {
        const restType = t.rest;
        const restPred = everyExpr(
          f,
          f.createCallExpression(
            f.createPropertyAccessExpression(asArray(f, x), "slice"),
            undefined,
            [f.createNumericLiteral(t.fixed.length)]
          ),
          (e) => pred(g, restType, e, `${label}[...]`)
        );
        inner.push(
          f.createIfStatement(
            not(f, restPred),
            f.createBlock(
              [errorPush(f, pathExpr, `expected rest elements of ${typeStr(g, restType)}`)],
              true
            )
          )
        );
      }
      return [
        f.createIfStatement(
          not(f, and(f, shape)),
          f.createBlock([errorPush(f, pathExpr, `expected ${typeStr(g, type)}`)], true),
          inner.length > 0 ? f.createBlock(inner, true) : undefined
        ),
      ];
    }

    // Plain object: property checks only run once `x` is known to be a non-null object.
    const inner: ts.Statement[] = [];
    for (const prop of checkableProperties(g, type)) {
      const propType = g.ctx.typeChecker.getTypeOfSymbolAtLocation(prop, g.callExpr);
      const acc = memberAccess(f, x, prop.name);
      const c = checks(
        g,
        propType,
        acc,
        appendPath(f, pathExpr, f.createStringLiteral(memberLabel(prop.name))),
        label + memberLabel(prop.name)
      );
      if (c.length === 0) continue;
      const skip = declaredNullish(g, propTypeNode(prop)).map((v) => strictEq(f, acc, v));
      if (prop.flags & ts.SymbolFlags.Optional) {
        skip.unshift(strictEq(f, acc, f.createIdentifier("undefined")));
      }
      inner.push(
        ...(skip.length > 0
          ? [f.createIfStatement(not(f, or(f, skip)), f.createBlock(c, true))]
          : c)
      );
    }
    const idx = stringIndexType(g, type);
    if (idx) {
      const k = f.createUniqueName("k");
      const c = checks(
        g,
        idx,
        f.createElementAccessExpression(asRecord(f, x), k),
        appendPath(
          f,
          pathExpr,
          f.createBinaryExpression(
            f.createStringLiteral("["),
            ts.SyntaxKind.PlusToken,
            f.createBinaryExpression(
              f.createCallExpression(
                f.createPropertyAccessExpression(f.createIdentifier("JSON"), "stringify"),
                undefined,
                [k]
              ),
              ts.SyntaxKind.PlusToken,
              f.createStringLiteral("]")
            )
          )
        ),
        label + "[key]"
      );
      if (c.length > 0) {
        inner.push(
          f.createForOfStatement(
            undefined,
            f.createVariableDeclarationList([f.createVariableDeclaration(k)], ts.NodeFlags.Const),
            objectKeys(f, asRecord(f, x)),
            f.createBlock(c, true)
          )
        );
      }
    }
    return [
      f.createIfStatement(
        not(f, isObjectExpr(f, x)),
        f.createBlock([errorPush(f, pathExpr, "expected object")], true),
        inner.length > 0 ? f.createBlock(inner, true) : undefined
      ),
    ];
  } finally {
    g.depth--;
    g.checkStack.delete(type);
  }
}

// ============================================================================
// Macro plumbing
// ============================================================================

function newGen(ctx: MacroContext, callExpr: ts.CallExpression, macroName: string): Gen {
  return {
    ctx,
    callExpr,
    macroName,
    helpers: [],
    predStack: new Map(),
    checkStack: new Set(),
    helperNames: new Map(),
    strictNullChecks: !!(
      ctx.program.getCompilerOptions().strictNullChecks ?? ctx.program.getCompilerOptions().strict
    ),
    depth: 0,
  };
}

function valueParam(f: ts.NodeFactory): ts.ParameterDeclaration {
  return f.createParameterDeclaration(
    undefined,
    undefined,
    f.createIdentifier("value"),
    undefined,
    f.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
  );
}

/** `const errors: { path: string; message: string }[] = [];` */
function errorsDecl(f: ts.NodeFactory): ts.Statement {
  return f.createVariableStatement(
    undefined,
    f.createVariableDeclarationList(
      [
        f.createVariableDeclaration(
          "errors",
          undefined,
          f.createArrayTypeNode(
            f.createTypeLiteralNode([
              f.createPropertySignature(
                undefined,
                "path",
                undefined,
                f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
              ),
              f.createPropertySignature(
                undefined,
                "message",
                undefined,
                f.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
              ),
            ])
          ),
          f.createArrayLiteralExpression([])
        ),
      ],
      ts.NodeFlags.Const
    )
  );
}

/**
 * Wrap the validator arrow so recursive helpers are defined once:
 * `(() => { function __is_T(v) {...} return <arrow>; })()`.
 */
function withHelpers(g: Gen, arrow: ts.Expression): ts.Expression {
  if (g.helpers.length === 0) return arrow;
  const f = g.ctx.factory;
  return f.createCallExpression(
    f.createParenthesizedExpression(
      f.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        f.createBlock([...g.helpers, f.createReturnStatement(arrow)], true)
      )
    ),
    undefined,
    []
  );
}

/** Top-level predicate, honouring nullish alternatives lost without strictNullChecks. */
function topPred(g: Gen, typeNode: ts.TypeNode, type: ts.Type, x: ts.Expression): ts.Expression {
  const f = g.ctx.factory;
  const extra = declaredNullish(g, typeNode).map((v) => strictEq(f, x, v));
  const p = pred(g, type, x, "$");
  return extra.length > 0 ? or(f, [...extra, p]) : p;
}

/** Top-level checks, honouring nullish alternatives lost without strictNullChecks. */
function topChecks(g: Gen, typeNode: ts.TypeNode, type: ts.Type, x: ts.Expression): ts.Statement[] {
  const f = g.ctx.factory;
  const c = checks(g, type, x, f.createStringLiteral("$"), "$");
  const skip = declaredNullish(g, typeNode).map((v) => strictEq(f, x, v));
  return skip.length > 0 && c.length > 0
    ? [f.createIfStatement(not(f, or(f, skip)), f.createBlock(c, true))]
    : c;
}

function getTargetType(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  name: string
): { typeNode: ts.TypeNode; type: ts.Type } | undefined {
  const typeArgs = callExpr.typeArguments;
  if (!typeArgs || typeArgs.length !== 1) {
    ctx.reportError(callExpr, `${name} requires exactly one type argument`);
    return undefined;
  }
  return { typeNode: typeArgs[0], type: ctx.typeChecker.getTypeFromTypeNode(typeArgs[0]) };
}

// ============================================================================
// validate<T>()
// ============================================================================

export const validateMacro = defineExpressionMacro({
  name: "validate",
  description: "Generate a runtime validator returning ValidatedNel",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const f = ctx.factory;
    const target = getTargetType(ctx, callExpr, "validate");
    if (!target) return callExpr;
    const g = newGen(ctx, callExpr, "validate");
    const value = f.createIdentifier("value");
    const body = topChecks(g, target.typeNode, target.type, value);

    // Invalid carries a NonEmptyList (`{ head, tail }`, Nil = null), exactly
    // the @typesugar/fp ValidatedNel runtime shape:
    //   errors.reduceRight((tail, head) => ({ head, tail }), null)
    const tail = f.createUniqueName("tail");
    const head = f.createUniqueName("head");
    const nel = f.createCallExpression(
      f.createPropertyAccessExpression(f.createIdentifier("errors"), "reduceRight"),
      [f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)],
      [
        f.createArrowFunction(
          undefined,
          undefined,
          [
            f.createParameterDeclaration(undefined, undefined, tail),
            f.createParameterDeclaration(undefined, undefined, head),
          ],
          undefined,
          f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          f.createParenthesizedExpression(
            f.createObjectLiteralExpression([
              f.createPropertyAssignment("head", head),
              f.createPropertyAssignment("tail", tail),
            ])
          )
        ),
        f.createNull(),
      ]
    );

    const arrow = f.createArrowFunction(
      undefined,
      undefined,
      [valueParam(f)],
      undefined,
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      f.createBlock(
        [
          errorsDecl(f),
          ...body,
          f.createReturnStatement(
            f.createConditionalExpression(
              f.createBinaryExpression(
                lengthOf(f, f.createIdentifier("errors")),
                ts.SyntaxKind.EqualsEqualsEqualsToken,
                f.createNumericLiteral(0)
              ),
              f.createToken(ts.SyntaxKind.QuestionToken),
              f.createObjectLiteralExpression([
                f.createPropertyAssignment("value", f.createAsExpression(value, target.typeNode)),
              ]),
              f.createToken(ts.SyntaxKind.ColonToken),
              f.createObjectLiteralExpression([f.createPropertyAssignment("error", nel)])
            )
          ),
        ],
        true
      )
    );
    return withHelpers(g, arrow);
  },
});

// ============================================================================
// is<T>()
// ============================================================================

export const isMacro = defineExpressionMacro({
  name: "is",
  description: "Generate a boolean type guard function",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const f = ctx.factory;
    const target = getTargetType(ctx, callExpr, "is");
    if (!target) return callExpr;
    const g = newGen(ctx, callExpr, "is");
    const value = f.createIdentifier("value");
    const test = topPred(g, target.typeNode, target.type, value);

    const arrow = f.createArrowFunction(
      undefined,
      undefined,
      [valueParam(f)],
      f.createTypePredicateNode(undefined, f.createIdentifier("value"), target.typeNode),
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      f.createBlock([f.createReturnStatement(test)], true)
    );
    return withHelpers(g, arrow);
  },
});

// ============================================================================
// assert<T>()
// ============================================================================

export const assertMacro = defineExpressionMacro({
  name: "assert",
  description: "Generate an assertion function",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const f = ctx.factory;
    const target = getTargetType(ctx, callExpr, "assert");
    if (!target) return callExpr;
    const g = newGen(ctx, callExpr, "assert");
    const value = f.createIdentifier("value");
    const body = topChecks(g, target.typeNode, target.type, value);

    const arrow = f.createArrowFunction(
      undefined,
      undefined,
      [valueParam(f)],
      undefined,
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      f.createBlock(
        [
          errorsDecl(f),
          ...body,
          f.createIfStatement(
            f.createBinaryExpression(
              lengthOf(f, f.createIdentifier("errors")),
              ts.SyntaxKind.GreaterThanToken,
              f.createNumericLiteral(0)
            ),
            f.createBlock([
              f.createThrowStatement(
                f.createNewExpression(f.createIdentifier("Error"), undefined, [
                  f.createBinaryExpression(
                    f.createStringLiteral("Validation failed: "),
                    ts.SyntaxKind.PlusToken,
                    f.createCallExpression(
                      f.createPropertyAccessExpression(
                        f.createCallExpression(
                          f.createPropertyAccessExpression(f.createIdentifier("JSON"), "stringify"),
                          undefined,
                          [f.createIdentifier("errors")]
                        ),
                        "substring"
                      ),
                      undefined,
                      [f.createNumericLiteral(0), f.createNumericLiteral(100)]
                    )
                  ),
                ])
              ),
            ])
          ),
          f.createReturnStatement(f.createAsExpression(value, target.typeNode)),
        ],
        true
      )
    );
    return withHelpers(g, arrow);
  },
});

export function register(): void {
  globalRegistry.register(validateMacro);
  globalRegistry.register(isMacro);
  globalRegistry.register(assertMacro);
}

// Auto-register on import (the transformer loads this entry for its side effects).
register();
