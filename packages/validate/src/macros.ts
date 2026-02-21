import * as ts from "typescript";
import { defineExpressionMacro, MacroContext } from "@typesugar/core";

// ============================================================================
// Shared Validation Generation
// ============================================================================

/**
 * Generate validation statements for a given type.
 * Appends error messages to an `errors` array.
 */
function generateValidationChecks(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  type: ts.Type,
  accessorExpr: ts.Expression,
  pathExpr: ts.Expression
): ts.Statement[] {
  const factory = ctx.factory;
  const typeStr = ctx.typeChecker.typeToString(type);
  const checks: ts.Statement[] = [];

  // 1. Handle primitive types (string, number, boolean)
  if (type.flags & ts.TypeFlags.String) {
    checks.push(
      factory.createIfStatement(
        factory.createBinaryExpression(
          factory.createTypeOfExpression(accessorExpr),
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          factory.createStringLiteral("string")
        ),
        factory.createBlock([createErrorPush(factory, pathExpr, "expected string")])
      )
    );
    return checks;
  }

  if (type.flags & ts.TypeFlags.Number) {
    checks.push(
      factory.createIfStatement(
        factory.createBinaryExpression(
          factory.createTypeOfExpression(accessorExpr),
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          factory.createStringLiteral("number")
        ),
        factory.createBlock([createErrorPush(factory, pathExpr, "expected number")])
      )
    );
    return checks;
  }

  if (type.flags & ts.TypeFlags.Boolean) {
    checks.push(
      factory.createIfStatement(
        factory.createBinaryExpression(
          factory.createTypeOfExpression(accessorExpr),
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
          factory.createStringLiteral("boolean")
        ),
        factory.createBlock([createErrorPush(factory, pathExpr, "expected boolean")])
      )
    );
    return checks;
  }

  // 1.5 Handle Union Types (simplistic MVP - just find non-undefined types)
  if (type.isUnion()) {
    // If it's a boolean union (true | false) or (boolean | undefined), TS represents boolean as a union of true | false
    if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLike) {
      checks.push(
        factory.createIfStatement(
          factory.createBinaryExpression(
            factory.createTypeOfExpression(accessorExpr),
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            factory.createStringLiteral("boolean")
          ),
          factory.createBlock([createErrorPush(factory, pathExpr, "expected boolean")])
        )
      );
      return checks;
    }

    // Filter out undefined/null if it's an optional field
    const nonNullableTypes = type.types.filter(
      (t) => !(t.flags & ts.TypeFlags.Undefined) && !(t.flags & ts.TypeFlags.Null)
    );

    // Check again if it's boolean
    if (
      nonNullableTypes.length === 2 &&
      nonNullableTypes[0].flags & ts.TypeFlags.BooleanLiteral &&
      nonNullableTypes[1].flags & ts.TypeFlags.BooleanLiteral
    ) {
      checks.push(
        factory.createIfStatement(
          factory.createBinaryExpression(
            factory.createTypeOfExpression(accessorExpr),
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            factory.createStringLiteral("boolean")
          ),
          factory.createBlock([createErrorPush(factory, pathExpr, "expected boolean")])
        )
      );
      return checks;
    }

    if (nonNullableTypes.length === 1) {
      return generateValidationChecks(ctx, callExpr, nonNullableTypes[0], accessorExpr, pathExpr);
    }
  }

  // 2. Handle Arrays
  if (ctx.typeChecker.isArrayType(type) || typeStr.includes("[]") || typeStr.startsWith("Array<")) {
    checks.push(
      factory.createIfStatement(
        factory.createPrefixUnaryExpression(
          ts.SyntaxKind.ExclamationToken,
          factory.createCallExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier("Array"), "isArray"),
            undefined,
            [accessorExpr]
          )
        ),
        factory.createBlock([createErrorPush(factory, pathExpr, "expected array")])
      )
    );

    // We could recurse into array elements here, but for MVP we'll stick to shallow checks
    return checks;
  }

  // 3. Handle Objects (Product Types)
  if (type.isClassOrInterface() || type.flags & ts.TypeFlags.Object) {
    checks.push(
      factory.createIfStatement(
        factory.createBinaryExpression(
          factory.createBinaryExpression(
            factory.createTypeOfExpression(accessorExpr),
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            factory.createStringLiteral("object")
          ),
          ts.SyntaxKind.BarBarToken,
          factory.createBinaryExpression(
            accessorExpr,
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            factory.createNull()
          )
        ),
        factory.createBlock([createErrorPush(factory, pathExpr, "expected object")])
      )
    );

    const properties = ctx.typeChecker.getPropertiesOfType(type);
    for (const prop of properties) {
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, callExpr);

      const propAccessor = factory.createPropertyAccessExpression(
        accessorExpr,
        factory.createIdentifier(prop.name)
      );

      const propPath = factory.createBinaryExpression(
        pathExpr,
        ts.SyntaxKind.PlusToken,
        factory.createStringLiteral(`.${prop.name}`)
      );

      const propChecks = generateValidationChecks(ctx, callExpr, propType, propAccessor, propPath);

      if (isOptional) {
        checks.push(
          factory.createIfStatement(
            factory.createBinaryExpression(
              propAccessor,
              ts.SyntaxKind.ExclamationEqualsEqualsToken,
              factory.createIdentifier("undefined")
            ),
            factory.createBlock(propChecks.filter(Boolean))
          )
        );
      } else {
        checks.push(...propChecks.filter(Boolean));
      }
    }
  }

  console.log(
    "Returning checks:",
    checks.map((c) => c?.kind)
  );
  return checks.filter(Boolean);
}

function createErrorPush(
  factory: ts.NodeFactory,
  pathExpr: ts.Expression,
  message: string
): ts.Statement {
  return factory.createExpressionStatement(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier("errors"), "push"),
      undefined,
      [
        factory.createObjectLiteralExpression([
          factory.createPropertyAssignment(factory.createIdentifier("path"), pathExpr),
          factory.createPropertyAssignment(
            factory.createIdentifier("message"),
            factory.createStringLiteral(message)
          ),
        ]),
      ]
    )
  );
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
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(callExpr, "validate requires exactly one type argument");
      return callExpr;
    }

    const typeNode = typeArgs[0];
    const type = ctx.typeChecker.getTypeFromTypeNode(typeNode);
    const clonedTypeNode = typeNode;

    const checks = generateValidationChecks(
      ctx,
      callExpr,
      type,
      factory.createIdentifier("value"),
      factory.createStringLiteral("$")
    );

    return factory.createArrowFunction(
      undefined,
      undefined,
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("value"),
          undefined,
          factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
        ),
      ],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock(
        [
          // const errors: ValidationError[] = [];
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  "errors",
                  undefined,
                  factory.createArrayTypeNode(
                    factory.createTypeReferenceNode(factory.createIdentifier("ValidationError"))
                  ),
                  factory.createArrayLiteralExpression([])
                ),
              ],
              ts.NodeFlags.Const
            )
          ),
          ...checks,
          // return errors.length === 0 ? Valid(value as T) : Invalid(errors);
          factory.createReturnStatement(
            factory.createConditionalExpression(
              factory.createBinaryExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier("errors"),
                  "length"
                ),
                ts.SyntaxKind.EqualsEqualsEqualsToken,
                factory.createNumericLiteral(0)
              ),
              factory.createToken(ts.SyntaxKind.QuestionToken),
              factory.createCallExpression(factory.createIdentifier("Valid"), undefined, [
                factory.createAsExpression(factory.createIdentifier("value"), clonedTypeNode),
              ]),
              factory.createToken(ts.SyntaxKind.ColonToken),
              factory.createCallExpression(factory.createIdentifier("Invalid"), undefined, [
                factory.createIdentifier("errors"),
              ])
            )
          ),
        ],
        true
      )
    );
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
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(callExpr, "is requires exactly one type argument");
      return callExpr;
    }

    const typeNode = typeArgs[0];
    // Create a clone of the type node to avoid sharing parent references
    const clonedTypeNode = typeNode;
    const type = ctx.typeChecker.getTypeFromTypeNode(typeNode);

    // We reuse the validate macro logic, but we just check if errors length is 0
    const checks = generateValidationChecks(
      ctx,
      callExpr,
      type,
      factory.createIdentifier("value"),
      factory.createStringLiteral("$")
    );

    const result = factory.createArrowFunction(
      undefined,
      undefined,
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("value"),
          undefined,
          factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
        ),
      ],
      factory.createTypePredicateNode(undefined, factory.createIdentifier("value"), clonedTypeNode),
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock(
        [
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  "errors",
                  undefined,
                  undefined,
                  factory.createArrayLiteralExpression([])
                ),
              ],
              ts.NodeFlags.Const
            )
          ),
          ...checks,
          factory.createReturnStatement(
            factory.createBinaryExpression(
              factory.createPropertyAccessExpression(factory.createIdentifier("errors"), "length"),
              ts.SyntaxKind.EqualsEqualsEqualsToken,
              factory.createNumericLiteral(0)
            )
          ),
        ],
        true
      )
    );

    console.log("isMacro generated AST successfully. Printing:");
    try {
      console.log(
        ts.createPrinter().printNode(ts.EmitHint.Unspecified, result, callExpr.getSourceFile())
      );
    } catch (printErr: any) {
      console.log("PRINTER CRASHED:", printErr.stack);
    }
    return result;
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
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(callExpr, "assert requires exactly one type argument");
      return callExpr;
    }

    const typeNode = typeArgs[0];
    const type = ctx.typeChecker.getTypeFromTypeNode(typeNode);
    const clonedTypeNode = typeNode;

    const checks = generateValidationChecks(
      ctx,
      callExpr,
      type,
      factory.createIdentifier("value"),
      factory.createStringLiteral("$")
    );

    return factory.createArrowFunction(
      undefined,
      undefined,
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          factory.createIdentifier("value"),
          undefined,
          factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
        ),
      ],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock(
        [
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  "errors",
                  undefined,
                  undefined,
                  factory.createArrayLiteralExpression([])
                ),
              ],
              ts.NodeFlags.Const
            )
          ),
          ...checks,
          factory.createIfStatement(
            factory.createBinaryExpression(
              factory.createPropertyAccessExpression(factory.createIdentifier("errors"), "length"),
              ts.SyntaxKind.GreaterThanToken,
              factory.createNumericLiteral(0)
            ),
            factory.createBlock([
              factory.createThrowStatement(
                factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
                  factory.createBinaryExpression(
                    factory.createStringLiteral("Validation failed: "),
                    ts.SyntaxKind.PlusToken,
                    factory.createCallExpression(
                      factory.createPropertyAccessExpression(
                        factory.createCallExpression(
                          factory.createPropertyAccessExpression(
                            factory.createIdentifier("JSON"),
                            "stringify"
                          ),
                          undefined,
                          [factory.createIdentifier("errors")]
                        ),
                        "substring"
                      ),
                      undefined,
                      [factory.createNumericLiteral(0), factory.createNumericLiteral(100)]
                    )
                  ),
                ])
              ),
            ])
          ),
          factory.createReturnStatement(
            factory.createAsExpression(factory.createIdentifier("value"), clonedTypeNode)
          ),
        ],
        true
      )
    );
  },
});

export function register(registry: import("@typesugar/core").MacroRegistry): void {
  registry.register(validateMacro);
  registry.register(isMacro);
  registry.register(assertMacro);
}
