/**
 * Compile-Time Reflection Macros
 *
 * Provides compile-time type introspection capabilities, allowing you to
 * examine types, generate code based on type information, and more.
 *
 * Inspired by:
 * - Rust's proc_macro with derive
 * - Java/C# reflection but at compile time
 * - Zig's @typeInfo
 *
 * @example
 * ```typescript
 * @reflect
 * interface User {
 *   id: number;
 *   name: string;
 *   email: string;
 * }
 *
 * // Get metadata at compile time
 * const userMeta = typeInfo<User>();
 * // { name: "User", fields: [{ name: "id", type: "number" }, ...] }
 *
 * // Generate a validator
 * const validateUser = validator<User>();
 * ```
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  defineAttributeMacro,
  globalRegistry,
  TS9204,
} from "@typesugar/core";
import { MacroContext, AttributeTarget } from "@typesugar/core";

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const dummySource = ts.createSourceFile("__dummy__.ts", "", ts.ScriptTarget.Latest);

/**
 * Safely get the text of a node, handling synthetic nodes that lack source
 * file position information (pos === -1).
 */
function safeGetText(node: ts.Node): string {
  if (node.pos >= 0 && node.end >= 0) {
    try {
      return node.getText();
    } catch {
      // Fall through to printer
    }
  }
  try {
    return printer.printNode(ts.EmitHint.Unspecified, node, dummySource);
  } catch {
    return "unknown";
  }
}

// ============================================================================
// Type Information Structures
// ============================================================================

export interface TypeInfo {
  name: string;
  kind:
    | "interface"
    | "class"
    | "type"
    | "enum"
    | "primitive"
    | "union"
    | "intersection"
    | "array"
    | "tuple"
    | "function";
  fields?: FieldInfo[];
  methods?: MethodInfo[];
  typeParameters?: string[];
  extends?: string[];
  modifiers?: string[];
}

export interface FieldInfo {
  name: string;
  type: string;
  optional: boolean;
  readonly: boolean;
  defaultValue?: string;
}

export interface MethodInfo {
  name: string;
  parameters: ParameterInfo[];
  returnType: string;
  isAsync: boolean;
  isStatic: boolean;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
}

// ============================================================================
// @reflect Attribute Macro
// ============================================================================

export const reflectAttribute = defineAttributeMacro({
  name: "reflect",
  module: "@typesugar/macros",
  description: "Enable compile-time reflection for a type",
  validTargets: ["interface", "class", "type"] as AttributeTarget[],

  expand(
    ctx: MacroContext,
    decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    // Extract type information directly from the type checker
    const typeInfo = extractTypeInfo(ctx, target);

    if (typeInfo) {
      // Generate metadata as an exported const alongside the original declaration.
      // INTENTIONALLY UNHYGIENIC: The meta variable name is part of the public reflect API.
      // Users may reference this name directly (e.g., `__User_meta__`).
      const metaName = `__${typeInfo.name}_meta__`;
      const metaDecl = generateTypeInfoDeclaration(ctx, metaName, typeInfo);

      return [target, metaDecl];
    }

    return target;
  },
});

/**
 * Extract type information from a declaration
 */
function extractTypeInfo(ctx: MacroContext, node: ts.Declaration): TypeInfo | null {
  if (ts.isInterfaceDeclaration(node)) {
    return extractInterfaceInfo(ctx, node);
  }

  if (ts.isClassDeclaration(node)) {
    return extractClassInfo(ctx, node);
  }

  if (ts.isTypeAliasDeclaration(node)) {
    return extractTypeAliasInfo(ctx, node);
  }

  return null;
}

function extractInterfaceInfo(ctx: MacroContext, node: ts.InterfaceDeclaration): TypeInfo {
  let type: ts.Type;
  let properties: ts.Symbol[];
  try {
    type = ctx.typeChecker.getTypeAtLocation(node);
    properties = ctx.typeChecker.getPropertiesOfType(type);
  } catch {
    return {
      name: node.name.text,
      kind: "interface",
      fields: [],
      typeParameters: [],
      extends: [],
    };
  }

  const fields: FieldInfo[] = properties.map((prop) => {
    const decls = prop.getDeclarations();
    const decl = decls?.[0];
    let propTypeStr = "unknown";
    try {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl || node);
      propTypeStr = ctx.typeChecker.typeToString(propType);
    } catch {
      // Fall back to "unknown" for unresolvable types
    }

    return {
      name: prop.name,
      type: propTypeStr,
      optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
      readonly:
        decl && (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl))
          ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
          : false,
    };
  });

  const typeParameters = node.typeParameters?.map((tp) => tp.name.text) ?? [];
  const extendsTypes =
    node.heritageClauses
      ?.filter((hc) => hc.token === ts.SyntaxKind.ExtendsKeyword)
      .flatMap((hc) =>
        hc.types.map((t) =>
          ts.isIdentifier(t.expression) ? t.expression.text : safeGetText(t.expression)
        )
      ) ?? [];

  return {
    name: node.name.text,
    kind: "interface",
    fields,
    typeParameters,
    extends: extendsTypes,
  };
}

function extractClassInfo(ctx: MacroContext, node: ts.ClassDeclaration): TypeInfo {
  let type: ts.Type;
  let properties: ts.Symbol[];
  try {
    type = ctx.typeChecker.getTypeAtLocation(node);
    properties = ctx.typeChecker.getPropertiesOfType(type);
  } catch {
    return {
      name: node.name?.text ?? "Anonymous",
      kind: "class",
      fields: [],
      methods: [],
      typeParameters: [],
    };
  }

  const fields: FieldInfo[] = [];
  const methods: MethodInfo[] = [];

  for (const prop of properties) {
    const decls = prop.getDeclarations();
    const decl = decls?.[0];
    let typeStr = "unknown";
    try {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, decl || node);
      typeStr = ctx.typeChecker.typeToString(propType);
    } catch {
      // Fall back to "unknown" for unresolvable types
    }

    // Check if it's a method
    if (decl && ts.isMethodDeclaration(decl)) {
      const params: ParameterInfo[] = decl.parameters.map((p) => ({
        name: ts.isIdentifier(p.name) ? p.name.text : "param",
        type: p.type ? safeGetText(p.type) : "unknown",
        optional: !!p.questionToken,
        defaultValue: p.initializer ? safeGetText(p.initializer) : undefined,
      }));

      methods.push({
        name: prop.name,
        parameters: params,
        returnType: decl.type ? safeGetText(decl.type) : "void",
        isAsync: !!decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword),
        isStatic: !!decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword),
      });
    } else {
      fields.push({
        name: prop.name,
        type: typeStr,
        optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
        readonly:
          decl && ts.isPropertyDeclaration(decl)
            ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
            : false,
      });
    }
  }

  const typeParameters = node.typeParameters?.map((tp) => tp.name.text) ?? [];

  return {
    name: node.name?.text ?? "Anonymous",
    kind: "class",
    fields,
    methods,
    typeParameters,
  };
}

function extractTypeAliasInfo(ctx: MacroContext, node: ts.TypeAliasDeclaration): TypeInfo {
  let type: ts.Type;
  let typeString: string;
  try {
    type = ctx.typeChecker.getTypeAtLocation(node);
    typeString = ctx.typeChecker.typeToString(type);
  } catch {
    return {
      name: node.name.text,
      kind: "type",
      fields: [],
      typeParameters: node.typeParameters?.map((tp) => tp.name.text) ?? [],
    };
  }

  // For object types, extract fields
  if (type.isClassOrInterface() || type.flags & ts.TypeFlags.Object) {
    let properties: ts.Symbol[];
    try {
      properties = ctx.typeChecker.getPropertiesOfType(type);
    } catch {
      properties = [];
    }
    const fields: FieldInfo[] = properties.map((prop) => {
      let propTypeStr = "unknown";
      try {
        const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, node);
        propTypeStr = ctx.typeChecker.typeToString(propType);
      } catch {
        // Fall back to "unknown"
      }
      return {
        name: prop.name,
        type: propTypeStr,
        optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
        readonly: false,
      };
    });

    return {
      name: node.name.text,
      kind: "type",
      fields,
      typeParameters: node.typeParameters?.map((tp) => tp.name.text) ?? [],
    };
  }

  // Union type
  if (type.isUnion()) {
    return {
      name: node.name.text,
      kind: "union",
      typeParameters: node.typeParameters?.map((tp) => tp.name.text) ?? [],
    };
  }

  // Intersection type
  if (type.isIntersection()) {
    return {
      name: node.name.text,
      kind: "intersection",
      typeParameters: node.typeParameters?.map((tp) => tp.name.text) ?? [],
    };
  }

  return {
    name: node.name.text,
    kind: "type",
  };
}

/**
 * Generate a TypeInfo declaration
 */
function generateTypeInfoDeclaration(
  ctx: MacroContext,
  name: string,
  info: TypeInfo
): ts.Statement {
  const factory = ctx.factory;

  const fieldsArray =
    info.fields?.map((f) =>
      factory.createObjectLiteralExpression(
        [
          factory.createPropertyAssignment("name", factory.createStringLiteral(f.name)),
          factory.createPropertyAssignment("type", factory.createStringLiteral(f.type)),
          factory.createPropertyAssignment(
            "optional",
            f.optional ? factory.createTrue() : factory.createFalse()
          ),
          factory.createPropertyAssignment(
            "readonly",
            f.readonly ? factory.createTrue() : factory.createFalse()
          ),
        ],
        true
      )
    ) ?? [];

  const methodsArray =
    info.methods?.map((m) =>
      factory.createObjectLiteralExpression(
        [
          factory.createPropertyAssignment("name", factory.createStringLiteral(m.name)),
          factory.createPropertyAssignment("returnType", factory.createStringLiteral(m.returnType)),
          factory.createPropertyAssignment(
            "isAsync",
            m.isAsync ? factory.createTrue() : factory.createFalse()
          ),
          factory.createPropertyAssignment(
            "isStatic",
            m.isStatic ? factory.createTrue() : factory.createFalse()
          ),
          factory.createPropertyAssignment(
            "parameters",
            factory.createArrayLiteralExpression(
              m.parameters.map((p) =>
                factory.createObjectLiteralExpression(
                  [
                    factory.createPropertyAssignment("name", factory.createStringLiteral(p.name)),
                    factory.createPropertyAssignment("type", factory.createStringLiteral(p.type)),
                    factory.createPropertyAssignment(
                      "optional",
                      p.optional ? factory.createTrue() : factory.createFalse()
                    ),
                  ],
                  true
                )
              )
            )
          ),
        ],
        true
      )
    ) ?? [];

  const infoObj = factory.createObjectLiteralExpression(
    [
      factory.createPropertyAssignment("name", factory.createStringLiteral(info.name)),
      factory.createPropertyAssignment("kind", factory.createStringLiteral(info.kind)),
      factory.createPropertyAssignment(
        "fields",
        factory.createArrayLiteralExpression(fieldsArray, true)
      ),
      factory.createPropertyAssignment(
        "methods",
        factory.createArrayLiteralExpression(methodsArray, true)
      ),
      factory.createPropertyAssignment(
        "typeParameters",
        factory.createArrayLiteralExpression(
          (info.typeParameters ?? []).map((tp) => factory.createStringLiteral(tp))
        )
      ),
    ],
    true
  );

  return factory.createVariableStatement(
    [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    factory.createVariableDeclarationList(
      [factory.createVariableDeclaration(name, undefined, undefined, infoObj)],
      ts.NodeFlags.Const
    )
  );
}

// ============================================================================
// typeInfo<T>() Expression Macro
// ============================================================================

export const typeInfoMacro = defineExpressionMacro({
  name: "typeInfo",
  module: "@typesugar/macros",
  description: "Get compile-time type information",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;

    // Get the type argument
    const typeArgs = callExpr.typeArguments;
    if (!typeArgs || typeArgs.length !== 1) {
      ctx.diagnostic(TS9204).at(callExpr).withArgs({ macro: "typeInfo" }).emit();
      return callExpr;
    }

    const typeArg = typeArgs[0];
    const type = ctx.typeChecker.getTypeFromTypeNode(typeArg);
    const typeName = ctx.typeChecker.typeToString(type);

    // Always extract type info directly from the type checker.
    // This avoids cross-file mutable state and works reliably
    // regardless of file processing order or incremental builds.
    const properties = ctx.typeChecker.getPropertiesOfType(type);

    // Determine the kind
    let kind = "type";
    const symbol = type.getSymbol();
    if (symbol) {
      const decls = symbol.getDeclarations();
      if (decls && decls.length > 0) {
        const decl = decls[0];
        if (ts.isInterfaceDeclaration(decl)) kind = "interface";
        else if (ts.isClassDeclaration(decl)) kind = "class";
        else if (ts.isEnumDeclaration(decl)) kind = "enum";
      }
    }

    const fieldsArray = properties.map((prop) => {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, callExpr);
      const decls = prop.getDeclarations();
      const decl = decls?.[0];
      const isReadonly =
        decl && (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl))
          ? (decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false)
          : false;

      return factory.createObjectLiteralExpression(
        [
          factory.createPropertyAssignment("name", factory.createStringLiteral(prop.name)),
          factory.createPropertyAssignment(
            "type",
            factory.createStringLiteral(ctx.typeChecker.typeToString(propType))
          ),
          factory.createPropertyAssignment(
            "optional",
            (prop.flags & ts.SymbolFlags.Optional) !== 0
              ? factory.createTrue()
              : factory.createFalse()
          ),
          factory.createPropertyAssignment(
            "readonly",
            isReadonly ? factory.createTrue() : factory.createFalse()
          ),
        ],
        true
      );
    });

    return factory.createObjectLiteralExpression(
      [
        factory.createPropertyAssignment("name", factory.createStringLiteral(typeName)),
        factory.createPropertyAssignment("kind", factory.createStringLiteral(kind)),
        factory.createPropertyAssignment(
          "fields",
          factory.createArrayLiteralExpression(fieldsArray, true)
        ),
      ],
      true
    );
  },
});

// ============================================================================
// fieldNames<T>() - Get field names as a tuple type
// ============================================================================

export const fieldNamesMacro = defineExpressionMacro({
  name: "fieldNames",
  module: "@typesugar/macros",
  description: "Get field names of a type as an array",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.diagnostic(TS9204).at(callExpr).withArgs({ macro: "fieldNames" }).emit();
      return callExpr;
    }

    const type = ctx.typeChecker.getTypeFromTypeNode(typeArgs[0]);
    const properties = ctx.typeChecker.getPropertiesOfType(type);

    return factory.createArrayLiteralExpression(
      properties.map((prop) => factory.createStringLiteral(prop.name))
    );
  },
});

// ============================================================================
// validator<T>() - Generate a runtime validator
// ============================================================================

export const validatorMacro = defineExpressionMacro({
  name: "validator",
  module: "@typesugar/macros",
  description: "Generate a runtime validator for a type",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.diagnostic(TS9204).at(callExpr).withArgs({ macro: "validator" }).emit();
      return callExpr;
    }

    const type = ctx.typeChecker.getTypeFromTypeNode(typeArgs[0]);
    const properties = ctx.typeChecker.getPropertiesOfType(type);
    const typeName = ctx.typeChecker.typeToString(type);

    // Generate validation checks for each property
    const checks: ts.Statement[] = [];

    for (const prop of properties) {
      const propType = ctx.typeChecker.getTypeOfSymbolAtLocation(prop, callExpr);
      const propTypeStr = ctx.typeChecker.typeToString(propType);
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;

      // Generate type check
      let checkExpr: ts.Expression;

      if (propTypeStr === "string") {
        checkExpr = factory.createBinaryExpression(
          factory.createTypeOfExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier("value"), prop.name)
          ),
          factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
          factory.createStringLiteral("string")
        );
      } else if (propTypeStr === "number") {
        checkExpr = factory.createBinaryExpression(
          factory.createTypeOfExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier("value"), prop.name)
          ),
          factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
          factory.createStringLiteral("number")
        );
      } else if (propTypeStr === "boolean") {
        checkExpr = factory.createBinaryExpression(
          factory.createTypeOfExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier("value"), prop.name)
          ),
          factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
          factory.createStringLiteral("boolean")
        );
      } else {
        // Skip complex types for now
        continue;
      }

      // Add optional check
      if (isOptional) {
        checkExpr = factory.createBinaryExpression(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier("value"), prop.name),
            factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
            factory.createIdentifier("undefined")
          ),
          factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
          checkExpr
        );
      }

      checks.push(
        factory.createIfStatement(
          checkExpr,
          factory.createBlock([
            factory.createExpressionStatement(
              factory.createCallExpression(
                factory.createPropertyAccessExpression(factory.createIdentifier("errors"), "push"),
                undefined,
                [
                  factory.createStringLiteral(
                    `Invalid type for field '${prop.name}': expected ${propTypeStr}`
                  ),
                ]
              )
            ),
          ])
        )
      );
    }

    // Build the validator function
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
      factory.createTypeReferenceNode("ValidationResult", [typeArgs[0]]),
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock(
        [
          // const errors: string[] = [];
          factory.createVariableStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  "errors",
                  undefined,
                  factory.createArrayTypeNode(
                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
                  ),
                  factory.createArrayLiteralExpression([])
                ),
              ],
              ts.NodeFlags.Const
            )
          ),
          // Type check: if (typeof value !== "object" || value === null)
          factory.createIfStatement(
            factory.createBinaryExpression(
              factory.createBinaryExpression(
                factory.createTypeOfExpression(factory.createIdentifier("value")),
                factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
                factory.createStringLiteral("object")
              ),
              factory.createToken(ts.SyntaxKind.BarBarToken),
              factory.createBinaryExpression(
                factory.createIdentifier("value"),
                factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
                factory.createNull()
              )
            ),
            factory.createBlock([
              factory.createReturnStatement(
                factory.createObjectLiteralExpression(
                  [
                    factory.createPropertyAssignment("success", factory.createFalse()),
                    factory.createPropertyAssignment(
                      "errors",
                      factory.createArrayLiteralExpression([
                        factory.createStringLiteral(`Expected object, got ${typeof null}`),
                      ])
                    ),
                  ],
                  true
                )
              ),
            ])
          ),
          ...checks,
          // Return result
          factory.createReturnStatement(
            factory.createConditionalExpression(
              factory.createBinaryExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier("errors"),
                  "length"
                ),
                factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
                factory.createNumericLiteral(0)
              ),
              factory.createToken(ts.SyntaxKind.QuestionToken),
              factory.createObjectLiteralExpression(
                [
                  factory.createPropertyAssignment("success", factory.createTrue()),
                  factory.createPropertyAssignment(
                    "value",
                    factory.createAsExpression(factory.createIdentifier("value"), typeArgs[0])
                  ),
                ],
                true
              ),
              factory.createToken(ts.SyntaxKind.ColonToken),
              factory.createObjectLiteralExpression(
                [
                  factory.createPropertyAssignment("success", factory.createFalse()),
                  factory.createPropertyAssignment("errors", factory.createIdentifier("errors")),
                ],
                true
              )
            )
          ),
        ],
        true
      )
    );
  },
});

// Register macros
globalRegistry.register(reflectAttribute);
globalRegistry.register(typeInfoMacro);
globalRegistry.register(fieldNamesMacro);
globalRegistry.register(validatorMacro);

// ============================================================================
// Types for Runtime
// ============================================================================

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; errors: string[] };
