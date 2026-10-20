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
import { defineExpressionMacro, defineAttributeMacro, globalRegistry } from "@typesugar/core";
import { MacroContext, AttributeTarget, isSyntheticNode } from "@typesugar/core";

const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
const dummySource = ts.createSourceFile("__dummy__.ts", "", ts.ScriptTarget.Latest);

/**
 * Safely get the text of a node, handling synthetic nodes that lack source
 * file position information.
 */
function safeGetText(node: ts.Node): string {
  if (!isSyntheticNode(node)) {
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
  variants?: string[];
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
  cacheable: false, // depends on the checker's view of the type, not just the call text
  module: "typesugar",
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
    const variants = (type as ts.UnionType).types.map((t) => ctx.typeChecker.typeToString(t));
    return {
      name: node.name.text,
      kind: "union",
      variants,
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
  cacheable: false, // depends on the checker's view of the type, not just the call text
  module: "typesugar",
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
      ctx.reportError(callExpr, "typeInfo requires exactly one type argument");
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
  cacheable: false, // depends on the checker's view of the type, not just the call text
  module: "typesugar",
  description: "Get field names of a type as an array",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(callExpr, "fieldNames requires exactly one type argument");
      return callExpr;
    }

    const type = ctx.typeChecker.getTypeFromTypeNode(typeArgs[0]);
    const properties = ctx.typeChecker.getPropertiesOfType(type);

    return factory.createArrayLiteralExpression(
      properties.map((prop) => factory.createStringLiteral(prop.name))
    );
  },
});

/** True when `name` can be written as `value.name` (public scanner API only). */
function isIdentifierName(name: string): boolean {
  if (name.length === 0) return false;
  let i = 0;
  for (const ch of name) {
    const cp = ch.codePointAt(0)!;
    const ok =
      i === 0
        ? ts.isIdentifierStart(cp, ts.ScriptTarget.ESNext)
        : ts.isIdentifierPart(cp, ts.ScriptTarget.ESNext);
    if (!ok) return false;
    i++;
  }
  return true;
}

// ============================================================================
// validator<T>() - Generate a runtime validator
// ============================================================================

export const validatorMacro = defineExpressionMacro({
  name: "validator",
  cacheable: false, // depends on the checker's view of the type, not just the call text
  module: "typesugar",
  description: "Generate a runtime validator for a type",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    const factory = ctx.factory;
    const typeArgs = callExpr.typeArguments;

    if (!typeArgs || typeArgs.length !== 1) {
      ctx.reportError(callExpr, "validator requires exactly one type argument");
      return callExpr;
    }

    const checker = ctx.typeChecker;
    const type = checker.getTypeFromTypeNode(typeArgs[0]);

    // A primitive or literal T (`string | number`, `"a" | "b"`, `boolean |
    // undefined`) is checked as a whole, below. The object path would demand
    // `typeof value === "object"` and then check T's apparent members
    // (toString, valueOf, ...), so it rejected every value T allows.
    const PRIMITIVE_FLAGS =
      ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.ESSymbolLike |
      ts.TypeFlags.EnumLike |
      ts.TypeFlags.Null |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.Void;
    const topIsPrimitive = (type.isUnion() ? type.types : [type]).every(
      (m) => (m.flags & PRIMITIVE_FLAGS) !== 0
    );
    const properties = topIsPrimitive ? [] : checker.getPropertiesOfType(type);

    const valueId = () => factory.createIdentifier("value");
    const or = (l: ts.Expression, r: ts.Expression) =>
      factory.createBinaryExpression(l, factory.createToken(ts.SyntaxKind.BarBarToken), r);
    const and = (l: ts.Expression, r: ts.Expression) =>
      factory.createBinaryExpression(
        l,
        factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
        r
      );
    const notStrictEq = (l: ts.Expression, r: ts.Expression) =>
      factory.createBinaryExpression(
        l,
        factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
        r
      );
    const strictEq = (l: ts.Expression, r: ts.Expression) =>
      factory.createBinaryExpression(
        l,
        factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
        r
      );
    const typeofNot = (e: ts.Expression, t: string) =>
      notStrictEq(factory.createTypeOfExpression(e), factory.createStringLiteral(t));
    const notObject = (e: () => ts.Expression) =>
      factory.createParenthesizedExpression(
        or(typeofNot(e(), "object"), strictEq(e(), factory.createNull()))
      );
    const notArray = (e: ts.Expression) =>
      factory.createPrefixUnaryExpression(
        ts.SyntaxKind.ExclamationToken,
        factory.createCallExpression(
          factory.createPropertyAccessExpression(factory.createIdentifier("Array"), "isArray"),
          undefined,
          [e]
        )
      );

    /** Expression evaluating to the literal value of a literal type. */
    const literalExpr = (t: ts.Type): ts.Expression | undefined => {
      if (t.isStringLiteral()) return factory.createStringLiteral(t.value);
      if (t.isNumberLiteral()) {
        return t.value < 0 || Object.is(t.value, -0)
          ? factory.createPrefixUnaryExpression(
              ts.SyntaxKind.MinusToken,
              factory.createNumericLiteral(Math.abs(t.value))
            )
          : factory.createNumericLiteral(t.value);
      }
      if (t.flags & ts.TypeFlags.BigIntLiteral) {
        const v = (t as ts.BigIntLiteralType).value;
        const lit = factory.createBigIntLiteral(`${v.base10Value}n`);
        return v.negative
          ? factory.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, lit)
          : lit;
      }
      if (t.flags & ts.TypeFlags.BooleanLiteral) {
        return checker.typeToString(t) === "true" ? factory.createTrue() : factory.createFalse();
      }
      return undefined;
    };

    /**
     * Build an expression that is TRUE when `access()` does NOT match `t`.
     * Returns "any" when every value matches, or undefined when the type
     * cannot be checked at runtime (the caller reports that, rather than
     * silently skipping the field).
     */
    const failCheck = (
      t: ts.Type,
      access: () => ts.Expression
    ): ts.Expression | "any" | undefined => {
      const f = t.flags;
      if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return "any";
      if (f & ts.TypeFlags.Boolean && !t.isUnion()) return typeofNot(access(), "boolean");
      if (f & ts.TypeFlags.Null) return notStrictEq(access(), factory.createNull());
      if (f & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) {
        return notStrictEq(access(), factory.createIdentifier("undefined"));
      }
      const lit = literalExpr(t);
      if (lit) return notStrictEq(access(), lit);
      if (t.isUnion()) {
        // `boolean` (true | false), enums and literal unions all land here.
        // A value is invalid only if it fails EVERY member.
        const parts: ts.Expression[] = [];
        for (const member of t.types) {
          const c = failCheck(member, access);
          if (c === "any") return "any";
          if (c === undefined) return undefined;
          parts.push(c);
        }
        return factory.createParenthesizedExpression(parts.reduce(and));
      }
      if (f & ts.TypeFlags.StringLike) return typeofNot(access(), "string");
      if (f & ts.TypeFlags.NumberLike) return typeofNot(access(), "number");
      if (f & ts.TypeFlags.BigIntLike) return typeofNot(access(), "bigint");
      if (f & ts.TypeFlags.ESSymbolLike) return typeofNot(access(), "symbol");
      if (f & ts.TypeFlags.NonPrimitive) {
        // `object`: any non-null object or function
        return and(notObject(access), typeofNot(access(), "function"));
      }
      if (checker.isArrayType(t) || checker.isTupleType(t)) return notArray(access());
      if (t.isIntersection() && t.types.every((m) => (m.flags & ts.TypeFlags.Object) !== 0)) {
        return notObject(access);
      }
      if (f & ts.TypeFlags.Object) {
        if (t.getCallSignatures().length > 0 || t.getConstructSignatures().length > 0) {
          return typeofNot(access(), "function");
        }
        return notObject(access);
      }
      // Type parameters, intersections, conditional/indexed types, never, ...
      return undefined;
    };

    // Generate validation checks for each property
    const checks: ts.Statement[] = [];

    for (const prop of properties) {
      if (prop.name.startsWith("__@") || prop.name.startsWith("#")) {
        ctx.reportWarning(
          callExpr,
          `validator: property '${prop.name}' is symbol-keyed or private and is not validated`
        );
        continue;
      }
      const propType = checker.getTypeOfSymbolAtLocation(prop, callExpr);
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;

      // (value as Record<string, unknown>).name, or [...]["first-name"] when the
      // key is not an identifier. `value` is narrowed only to `object` at this
      // point, so a bare `value.name` fails strictOutput (TS2339/TS7053).
      const asRecord = () =>
        factory.createParenthesizedExpression(
          factory.createAsExpression(
            valueId(),
            factory.createTypeReferenceNode("Record", [
              factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
              factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
            ])
          )
        );
      const fieldAccess = () =>
        isIdentifierName(prop.name)
          ? factory.createPropertyAccessExpression(asRecord(), prop.name)
          : factory.createElementAccessExpression(
              asRecord(),
              factory.createStringLiteral(prop.name)
            );

      let checkExpr: ts.Expression | "any" | undefined =
        prop.flags & ts.SymbolFlags.Method
          ? typeofNot(fieldAccess(), "function")
          : failCheck(propType, fieldAccess);

      if (checkExpr === undefined) {
        ctx.reportWarning(
          callExpr,
          `validator: field '${prop.name}' has type '${checker.typeToString(propType)}', ` +
            `which cannot be checked at runtime; it is not validated`
        );
        continue;
      }
      if (checkExpr === "any") continue;

      // An optional property may be absent even when its type (without
      // strictNullChecks) does not include undefined.
      if (isOptional) {
        checkExpr = and(
          notStrictEq(fieldAccess(), factory.createIdentifier("undefined")),
          checkExpr
        );
      }

      const expectedStr = checker.typeToString(propType);
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
                    `Invalid type for field '${prop.name}': expected ${expectedStr}`
                  ),
                ]
              )
            ),
          ])
        )
      );
    }

    // { success: true; value: T } | { success: false; errors: string[] }
    // (inlined: the ValidationResult name is not necessarily in scope at the call site)
    const resultType = factory.createUnionTypeNode([
      factory.createTypeLiteralNode([
        factory.createPropertySignature(
          undefined,
          "success",
          undefined,
          factory.createLiteralTypeNode(factory.createTrue())
        ),
        factory.createPropertySignature(undefined, "value", undefined, typeArgs[0]),
      ]),
      factory.createTypeLiteralNode([
        factory.createPropertySignature(
          undefined,
          "success",
          undefined,
          factory.createLiteralTypeNode(factory.createFalse())
        ),
        factory.createPropertySignature(
          undefined,
          "errors",
          undefined,
          factory.createArrayTypeNode(factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword))
        ),
      ]),
    ]);

    // "Expected <what>, got " + (value === null ? "null" : typeof value)
    const expectedGot = (what: string) =>
      factory.createBinaryExpression(
        factory.createStringLiteral(`Expected ${what}, got `),
        factory.createToken(ts.SyntaxKind.PlusToken),
        factory.createParenthesizedExpression(
          factory.createConditionalExpression(
            strictEq(valueId(), factory.createNull()),
            factory.createToken(ts.SyntaxKind.QuestionToken),
            factory.createStringLiteral("null"),
            factory.createToken(ts.SyntaxKind.ColonToken),
            factory.createTypeOfExpression(valueId())
          )
        )
      );

    // Primitive / literal T: one check of the whole value.
    const primitiveFail = topIsPrimitive ? failCheck(type, valueId) : undefined;
    const primitiveChecks: ts.Statement[] =
      primitiveFail && primitiveFail !== "any"
        ? [
            factory.createIfStatement(
              primitiveFail,
              factory.createBlock([
                factory.createExpressionStatement(
                  factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                      factory.createIdentifier("errors"),
                      "push"
                    ),
                    undefined,
                    [expectedGot(checker.typeToString(type))]
                  )
                ),
              ])
            ),
          ]
        : [];

    // Object T: if (typeof value !== "object" || value === null) return failure
    const objectGuard = factory.createIfStatement(
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
                factory.createArrayLiteralExpression([expectedGot("object")])
              ),
            ],
            true
          )
        ),
      ])
    );

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
      resultType,
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
          ...(topIsPrimitive ? primitiveChecks : [objectGuard]),
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
