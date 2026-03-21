/**
 * @adt Attribute Macro (PEP-014 Wave 3)
 *
 * Registers a type alias as an ADT (Algebraic Data Type) whose variants
 * are discriminated unions with native TypeScript narrowing.
 *
 * The macro analyzes variant interfaces and determines if they can be
 * distinguished by field presence alone. When variants are NOT structurally
 * distinguishable, it auto-injects `_tag` via intersection types.
 *
 * Usage:
 * ```typescript
 * interface Left<E, A> {
 *   readonly left: E;
 *   readonly right?: undefined;
 * }
 *
 * interface Right<E, A> {
 *   readonly left?: undefined;
 *   readonly right: A;
 * }
 *
 * /** @adt *\/
 * type Either<E, A> = Left<E, A> | Right<E, A>;
 * ```
 *
 * For null-represented variants:
 * ```typescript
 * /** @adt { Nil: null } *\/
 * type List<A> = Cons<A> | Nil;
 * ```
 *
 * @see PEP-014 — ADT Macro for Zero-Cost Discriminated Unions
 * @see PEP-011 — SFINAE Diagnostic Resolution
 * @see PEP-012 — Type Macros
 */

import ts from "typescript";
import type { MacroContext, AttributeMacro } from "@typesugar/core";
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
import {
  registerTypeRewrite,
  type TypeRewriteEntry,
  type ConstructorRewrite,
} from "@typesugar/core";
import { resolveSourceModule } from "./opaque.js";
import { quoteStatements } from "./quote.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Information about a variant in the ADT.
 */
interface VariantInfo {
  /** The variant name (interface name) */
  name: string;
  /** The variant's interface declaration (if found) */
  declaration?: ts.InterfaceDeclaration;
  /** Required field names on this variant */
  requiredFields: Set<string>;
  /** Optional field names on this variant */
  optionalFields: Set<string>;
  /** All field names (required + optional) */
  allFields: Set<string>;
  /** Whether this variant is null-represented */
  isNull: boolean;
  /** Type parameters on the variant interface */
  typeParams: string[];
}

/**
 * Distinguishability status for a pair of variants.
 */
type Distinguishability =
  | { kind: "null-vs-nonnull" }
  | { kind: "unique-required-field"; field: string; owner: string }
  | { kind: "field-type-difference"; field: string }
  | { kind: "indistinguishable" };

/**
 * Parsed null-representation map from @adt tag.
 * Maps variant name → runtime value (e.g., { Nil: null })
 */
type NullRepresentationMap = Map<string, string>;

// ============================================================================
// JSDoc Tag Parsing
// ============================================================================

/**
 * Extract the `@adt` JSDoc tag comment from a type alias declaration.
 *
 * @returns The null-representation map (e.g., { Nil: null }), or empty map if no config
 */
function extractAdtTag(node: ts.TypeAliasDeclaration): NullRepresentationMap {
  const nullMap = new Map<string, string>();

  const tags = ts.getJSDocTags(node);
  for (const tag of tags) {
    if (tag.tagName.text === "adt") {
      const comment =
        typeof tag.comment === "string" ? tag.comment : ts.getTextOfJSDocComment(tag.comment);

      if (comment) {
        // Parse { Nil: null } style config
        const trimmed = comment.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          const inner = trimmed.slice(1, -1).trim();
          // Simple parsing for { Variant: null } format
          const entries = inner.split(",").map((s) => s.trim());
          for (const entry of entries) {
            const match = /^(\w+)\s*:\s*(\w+)$/.exec(entry);
            if (match) {
              nullMap.set(match[1], match[2]);
            }
          }
        }
      }
    }
  }

  return nullMap;
}

/**
 * Check if a type alias has the @adt JSDoc tag.
 */
function hasAdtTag(node: ts.TypeAliasDeclaration): boolean {
  const tags = ts.getJSDocTags(node);
  return tags.some((tag) => tag.tagName.text === "adt");
}

// ============================================================================
// Variant Analysis
// ============================================================================

/**
 * Extract variant information from a union type.
 */
function extractVariants(
  ctx: MacroContext,
  unionType: ts.UnionTypeNode,
  nullMap: NullRepresentationMap
): VariantInfo[] {
  const variants: VariantInfo[] = [];

  for (const member of unionType.types) {
    const variantInfo = analyzeVariantMember(ctx, member, nullMap);
    if (variantInfo) {
      variants.push(variantInfo);
    }
  }

  return variants;
}

/**
 * Analyze a single variant member of the union.
 */
function analyzeVariantMember(
  ctx: MacroContext,
  member: ts.TypeNode,
  nullMap: NullRepresentationMap
): VariantInfo | undefined {
  // Handle type references (e.g., Left<E, A>, Cons<A>)
  if (ts.isTypeReferenceNode(member)) {
    const typeName = member.typeName;
    let name: string;

    if (ts.isIdentifier(typeName)) {
      name = typeName.text;
    } else if (ts.isQualifiedName(typeName)) {
      name = typeName.right.text;
    } else {
      return undefined;
    }

    // Check if this variant is null-represented
    const isNull = nullMap.has(name);

    // Find the interface declaration
    const symbol = ctx.typeChecker.getSymbolAtLocation(typeName);
    const declaration = symbol?.declarations?.find(ts.isInterfaceDeclaration);

    // Extract fields from the interface
    const requiredFields = new Set<string>();
    const optionalFields = new Set<string>();
    const allFields = new Set<string>();

    if (declaration) {
      for (const memberDecl of declaration.members) {
        if (ts.isPropertySignature(memberDecl) && memberDecl.name) {
          const fieldName = ts.isIdentifier(memberDecl.name) ? memberDecl.name.text : undefined;
          if (fieldName) {
            allFields.add(fieldName);
            if (memberDecl.questionToken) {
              optionalFields.add(fieldName);
            } else {
              requiredFields.add(fieldName);
            }
          }
        }
      }
    }

    // Extract type parameters
    const typeParams: string[] = [];
    if (member.typeArguments) {
      for (const arg of member.typeArguments) {
        typeParams.push(arg.getText());
      }
    }

    return {
      name,
      declaration,
      requiredFields,
      optionalFields,
      allFields,
      isNull,
      typeParams,
    };
  }

  // Handle literal null type
  if (member.kind === ts.SyntaxKind.NullKeyword || member.kind === ts.SyntaxKind.LiteralType) {
    return {
      name: "null",
      requiredFields: new Set(),
      optionalFields: new Set(),
      allFields: new Set(),
      isNull: true,
      typeParams: [],
    };
  }

  return undefined;
}

// ============================================================================
// Distinguishability Analysis
// ============================================================================

/**
 * Build a distinguishability matrix for all variant pairs.
 *
 * Returns a map from variant name → set of variants it can be distinguished from.
 * A variant needs a `_tag` if it cannot be distinguished from at least one other variant.
 */
function buildDistinguishabilityMatrix(variants: VariantInfo[]): Map<string, Set<string>> {
  const matrix = new Map<string, Set<string>>();

  for (const v of variants) {
    matrix.set(v.name, new Set());
  }

  for (let i = 0; i < variants.length; i++) {
    for (let j = i + 1; j < variants.length; j++) {
      const a = variants[i];
      const b = variants[j];
      const result = checkDistinguishability(a, b);

      if (result.kind !== "indistinguishable") {
        matrix.get(a.name)!.add(b.name);
        matrix.get(b.name)!.add(a.name);
      }
    }
  }

  return matrix;
}

/**
 * Check if two variants are distinguishable by structure alone.
 */
function checkDistinguishability(a: VariantInfo, b: VariantInfo): Distinguishability {
  // Rule 1: Null vs non-null
  if (a.isNull !== b.isNull) {
    return { kind: "null-vs-nonnull" };
  }

  // Rule 2: Unique required field - one has a required field the other doesn't have at all
  for (const field of a.requiredFields) {
    if (!b.allFields.has(field)) {
      return { kind: "unique-required-field", field, owner: a.name };
    }
  }
  for (const field of b.requiredFields) {
    if (!a.allFields.has(field)) {
      return { kind: "unique-required-field", field, owner: b.name };
    }
  }

  // Rule 3: Field presence difference - one has a required field, other has it optional or missing
  // This means we can distinguish by checking if the field is defined
  for (const field of a.requiredFields) {
    if (b.optionalFields.has(field) || !b.allFields.has(field)) {
      return { kind: "unique-required-field", field, owner: a.name };
    }
  }
  for (const field of b.requiredFields) {
    if (a.optionalFields.has(field) || !a.allFields.has(field)) {
      return { kind: "unique-required-field", field, owner: b.name };
    }
  }

  return { kind: "indistinguishable" };
}

/**
 * Determine which variants need a `_tag` discriminant.
 *
 * A variant needs `_tag` if it cannot be distinguished from at least one other variant.
 */
function findVariantsNeedingTag(variants: VariantInfo[]): Set<string> {
  const needsTag = new Set<string>();
  const matrix = buildDistinguishabilityMatrix(variants);

  // A variant needs _tag if it's not distinguishable from ALL other variants
  for (const variant of variants) {
    const distinguishableFrom = matrix.get(variant.name)!;
    const otherVariants = variants.filter((v) => v.name !== variant.name);

    // If this variant is indistinguishable from any other variant, it needs a tag
    for (const other of otherVariants) {
      if (!distinguishableFrom.has(other.name)) {
        needsTag.add(variant.name);
        needsTag.add(other.name); // Both need tags if they're indistinguishable from each other
      }
    }
  }

  return needsTag;
}

// ============================================================================
// Code Generation
// ============================================================================

/**
 * Generate the transformed type alias with `_tag` intersections where needed.
 */
function generateTransformedTypeAlias(
  ctx: MacroContext,
  target: ts.TypeAliasDeclaration,
  variants: VariantInfo[],
  needsTag: Set<string>
): ts.TypeAliasDeclaration {
  const factory = ctx.factory;

  // Build new union members
  const newUnionMembers: ts.TypeNode[] = [];

  for (const variant of variants) {
    if (variant.isNull && variant.name === "null") {
      // Literal null type
      newUnionMembers.push(factory.createLiteralTypeNode(factory.createNull()));
    } else if (needsTag.has(variant.name)) {
      // Add _tag intersection
      const typeRef = factory.createTypeReferenceNode(
        variant.name,
        variant.typeParams.length > 0
          ? variant.typeParams.map((p) => factory.createTypeReferenceNode(p))
          : undefined
      );

      const tagType = factory.createTypeLiteralNode([
        factory.createPropertySignature(
          [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
          "_tag",
          undefined,
          factory.createLiteralTypeNode(factory.createStringLiteral(variant.name))
        ),
      ]);

      newUnionMembers.push(factory.createIntersectionTypeNode([typeRef, tagType]));
    } else {
      // No _tag needed
      const typeRef = factory.createTypeReferenceNode(
        variant.name,
        variant.typeParams.length > 0
          ? variant.typeParams.map((p) => factory.createTypeReferenceNode(p))
          : undefined
      );
      newUnionMembers.push(typeRef);
    }
  }

  const newUnionType = factory.createUnionTypeNode(newUnionMembers);

  return factory.updateTypeAliasDeclaration(
    target,
    target.modifiers,
    target.name,
    target.typeParameters,
    newUnionType
  );
}

/**
 * Generate constructor functions for each variant.
 */
function generateConstructors(
  ctx: MacroContext,
  adtName: string,
  variants: VariantInfo[],
  needsTag: Set<string>,
  nullMap: NullRepresentationMap
): ts.Statement[] {
  const statements: ts.Statement[] = [];
  const factory = ctx.factory;

  for (const variant of variants) {
    // Skip null literal type
    if (variant.name === "null") continue;

    // Check if this is a null-represented variant
    if (nullMap.has(variant.name)) {
      // Generate: export const Nil: Nil = null;
      const constDecl = factory.createVariableStatement(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        factory.createVariableDeclarationList(
          [
            factory.createVariableDeclaration(
              variant.name,
              undefined,
              factory.createTypeReferenceNode(variant.name),
              factory.createNull()
            ),
          ],
          ts.NodeFlags.Const
        )
      );
      statements.push(constDecl);
    } else {
      // Generate constructor function
      const params: ts.ParameterDeclaration[] = [];
      const objectProps: ts.ObjectLiteralElementLike[] = [];

      // Add _tag if needed
      if (needsTag.has(variant.name)) {
        objectProps.push(
          factory.createPropertyAssignment("_tag", factory.createStringLiteral(variant.name))
        );
      }

      // Add parameters for required fields
      for (const field of variant.requiredFields) {
        params.push(
          factory.createParameterDeclaration(
            undefined,
            undefined,
            field,
            undefined,
            undefined, // Type will be inferred
            undefined
          )
        );
        objectProps.push(factory.createShorthandPropertyAssignment(field));
      }

      // Generate type parameters if present
      const typeParams = variant.declaration?.typeParameters?.map((tp) =>
        factory.createTypeParameterDeclaration(undefined, tp.name.text, tp.constraint, tp.default)
      );

      // Generate return type
      const returnType = factory.createTypeReferenceNode(
        adtName,
        variant.declaration?.typeParameters?.map((tp) =>
          factory.createTypeReferenceNode(tp.name.text)
        )
      );

      const funcDecl = factory.createFunctionDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        undefined,
        variant.name,
        typeParams,
        params,
        returnType,
        factory.createBlock(
          [
            factory.createReturnStatement(
              factory.createObjectLiteralExpression(objectProps, false)
            ),
          ],
          true
        )
      );
      statements.push(funcDecl);
    }
  }

  return statements;
}

/**
 * Generate type guard functions for each variant.
 */
function generateTypeGuards(
  ctx: MacroContext,
  adtName: string,
  variants: VariantInfo[],
  needsTag: Set<string>,
  nullMap: NullRepresentationMap
): ts.Statement[] {
  const statements: ts.Statement[] = [];
  const factory = ctx.factory;

  for (const variant of variants) {
    // Skip literal null type
    if (variant.name === "null") continue;

    const guardName = `is${variant.name}`;
    const paramName = "value";

    // Get type parameters from the ADT declaration (we need to pass them through)
    const typeParams = variant.declaration?.typeParameters?.map((tp) =>
      factory.createTypeParameterDeclaration(undefined, tp.name.text, tp.constraint, tp.default)
    );

    // Parameter type is the ADT
    const paramType = factory.createTypeReferenceNode(
      adtName,
      variant.declaration?.typeParameters?.map((tp) =>
        factory.createTypeReferenceNode(tp.name.text)
      )
    );

    // Return type is "value is VariantName<...>"
    const narrowedType = factory.createTypeReferenceNode(
      variant.name,
      variant.declaration?.typeParameters?.map((tp) =>
        factory.createTypeReferenceNode(tp.name.text)
      )
    );
    const returnType = factory.createTypePredicateNode(undefined, paramName, narrowedType);

    // Generate the check expression
    let checkExpr: ts.Expression;

    if (nullMap.has(variant.name)) {
      // Null-represented: value === null
      checkExpr = factory.createBinaryExpression(
        factory.createIdentifier(paramName),
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        factory.createNull()
      );
    } else if (needsTag.has(variant.name)) {
      // Tag-based: value._tag === "VariantName"
      checkExpr = factory.createBinaryExpression(
        factory.createPropertyAccessExpression(factory.createIdentifier(paramName), "_tag"),
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        factory.createStringLiteral(variant.name)
      );
    } else {
      // Field-based: use presence of unique required field or property check
      // Find a unique required field that distinguishes this variant
      const uniqueField = findUniqueField(variant, variants);
      if (uniqueField) {
        // Check: "fieldName" in value
        checkExpr = factory.createBinaryExpression(
          factory.createStringLiteral(uniqueField),
          ts.SyntaxKind.InKeyword,
          factory.createIdentifier(paramName)
        );
      } else {
        // Fallback: check for any required field
        const firstField = [...variant.requiredFields][0];
        if (firstField) {
          checkExpr = factory.createBinaryExpression(
            factory.createStringLiteral(firstField),
            ts.SyntaxKind.InKeyword,
            factory.createIdentifier(paramName)
          );
        } else if (!needsTag.has(variant.name)) {
          // No unique fields but structurally distinguishable — check absence of
          // other variants' distinguishing fields
          const otherFields = variants
            .filter((v) => v.name !== variant.name && !v.isNull)
            .flatMap((v) => {
              const uf = findUniqueField(v, variants);
              return uf ? [uf] : [...v.requiredFields].slice(0, 1);
            })
            .filter(Boolean);

          if (otherFields.length > 0) {
            const checks = otherFields.map((f) =>
              factory.createPrefixUnaryExpression(
                ts.SyntaxKind.ExclamationToken,
                factory.createParenthesizedExpression(
                  factory.createBinaryExpression(
                    factory.createStringLiteral(f),
                    ts.SyntaxKind.InKeyword,
                    factory.createIdentifier(paramName)
                  )
                )
              )
            );
            checkExpr = checks[0];
            for (let i = 1; i < checks.length; i++) {
              checkExpr = factory.createBinaryExpression(
                checkExpr,
                ts.SyntaxKind.AmpersandAmpersandToken,
                checks[i]
              );
            }
          } else {
            // Truly empty ADT with no distinguishing fields — fall back to _tag
            checkExpr = factory.createBinaryExpression(
              factory.createPropertyAccessExpression(factory.createIdentifier(paramName), "_tag"),
              ts.SyntaxKind.EqualsEqualsEqualsToken,
              factory.createStringLiteral(variant.name)
            );
          }
        } else {
          // Needs _tag
          checkExpr = factory.createBinaryExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier(paramName), "_tag"),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            factory.createStringLiteral(variant.name)
          );
        }
      }
    }

    const funcDecl = factory.createFunctionDeclaration(
      [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      undefined,
      guardName,
      typeParams,
      [
        factory.createParameterDeclaration(
          undefined,
          undefined,
          paramName,
          undefined,
          paramType,
          undefined
        ),
      ],
      returnType,
      factory.createBlock([factory.createReturnStatement(checkExpr)], true)
    );
    statements.push(funcDecl);
  }

  // Generate isNil for null-represented empty variants
  for (const [variantName, value] of nullMap) {
    if (value === "null") {
      const guardName = `is${variantName}`;
      // Check if we already generated this guard
      const alreadyGenerated = statements.some(
        (s) => ts.isFunctionDeclaration(s) && s.name?.text === guardName
      );

      if (!alreadyGenerated) {
        const funcDecl = factory.createFunctionDeclaration(
          [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
          undefined,
          guardName,
          undefined,
          [
            factory.createParameterDeclaration(
              undefined,
              undefined,
              "value",
              undefined,
              factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
              undefined
            ),
          ],
          factory.createTypePredicateNode(
            undefined,
            "value",
            factory.createTypeReferenceNode(variantName)
          ),
          factory.createBlock(
            [
              factory.createReturnStatement(
                factory.createBinaryExpression(
                  factory.createIdentifier("value"),
                  ts.SyntaxKind.EqualsEqualsEqualsToken,
                  factory.createNull()
                )
              ),
            ],
            true
          )
        );
        statements.push(funcDecl);
      }
    }
  }

  return statements;
}

/**
 * Find a unique field that distinguishes this variant from all others.
 */
function findUniqueField(variant: VariantInfo, allVariants: VariantInfo[]): string | undefined {
  for (const field of variant.requiredFields) {
    const isUnique = allVariants.every((other) => {
      if (other.name === variant.name) return true;
      // Field is unique if other variants don't have it as required
      return !other.requiredFields.has(field);
    });
    if (isUnique) return field;
  }
  return undefined;
}

// ============================================================================
// Type Rewrite Registration
// ============================================================================

/**
 * Register type rewrites for method erasure.
 */
function registerAdtTypeRewrites(
  ctx: MacroContext,
  adtName: string,
  variants: VariantInfo[],
  needsTag: Set<string>,
  nullMap: NullRepresentationMap
): void {
  // Collect method names from variant interfaces
  const methods = new Map<string, string>();

  for (const variant of variants) {
    if (variant.declaration) {
      for (const member of variant.declaration.members) {
        if (ts.isMethodSignature(member) && member.name && ts.isIdentifier(member.name)) {
          const methodName = member.name.text;
          methods.set(methodName, methodName);
        }
      }
    }
  }

  // Build constructors map
  const constructors = new Map<string, ConstructorRewrite>();

  for (const variant of variants) {
    if (variant.name === "null") continue;

    if (nullMap.has(variant.name)) {
      constructors.set(variant.name, { kind: "constant", value: "null" });
    } else if (variant.requiredFields.size === 0 && !needsTag.has(variant.name)) {
      // No required fields and no tag - identity-ish
      constructors.set(variant.name, { kind: "identity" });
    } else {
      // Constructor creates object
      constructors.set(variant.name, { kind: "custom", value: variant.name });
    }
  }

  // Build underlying type text
  const underlyingParts: string[] = [];
  for (const variant of variants) {
    if (variant.isNull || nullMap.has(variant.name)) {
      underlyingParts.push("null");
    } else if (needsTag.has(variant.name)) {
      underlyingParts.push(`${variant.name} & { _tag: "${variant.name}" }`);
    } else {
      underlyingParts.push(variant.name);
    }
  }

  const entry: TypeRewriteEntry = {
    typeName: adtName,
    underlyingTypeText: underlyingParts.join(" | "),
    sourceModule: resolveSourceModule(ctx.sourceFile),
    methods: methods.size > 0 ? methods : undefined,
    constructors: constructors.size > 0 ? constructors : undefined,
    transparent: true,
  };

  registerTypeRewrite(entry);
}

// ============================================================================
// @adt — Attribute Macro
// ============================================================================

/**
 * The `@adt` attribute macro for declaring algebraic data types.
 *
 * Applied via JSDoc on a type alias declaration:
 * ```typescript
 * /** @adt *\/
 * type Either<E, A> = Left<E, A> | Right<E, A>;
 * ```
 *
 * The macro:
 * 1. Parses the union type to extract variant members
 * 2. Analyzes each variant's interface to collect field information
 * 3. Builds a distinguishability matrix for all variant pairs
 * 4. Injects `_tag` via intersection types where variants are indistinguishable
 * 5. Generates constructor functions with `_tag` where needed
 * 6. Generates type guard functions (isLeft, isRight, etc.)
 * 7. Registers type rewrites for method erasure
 */
export const adtAttribute: AttributeMacro = defineAttributeMacro({
  name: "adt",
  module: "typesugar",
  cacheable: false,
  description: "Declare an ADT (Algebraic Data Type) with auto-tag injection and type guards",
  validTargets: ["type"],

  expand(
    ctx: MacroContext,
    _decorator: ts.Decorator,
    target: ts.Declaration,
    _args: readonly ts.Expression[]
  ): ts.Node | ts.Node[] {
    if (!ts.isTypeAliasDeclaration(target)) {
      ctx.reportError(target, "@adt can only be applied to type alias declarations");
      return target;
    }

    // Must be a union type
    if (!ts.isUnionTypeNode(target.type)) {
      ctx.reportError(target, "@adt requires a union type. Use: type T = A | B | C");
      return target;
    }

    const adtName = target.name.text;
    const nullMap = extractAdtTag(target);

    // 1. Extract variant information
    const variants = extractVariants(ctx, target.type, nullMap);
    if (variants.length < 2) {
      ctx.reportError(target, `@adt requires at least 2 variants, found ${variants.length}`);
      return target;
    }

    // 2. Build distinguishability matrix and find variants needing _tag
    const needsTag = findVariantsNeedingTag(variants);

    // 3. Generate transformed type alias
    const transformedTypeAlias = generateTransformedTypeAlias(ctx, target, variants, needsTag);

    // 4. Generate constructors
    const constructors = generateConstructors(ctx, adtName, variants, needsTag, nullMap);

    // 5. Generate type guards
    const typeGuards = generateTypeGuards(ctx, adtName, variants, needsTag, nullMap);

    // 6. Register type rewrites
    registerAdtTypeRewrites(ctx, adtName, variants, needsTag, nullMap);

    // Return transformed type alias + generated functions
    return [transformedTypeAlias, ...constructors, ...typeGuards];
  },
});

// ============================================================================
// Registration
// ============================================================================

globalRegistry.register(adtAttribute);
