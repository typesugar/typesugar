/**
 * specializeSchema Expression Macro — Zero-cost Schema Validation
 *
 * Transforms Effect Schema decoding into direct field checks at compile time,
 * eliminating the runtime combinator walk overhead.
 *
 * ## Usage
 *
 * ```typescript
 * import { specializeSchema, specializeSchemaUnsafe } from "@typesugar/effect";
 *
 * // Define a schema
 * const UserSchema = Schema.Struct({
 *   name: Schema.String,
 *   age: Schema.Number,
 *   email: Schema.optional(Schema.String),
 * });
 *
 * // Before: runtime combinator walk
 * const decode = Schema.decodeSync(UserSchema);
 * const user = decode(input);
 *
 * // After: compile-time specialized validator
 * const decodeUser = specializeSchema(UserSchema);
 * const user = decodeUser(input);
 * // Compiles to direct field checks, no combinator overhead
 * ```
 *
 * ## Unsafe Variant
 *
 * `specializeSchemaUnsafe` throws on validation failure instead of returning
 * an Effect. Use when you're confident the input is valid.
 *
 * ```typescript
 * const user = specializeSchemaUnsafe(UserSchema, input);
 * ```
 *
 * ## Supported Schema Types
 *
 * **Experimental.** Specialized checks are generated only for schemas whose
 * decoded value equals their input (no transformations):
 *
 * - Primitives: `String`, `Number`, `Boolean`, `BigIntFromSelf`,
 *   `SymbolFromSelf`, `Undefined`, `Null`, `Unknown`
 * - `Struct({...})` with identifier or quoted keys, and `optional(S)` fields
 * - `Array(S)`, `Tuple(A, B, ...)`, `NullOr(S)`, `Literal(a, b, ...)`
 *
 * Anything else — including `Schema.BigInt`/`Schema.Symbol`/`Schema.Date`
 * (transformations from string), `Union`, refinements, schema variables — is
 * decoded with `Schema.decodeUnknownSync(<that sub-schema>)`, built once when
 * the decoder is created. A struct or tuple containing a part that can't be
 * specialized falls back as a whole. Failures throw an `Error` (not a
 * `ParseError`) naming the path.
 *
 * @module
 */

import * as ts from "typescript";
import { type MacroContext, defineExpressionMacro } from "@typesugar/core";

/**
 * Parsed schema structure for code generation. Every node keeps the source
 * expression it came from, so a fallback decodes with THAT sub-schema.
 */
type ParsedSchema =
  | { kind: "typeof"; expr: ts.Expression; typeofName: string }
  | { kind: "undefined" | "null" | "unknown"; expr: ts.Expression }
  | { kind: "literal"; expr: ts.Expression; values: ts.Expression[] }
  | { kind: "struct"; expr: ts.Expression; fields: StructField[] }
  | { kind: "array"; expr: ts.Expression; element: ParsedSchema }
  | { kind: "tuple"; expr: ts.Expression; elements: ParsedSchema[] }
  | { kind: "nullable"; expr: ts.Expression; element: ParsedSchema }
  | { kind: "fallback"; expr: ts.Expression };

interface StructField {
  key: string;
  schema: ParsedSchema;
  optional: boolean;
}

const TYPEOF_PRIMITIVES: Record<string, string> = {
  String: "string",
  Number: "number",
  Boolean: "boolean",
  BigIntFromSelf: "bigint",
  SymbolFromSelf: "symbol",
};

function schemaMember(expr: ts.Expression): string | undefined {
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "Schema"
  ) {
    return expr.name.text;
  }
  return undefined;
}

function isLiteralValueExpr(e: ts.Expression): boolean {
  return (
    ts.isStringLiteral(e) ||
    ts.isNoSubstitutionTemplateLiteral(e) ||
    ts.isNumericLiteral(e) ||
    ts.isBigIntLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword ||
    e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isPrefixUnaryExpression(e) &&
      e.operator === ts.SyntaxKind.MinusToken &&
      (ts.isNumericLiteral(e.operand) || ts.isBigIntLiteral(e.operand)))
  );
}

/** Display text of a literal accepted by isLiteralValueExpr (no source text needed). */
function literalText(e: ts.Expression): string {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return JSON.stringify(e.text);
  if (ts.isNumericLiteral(e)) return e.text;
  if (ts.isBigIntLiteral(e)) return e.text;
  if (ts.isPrefixUnaryExpression(e)) return "-" + literalText(e.operand);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (e.kind === ts.SyntaxKind.FalseKeyword) return "false";
  return "null";
}

function propertyKeyText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/**
 * Analyse a schema expression. Returns `fallback` for anything not
 * specializable (or containing a part that isn't).
 */
function parseSchema(expr: ts.Expression): ParsedSchema {
  const fallback: ParsedSchema = { kind: "fallback", expr };
  const member = schemaMember(expr);
  if (member !== undefined) {
    if (member in TYPEOF_PRIMITIVES) {
      return { kind: "typeof", expr, typeofName: TYPEOF_PRIMITIVES[member] };
    }
    if (member === "Undefined") return { kind: "undefined", expr };
    if (member === "Null") return { kind: "null", expr };
    if (member === "Unknown") return { kind: "unknown", expr };
    return fallback;
  }

  if (!ts.isCallExpression(expr)) return fallback;
  const method = schemaMember(expr.expression);
  if (method === undefined) return fallback;
  const args = expr.arguments;
  if (args.some((a) => ts.isSpreadElement(a))) return fallback;

  switch (method) {
    case "Struct": {
      const arg = args[0];
      if (args.length !== 1 || !ts.isObjectLiteralExpression(arg)) return fallback;
      const fields: StructField[] = [];
      for (const prop of arg.properties) {
        if (!ts.isPropertyAssignment(prop)) return fallback;
        const key = propertyKeyText(prop.name);
        if (key === undefined) return fallback;
        let fieldExpr = prop.initializer;
        let optional = false;
        if (
          ts.isCallExpression(fieldExpr) &&
          schemaMember(fieldExpr.expression) === "optional" &&
          fieldExpr.arguments.length === 1
        ) {
          optional = true;
          fieldExpr = fieldExpr.arguments[0];
        }
        const schema = parseSchema(fieldExpr);
        // A struct with an unspecializable field is decoded as a whole: the
        // field expression may not be a standalone schema (optionalWith,
        // propertySignature, fromKey, ...).
        if (schema.kind === "fallback") return fallback;
        fields.push({ key, schema, optional });
      }
      if (fields.length === 0) return fallback;
      return { kind: "struct", expr, fields };
    }
    case "Array": {
      if (args.length !== 1) return fallback;
      return { kind: "array", expr, element: parseSchema(args[0]) };
    }
    case "Tuple": {
      if (args.length === 0) return fallback;
      const elements = args.map(parseSchema);
      if (elements.some((e) => e.kind === "fallback")) return fallback;
      return { kind: "tuple", expr, elements };
    }
    case "NullOr": {
      if (args.length !== 1) return fallback;
      return { kind: "nullable", expr, element: parseSchema(args[0]) };
    }
    case "Literal": {
      if (args.length === 0 || !args.every(isLiteralValueExpr)) return fallback;
      return { kind: "literal", expr, values: [...args] };
    }
    default:
      return fallback;
  }
}

/** Codegen state: fallback decoders hoisted out of the per-call path. */
interface Gen {
  ctx: MacroContext;
  decoders: Array<{ id: ts.Identifier; schema: ts.Expression }>;
}

function strictEq(f: ts.NodeFactory, a: ts.Expression, b: ts.Expression): ts.Expression {
  return f.createBinaryExpression(a, ts.SyntaxKind.EqualsEqualsEqualsToken, b);
}

function and(f: ts.NodeFactory, a: ts.Expression, b: ts.Expression): ts.Expression {
  return f.createBinaryExpression(a, ts.SyntaxKind.AmpersandAmpersandToken, b);
}

function or(f: ts.NodeFactory, a: ts.Expression, b: ts.Expression): ts.Expression {
  return f.createBinaryExpression(a, ts.SyntaxKind.BarBarToken, b);
}

function cond(
  f: ts.NodeFactory,
  test: ts.Expression,
  whenTrue: ts.Expression,
  whenFalse: ts.Expression
): ts.Expression {
  return f.createConditionalExpression(
    test,
    f.createToken(ts.SyntaxKind.QuestionToken),
    whenTrue,
    f.createToken(ts.SyntaxKind.ColonToken),
    whenFalse
  );
}

function anyCast(f: ts.NodeFactory, e: ts.Expression): ts.Expression {
  return f.createParenthesizedExpression(
    f.createAsExpression(e, f.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))
  );
}

/**
 * Generate an expression that validates `input` against `schema` and
 * evaluates to the decoded value, or throws.
 */
function generateValidation(
  g: Gen,
  schema: ParsedSchema,
  input: ts.Expression,
  path: string
): ts.Expression {
  const f = g.ctx.factory;
  switch (schema.kind) {
    case "typeof":
      return cond(
        f,
        strictEq(f, f.createTypeOfExpression(input), f.createStringLiteral(schema.typeofName)),
        input,
        throwParseError(f, path, `Expected ${schema.typeofName}`, input)
      );
    case "undefined":
      return cond(
        f,
        strictEq(f, input, f.createVoidZero()),
        input,
        throwParseError(f, path, "Expected undefined", input)
      );
    case "null":
      return cond(
        f,
        strictEq(f, input, f.createNull()),
        input,
        throwParseError(f, path, "Expected null", input)
      );
    case "unknown":
      return input;
    case "literal": {
      const test = schema.values
        .map((v) => strictEq(f, input, v))
        .reduce((acc, t) => or(f, acc, t));
      const shown = schema.values.map(literalText).join(" | ");
      return cond(f, test, input, throwParseError(f, path, `Expected ${shown}`, input));
    }
    case "nullable":
      return cond(
        f,
        strictEq(f, input, f.createNull()),
        f.createNull(),
        generateValidation(g, schema.element, input, path)
      );
    case "array": {
      const item = g.ctx.generateUniqueName("item");
      return cond(
        f,
        f.createCallExpression(
          f.createPropertyAccessExpression(f.createIdentifier("Array"), "isArray"),
          undefined,
          [input]
        ),
        f.createCallExpression(
          f.createPropertyAccessExpression(anyCast(f, input), "map"),
          undefined,
          [
            f.createArrowFunction(
              undefined,
              undefined,
              [f.createParameterDeclaration(undefined, undefined, item)],
              undefined,
              f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
              generateValidation(g, schema.element, item, `${path}[]`)
            ),
          ]
        ),
        throwParseError(f, path, "Expected array", input)
      );
    }
    case "tuple": {
      const n = schema.elements.length;
      const elems = schema.elements.map((el, i) =>
        generateValidation(
          g,
          el,
          f.createElementAccessExpression(anyCast(f, input), f.createNumericLiteral(i)),
          `${path}[${i}]`
        )
      );
      return cond(
        f,
        and(
          f,
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier("Array"), "isArray"),
            undefined,
            [input]
          ),
          strictEq(
            f,
            f.createPropertyAccessExpression(anyCast(f, input), "length"),
            f.createNumericLiteral(n)
          )
        ),
        f.createArrayLiteralExpression(elems),
        throwParseError(f, path, `Expected tuple of length ${n}`, input)
      );
    }
    case "struct": {
      const isObject = and(
        f,
        and(
          f,
          strictEq(f, f.createTypeOfExpression(input), f.createStringLiteral("object")),
          f.createBinaryExpression(
            input,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            f.createNull()
          )
        ),
        f.createPrefixUnaryExpression(
          ts.SyntaxKind.ExclamationToken,
          f.createCallExpression(
            f.createPropertyAccessExpression(f.createIdentifier("Array"), "isArray"),
            undefined,
            [input]
          )
        )
      );
      const props: ts.ObjectLiteralElementLike[] = [];
      for (const field of schema.fields) {
        const keyLit = f.createStringLiteral(field.key);
        const access = f.createElementAccessExpression(anyCast(f, input), keyLit);
        const fieldPath = `${path}[${JSON.stringify(field.key)}]`;
        const validated = generateValidation(g, field.schema, access, fieldPath);
        if (!field.optional) {
          props.push(f.createPropertyAssignment(f.createStringLiteral(field.key), validated));
          continue;
        }
        // optional(S): key absent → omitted; present → `undefined | S`.
        const hasOwn = f.createCallExpression(
          f.createPropertyAccessExpression(
            f.createPropertyAccessExpression(
              f.createPropertyAccessExpression(f.createIdentifier("Object"), "prototype"),
              "hasOwnProperty"
            ),
            "call"
          ),
          undefined,
          [input, f.createStringLiteral(field.key)]
        );
        const value = cond(
          f,
          strictEq(f, access, f.createVoidZero()),
          f.createVoidZero(),
          validated
        );
        props.push(
          f.createSpreadAssignment(
            f.createParenthesizedExpression(
              cond(
                f,
                hasOwn,
                f.createObjectLiteralExpression([
                  f.createPropertyAssignment(f.createStringLiteral(field.key), value),
                ]),
                f.createObjectLiteralExpression([])
              )
            )
          )
        );
      }
      return cond(
        f,
        isObject,
        f.createObjectLiteralExpression(props, true),
        throwParseError(f, path, "Expected object", input)
      );
    }
    case "fallback": {
      const id = g.ctx.generateUniqueName("decode");
      g.decoders.push({ id, schema: schema.expr });
      return f.createCallExpression(id, undefined, [input]);
    }
  }
}

/**
 * `(() => { throw new Error(`Parse error at <path>: <message>, got ${typeof value}`) })()`
 */
function throwParseError(
  factory: ts.NodeFactory,
  path: string,
  message: string,
  valueExpr: ts.Expression
): ts.Expression {
  return factory.createCallExpression(
    factory.createParenthesizedExpression(
      factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createBlock(
          [
            factory.createThrowStatement(
              factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
                factory.createTemplateExpression(
                  factory.createTemplateHead(`Parse error at ${path}: ${message}, got `),
                  [
                    factory.createTemplateSpan(
                      factory.createTypeOfExpression(valueExpr),
                      factory.createTemplateTail("")
                    ),
                  ]
                ),
              ])
            ),
          ],
          false
        )
      )
    ),
    undefined,
    []
  );
}

/** `Schema.decodeUnknownSync(schema)` */
function decodeUnknownSync(ctx: MacroContext, schema: ts.Expression): ts.Expression {
  return ctx.factory.createCallExpression(
    ctx.factory.createPropertyAccessExpression(
      ctx.ensureImport("Schema", "effect"),
      "decodeUnknownSync"
    ),
    undefined,
    [schema]
  );
}

/** `const <id> = Schema.decodeUnknownSync(<schema>);` for every hoisted fallback. */
function decoderStatements(g: Gen): ts.Statement[] {
  const f = g.ctx.factory;
  return g.decoders.map((d) =>
    f.createVariableStatement(
      undefined,
      f.createVariableDeclarationList(
        [
          f.createVariableDeclaration(
            d.id,
            undefined,
            undefined,
            decodeUnknownSync(g.ctx, d.schema)
          ),
        ],
        ts.NodeFlags.Const
      )
    )
  );
}

function inputParam(ctx: MacroContext, name: ts.Identifier): ts.ParameterDeclaration {
  return ctx.factory.createParameterDeclaration(
    undefined,
    undefined,
    name,
    undefined,
    ctx.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
  );
}

// ============================================================================
// specializeSchema() Expression Macro
// ============================================================================

/**
 * specializeSchema(schema) — Generate optimized decoder from Effect Schema.
 *
 * Returns a function that validates input and returns the typed value.
 */
export const specializeSchemaExpression = defineExpressionMacro({
  name: "specializeSchema",
  module: "@typesugar/effect",
  description: "Generate specialized decoder from Effect Schema at compile time",

  expand(ctx, call, args) {
    if (args.length !== 1) {
      ctx.reportError(
        call,
        "specializeSchema() expects exactly one argument: specializeSchema(schema)"
      );
      return call;
    }

    const schemaArg = args[0];
    const factory = ctx.factory;
    const parsed = parseSchema(schemaArg);

    if (parsed.kind === "fallback") {
      ctx.reportWarning(
        schemaArg,
        "specializeSchema: Schema structure not recognized, falling back to runtime decoding"
      );
      return decodeUnknownSync(ctx, schemaArg);
    }

    const g: Gen = { ctx, decoders: [] };
    const input = ctx.generateUniqueName("input");
    const validation = generateValidation(g, parsed, input, "input");
    const decoder = factory.createArrowFunction(
      undefined,
      undefined,
      [inputParam(ctx, input)],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      validation
    );
    if (g.decoders.length === 0) return decoder;

    // (() => { const d0 = Schema.decodeUnknownSync(sub0); ...; return (input) => ...; })()
    return factory.createCallExpression(
      factory.createParenthesizedExpression(
        factory.createArrowFunction(
          undefined,
          undefined,
          [],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createBlock(
            [...decoderStatements(g), factory.createReturnStatement(decoder)],
            true
          )
        )
      ),
      undefined,
      []
    );
  },
});

// ============================================================================
// specializeSchemaUnsafe() Expression Macro
// ============================================================================

/**
 * specializeSchemaUnsafe(schema, input) — Decode and return value, throw on failure.
 * The input expression is evaluated exactly once.
 */
export const specializeSchemaUnsafeExpression = defineExpressionMacro({
  name: "specializeSchemaUnsafe",
  module: "@typesugar/effect",
  description: "Decode input with specialized Schema, throw on failure",

  expand(ctx, call, args) {
    if (args.length !== 2) {
      ctx.reportError(
        call,
        "specializeSchemaUnsafe() expects two arguments: specializeSchemaUnsafe(schema, input)"
      );
      return call;
    }

    const [schemaArg, inputArg] = args;
    const factory = ctx.factory;
    const parsed = parseSchema(schemaArg);

    if (parsed.kind === "fallback") {
      ctx.reportWarning(
        schemaArg,
        "specializeSchemaUnsafe: Schema structure not recognized, falling back to runtime decoding"
      );
      return factory.createCallExpression(decodeUnknownSync(ctx, schemaArg), undefined, [inputArg]);
    }

    // ((input: unknown) => { const d0 = ...; return <validation>; })(inputArg)
    const g: Gen = { ctx, decoders: [] };
    const input = ctx.generateUniqueName("input");
    const validation = generateValidation(g, parsed, input, "input");
    return factory.createCallExpression(
      factory.createParenthesizedExpression(
        factory.createArrowFunction(
          undefined,
          undefined,
          [inputParam(ctx, input)],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          factory.createBlock(
            [...decoderStatements(g), factory.createReturnStatement(validation)],
            true
          )
        )
      ),
      undefined,
      [inputArg]
    );
  },
});

// ============================================================================
// Runtime Placeholders
// ============================================================================

/**
 * Runtime placeholder for specializeSchema macro.
 * Throws at runtime — this call should be compiled away by the transformer.
 */
export function specializeSchema<A, I, R>(
  _schema: import("effect").Schema.Schema<A, I, R>
): (input: unknown) => A {
  throw new Error(
    "specializeSchema() is a compile-time macro and requires the typesugar transformer. " +
      "See: https://github.com/dpovey/typesugar#setup"
  );
}

/**
 * Runtime placeholder for specializeSchemaUnsafe macro.
 * Throws at runtime — this call should be compiled away by the transformer.
 */
export function specializeSchemaUnsafe<A, I, R>(
  _schema: import("effect").Schema.Schema<A, I, R>,
  _input: unknown
): A {
  throw new Error(
    "specializeSchemaUnsafe() is a compile-time macro and requires the typesugar transformer. " +
      "See: https://github.com/dpovey/typesugar#setup"
  );
}
