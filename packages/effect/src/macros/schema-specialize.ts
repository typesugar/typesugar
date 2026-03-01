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
 * - Primitives: String, Number, Boolean, BigInt, Symbol, Undefined, Null
 * - Struct: Named fields with typed values
 * - Array: Homogeneous arrays
 * - Tuple: Fixed-length typed arrays
 * - Union: Discriminated unions (requires _tag or discriminant)
 * - Literal: Exact value matches
 * - Optional: Optional fields
 * - Nullable: Nullable values
 *
 * @module
 */

import * as ts from "typescript";
import {
  type MacroContext,
  defineExpressionMacro,
} from "@typesugar/core";

/**
 * Schema kind for compile-time analysis.
 */
type SchemaKind =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "undefined"
  | "null"
  | "unknown"
  | "struct"
  | "array"
  | "tuple"
  | "union"
  | "literal"
  | "optional"
  | "nullable"
  | "unsupported";

/**
 * Parsed schema structure for code generation.
 */
interface ParsedSchema {
  kind: SchemaKind;
  fields?: Record<string, ParsedSchema>;
  element?: ParsedSchema;
  elements?: ParsedSchema[];
  variants?: ParsedSchema[];
  literalValue?: string | number | boolean;
  discriminant?: string;
  optional?: boolean;
}

/**
 * Try to infer the schema kind from a Schema call.
 */
function inferSchemaKind(ctx: MacroContext, expr: ts.Expression): ParsedSchema {
  // Handle Schema.String, Schema.Number, etc.
  if (ts.isPropertyAccessExpression(expr)) {
    const obj = expr.expression;
    const prop = expr.name.text;

    if (ts.isIdentifier(obj) && obj.text === "Schema") {
      switch (prop) {
        case "String":
          return { kind: "string" };
        case "Number":
          return { kind: "number" };
        case "Boolean":
          return { kind: "boolean" };
        case "BigInt":
        case "BigIntFromSelf":
          return { kind: "bigint" };
        case "Symbol":
        case "SymbolFromSelf":
          return { kind: "symbol" };
        case "Undefined":
          return { kind: "undefined" };
        case "Null":
          return { kind: "null" };
        case "Unknown":
          return { kind: "unknown" };
      }
    }
  }

  // Handle Schema.Struct({ ... })
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      const obj = callee.expression;
      const method = callee.name.text;

      if (ts.isIdentifier(obj) && obj.text === "Schema") {
        switch (method) {
          case "Struct": {
            const arg = expr.arguments[0];
            if (arg && ts.isObjectLiteralExpression(arg)) {
              const fields: Record<string, ParsedSchema> = {};
              for (const prop of arg.properties) {
                if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                  fields[prop.name.text] = inferSchemaKind(ctx, prop.initializer);
                }
              }
              return { kind: "struct", fields };
            }
            break;
          }

          case "Array": {
            const elementArg = expr.arguments[0];
            if (elementArg) {
              return { kind: "array", element: inferSchemaKind(ctx, elementArg) };
            }
            return { kind: "array", element: { kind: "unknown" } };
          }

          case "Tuple": {
            const elements: ParsedSchema[] = [];
            for (const arg of expr.arguments) {
              elements.push(inferSchemaKind(ctx, arg));
            }
            return { kind: "tuple", elements };
          }

          case "Union": {
            const variants: ParsedSchema[] = [];
            for (const arg of expr.arguments) {
              variants.push(inferSchemaKind(ctx, arg));
            }
            return { kind: "union", variants };
          }

          case "Literal": {
            const literalArg = expr.arguments[0];
            if (literalArg) {
              if (ts.isStringLiteral(literalArg)) {
                return { kind: "literal", literalValue: literalArg.text };
              }
              if (ts.isNumericLiteral(literalArg)) {
                return { kind: "literal", literalValue: Number(literalArg.text) };
              }
              if (literalArg.kind === ts.SyntaxKind.TrueKeyword) {
                return { kind: "literal", literalValue: true };
              }
              if (literalArg.kind === ts.SyntaxKind.FalseKeyword) {
                return { kind: "literal", literalValue: false };
              }
            }
            break;
          }

          case "optional":
          case "Optional": {
            const innerArg = expr.arguments[0];
            if (innerArg) {
              const inner = inferSchemaKind(ctx, innerArg);
              return { ...inner, optional: true };
            }
            break;
          }

          case "nullable":
          case "Nullable":
          case "NullOr": {
            const innerArg = expr.arguments[0];
            if (innerArg) {
              return { kind: "nullable", element: inferSchemaKind(ctx, innerArg) };
            }
            break;
          }
        }
      }
    }
  }

  return { kind: "unsupported" };
}

/**
 * Generate a type check expression for a primitive.
 */
function generatePrimitiveCheck(
  factory: ts.NodeFactory,
  value: ts.Expression,
  expectedType: string
): ts.Expression {
  return factory.createBinaryExpression(
    factory.createTypeOfExpression(value),
    factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
    factory.createStringLiteral(expectedType)
  );
}

/**
 * Generate validation code for a parsed schema.
 * Returns an expression that validates `input` and returns the typed value or throws.
 *
 * @param schemaExpr - The original schema AST expression, used for fallback to runtime decoding.
 */
function generateValidationCode(
  ctx: MacroContext,
  schema: ParsedSchema,
  input: ts.Expression,
  path: string,
  schemaExpr: ts.Expression,
): ts.Expression {
  const factory = ctx.factory;

  switch (schema.kind) {
    case "string":
      return generatePrimitiveValidation(factory, input, "string", path);

    case "number":
      return generatePrimitiveValidation(factory, input, "number", path);

    case "boolean":
      return generatePrimitiveValidation(factory, input, "boolean", path);

    case "bigint":
      return generatePrimitiveValidation(factory, input, "bigint", path);

    case "symbol":
      return generatePrimitiveValidation(factory, input, "symbol", path);

    case "undefined":
      return generateUndefinedValidation(factory, input, path);

    case "null":
      return generateNullValidation(factory, input, path);

    case "unknown":
      return input;

    case "struct":
      return generateStructValidation(ctx, schema, input, path, schemaExpr);

    case "array":
      return generateArrayValidation(ctx, schema, input, path, schemaExpr);

    case "tuple":
      return generateTupleValidation(ctx, schema, input, path, schemaExpr);

    case "nullable":
      return generateNullableValidation(ctx, schema, input, path, schemaExpr);

    case "literal":
      return generateLiteralValidation(factory, schema, input, path);

    case "union":
      return generateUnionValidation(ctx, schema, input, path, schemaExpr);

    default:
      return generateRuntimeFallback(factory, schemaExpr, input);
  }
}

/**
 * Generate primitive type validation.
 */
function generatePrimitiveValidation(
  factory: ts.NodeFactory,
  input: ts.Expression,
  expectedType: string,
  path: string
): ts.Expression {
  return factory.createConditionalExpression(
    generatePrimitiveCheck(factory, input, expectedType),
    factory.createToken(ts.SyntaxKind.QuestionToken),
    input,
    factory.createToken(ts.SyntaxKind.ColonToken),
    generateThrowParseError(factory, path, `Expected ${expectedType}`, input)
  );
}

/**
 * Generate undefined validation.
 */
function generateUndefinedValidation(
  factory: ts.NodeFactory,
  input: ts.Expression,
  path: string
): ts.Expression {
  return factory.createConditionalExpression(
    factory.createBinaryExpression(
      input,
      factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
      factory.createIdentifier("undefined")
    ),
    factory.createToken(ts.SyntaxKind.QuestionToken),
    factory.createIdentifier("undefined"),
    factory.createToken(ts.SyntaxKind.ColonToken),
    generateThrowParseError(factory, path, "Expected undefined", input)
  );
}

/**
 * Generate null validation.
 */
function generateNullValidation(
  factory: ts.NodeFactory,
  input: ts.Expression,
  path: string
): ts.Expression {
  return factory.createConditionalExpression(
    factory.createBinaryExpression(
      input,
      factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
      factory.createNull()
    ),
    factory.createToken(ts.SyntaxKind.QuestionToken),
    factory.createNull(),
    factory.createToken(ts.SyntaxKind.ColonToken),
    generateThrowParseError(factory, path, "Expected null", input)
  );
}

/**
 * Generate nullable validation.
 */
function generateNullableValidation(
  ctx: MacroContext,
  schema: ParsedSchema,
  input: ts.Expression,
  path: string,
  schemaExpr: ts.Expression,
): ts.Expression {
  const factory = ctx.factory;
  const innerValidation = generateValidationCode(ctx, schema.element!, input, path, schemaExpr);

  // input === null ? null : innerValidation
  return factory.createConditionalExpression(
    factory.createBinaryExpression(
      input,
      factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
      factory.createNull()
    ),
    factory.createToken(ts.SyntaxKind.QuestionToken),
    factory.createNull(),
    factory.createToken(ts.SyntaxKind.ColonToken),
    innerValidation
  );
}

/**
 * Generate literal validation.
 */
function generateLiteralValidation(
  factory: ts.NodeFactory,
  schema: ParsedSchema,
  input: ts.Expression,
  path: string
): ts.Expression {
  const literalValue = schema.literalValue;
  let literalExpr: ts.Expression;

  if (typeof literalValue === "string") {
    literalExpr = factory.createStringLiteral(literalValue);
  } else if (typeof literalValue === "number") {
    literalExpr = factory.createNumericLiteral(literalValue);
  } else if (typeof literalValue === "boolean") {
    literalExpr = literalValue ? factory.createTrue() : factory.createFalse();
  } else {
    return generateThrowParseError(factory, path, "Unknown literal type", input);
  }

  return factory.createConditionalExpression(
    factory.createBinaryExpression(
      input,
      factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
      literalExpr
    ),
    factory.createToken(ts.SyntaxKind.QuestionToken),
    input,
    factory.createToken(ts.SyntaxKind.ColonToken),
    generateThrowParseError(factory, path, `Expected literal ${JSON.stringify(literalValue)}`, input)
  );
}

/**
 * Generate struct validation.
 */
function generateStructValidation(
  ctx: MacroContext,
  schema: ParsedSchema,
  input: ts.Expression,
  path: string,
  schemaExpr: ts.Expression,
): ts.Expression {
  const factory = ctx.factory;
  const fields = schema.fields!;

  const fieldAssignments: ts.ObjectLiteralElementLike[] = [];

  // First, check that input is an object
  const isObjectCheck = factory.createBinaryExpression(
    factory.createBinaryExpression(
      factory.createTypeOfExpression(input),
      factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
      factory.createStringLiteral("object")
    ),
    factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
    factory.createBinaryExpression(
      input,
      factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
      factory.createNull()
    )
  );

  for (const [fieldName, fieldSchema] of Object.entries(fields)) {
    const fieldPath = `${path}.${fieldName}`;
    const fieldAccess = factory.createPropertyAccessExpression(
      factory.createParenthesizedExpression(
        factory.createAsExpression(input, factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))
      ),
      factory.createIdentifier(fieldName)
    );

    if (fieldSchema.optional) {
      const fieldValidation = generateValidationCode(ctx, fieldSchema, fieldAccess, fieldPath, schemaExpr);
      fieldAssignments.push(
        factory.createPropertyAssignment(
          factory.createIdentifier(fieldName),
          factory.createConditionalExpression(
            factory.createBinaryExpression(
              factory.createStringLiteral(fieldName),
              factory.createToken(ts.SyntaxKind.InKeyword),
              factory.createAsExpression(input, factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword))
            ),
            factory.createToken(ts.SyntaxKind.QuestionToken),
            fieldValidation,
            factory.createToken(ts.SyntaxKind.ColonToken),
            factory.createIdentifier("undefined")
          )
        )
      );
    } else {
      const fieldValidation = generateValidationCode(ctx, fieldSchema, fieldAccess, fieldPath, schemaExpr);
      fieldAssignments.push(
        factory.createPropertyAssignment(factory.createIdentifier(fieldName), fieldValidation)
      );
    }
  }

  // Generate: isObject ? { field1: validate1, field2: validate2, ... } : throw
  return factory.createConditionalExpression(
    isObjectCheck,
    factory.createToken(ts.SyntaxKind.QuestionToken),
    factory.createObjectLiteralExpression(fieldAssignments, true),
    factory.createToken(ts.SyntaxKind.ColonToken),
    generateThrowParseError(factory, path, "Expected object", input)
  );
}

/**
 * Generate array validation.
 */
function generateArrayValidation(
  ctx: MacroContext,
  schema: ParsedSchema,
  input: ts.Expression,
  path: string,
  schemaExpr: ts.Expression,
): ts.Expression {
  const factory = ctx.factory;
  const element = schema.element!;

  const mapParam = factory.createIdentifier("__item");
  const indexParam = factory.createIdentifier("__i");

  const elementValidation = generateValidationCode(
    ctx,
    element,
    mapParam,
    `${path}[i]`,
    schemaExpr,
  );

  return factory.createConditionalExpression(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Array"),
        factory.createIdentifier("isArray")
      ),
      undefined,
      [input]
    ),
    factory.createToken(ts.SyntaxKind.QuestionToken),
    factory.createCallExpression(
      factory.createPropertyAccessExpression(input, factory.createIdentifier("map")),
      undefined,
      [
        factory.createArrowFunction(
          undefined,
          undefined,
          [
            factory.createParameterDeclaration(undefined, undefined, mapParam),
            factory.createParameterDeclaration(undefined, undefined, indexParam),
          ],
          undefined,
          factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
          elementValidation
        ),
      ]
    ),
    factory.createToken(ts.SyntaxKind.ColonToken),
    generateThrowParseError(factory, path, "Expected array", input)
  );
}

/**
 * Generate tuple validation.
 */
function generateTupleValidation(
  ctx: MacroContext,
  schema: ParsedSchema,
  input: ts.Expression,
  path: string,
  schemaExpr: ts.Expression,
): ts.Expression {
  const factory = ctx.factory;
  const elements = schema.elements!;

  // Check array and length
  const lengthCheck = factory.createBinaryExpression(
    factory.createPropertyAccessExpression(input, factory.createIdentifier("length")),
    factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
    factory.createNumericLiteral(elements.length)
  );

  const isArrayCheck = factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier("Array"),
      factory.createIdentifier("isArray")
    ),
    undefined,
    [input]
  );

  // Build tuple validations
  const elementExprs: ts.Expression[] = [];
  for (let i = 0; i < elements.length; i++) {
    const elementAccess = factory.createElementAccessExpression(input, factory.createNumericLiteral(i));
    const elementValidation = generateValidationCode(ctx, elements[i], elementAccess, `${path}[${i}]`, schemaExpr);
    elementExprs.push(elementValidation);
  }

  return factory.createConditionalExpression(
    factory.createBinaryExpression(
      isArrayCheck,
      factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
      lengthCheck
    ),
    factory.createToken(ts.SyntaxKind.QuestionToken),
    factory.createArrayLiteralExpression(elementExprs),
    factory.createToken(ts.SyntaxKind.ColonToken),
    generateThrowParseError(factory, path, `Expected tuple of length ${elements.length}`, input)
  );
}

/**
 * Generate union validation (simple approach — try each variant).
 */
function generateUnionValidation(
  ctx: MacroContext,
  schema: ParsedSchema,
  input: ts.Expression,
  path: string,
  schemaExpr: ts.Expression,
): ts.Expression {
  const factory = ctx.factory;
  const variants = schema.variants!;

  if (variants.length === 0) {
    return generateThrowParseError(factory, path, "Empty union", input);
  }

  if (variants.length === 1) {
    return generateValidationCode(ctx, variants[0], input, path, schemaExpr);
  }

  // Fall back to runtime Schema.decodeUnknownSync(schema)(input)
  return generateRuntimeFallback(factory, schemaExpr, input);
}

/**
 * Generate a throw expression for parse errors.
 *
 * @param valueExpr - The actual expression being validated, used for `typeof` in the error message.
 */
function generateThrowParseError(
  factory: ts.NodeFactory,
  path: string,
  message: string,
  valueExpr: ts.Expression,
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
              factory.createNewExpression(
                factory.createIdentifier("Error"),
                undefined,
                [
                  factory.createTemplateExpression(
                    factory.createTemplateHead(`Parse error at ${path}: ${message}, got `),
                    [
                      factory.createTemplateSpan(
                        factory.createTypeOfExpression(valueExpr),
                        factory.createTemplateTail("")
                      ),
                    ]
                  ),
                ]
              )
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

/**
 * Generate a runtime fallback: Schema.decodeUnknownSync(schemaExpr)(input).
 */
function generateRuntimeFallback(
  factory: ts.NodeFactory,
  schemaExpr: ts.Expression,
  input: ts.Expression,
): ts.Expression {
  return factory.createCallExpression(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("Schema"),
        factory.createIdentifier("decodeUnknownSync")
      ),
      undefined,
      [schemaExpr]
    ),
    undefined,
    [input]
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
      ctx.reportError(call, "specializeSchema() expects exactly one argument: specializeSchema(schema)");
      return call;
    }

    const schemaArg = args[0];
    const factory = ctx.factory;

    // Parse the schema structure
    const parsedSchema = inferSchemaKind(ctx, schemaArg);

    if (parsedSchema.kind === "unsupported") {
      ctx.reportWarning(
        schemaArg,
        "specializeSchema: Schema structure not recognized, falling back to runtime decoding"
      );
      return factory.createCallExpression(
        factory.createPropertyAccessExpression(
          factory.createIdentifier("Schema"),
          factory.createIdentifier("decodeSync")
        ),
        undefined,
        [schemaArg]
      );
    }

    const inputParam = factory.createIdentifier("input");
    const validation = generateValidationCode(ctx, parsedSchema, inputParam, "input", schemaArg);

    return factory.createArrowFunction(
      undefined,
      undefined,
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          inputParam,
          undefined,
          factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
          undefined
        ),
      ],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      validation
    );
  },
});

// ============================================================================
// specializeSchemaUnsafe() Expression Macro
// ============================================================================

/**
 * specializeSchemaUnsafe(schema, input) — Decode and return value, throw on failure.
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

    // Parse the schema structure
    const parsedSchema = inferSchemaKind(ctx, schemaArg);

    if (parsedSchema.kind === "unsupported") {
      ctx.reportWarning(
        schemaArg,
        "specializeSchemaUnsafe: Schema structure not recognized, falling back to runtime decoding"
      );
      return factory.createCallExpression(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createIdentifier("Schema"),
            factory.createIdentifier("decodeSync")
          ),
          undefined,
          [schemaArg]
        ),
        undefined,
        [inputArg]
      );
    }

    return generateValidationCode(ctx, parsedSchema, inputArg, "input", schemaArg);
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
