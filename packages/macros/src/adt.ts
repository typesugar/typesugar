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
 * @see PEP-011 — SFINAE Diagnostic Resolution (the mechanism it describes is
 *      renamed to "diagnostic suppression rules" by PEP-054; PEP-011 keeps
 *      its historical title)
 * @see PEP-012 — Type Macros
 */

import ts from "typescript";
import type { MacroContext, AttributeMacro } from "@typesugar/core";
import { cloneNodeDeep, defineAttributeMacro, globalRegistry } from "@typesugar/core";
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
  /**
   * Optional fields whose declared type is exactly `undefined`
   * (`readonly right?: undefined`) — a defined value there rules the variant out.
   */
  optionalUndefinedFields: Set<string>;
  /** Whether this variant is null-represented */
  isNull: boolean;
  /** Type arguments as written in the union member (`Some<A>` → [A]) */
  typeArgs: readonly ts.TypeNode[];
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
    const optionalUndefinedFields = new Set<string>();

    if (declaration) {
      for (const memberDecl of declaration.members) {
        if (ts.isPropertySignature(memberDecl) && memberDecl.name) {
          const fieldName = ts.isIdentifier(memberDecl.name) ? memberDecl.name.text : undefined;
          if (fieldName) {
            allFields.add(fieldName);
            if (memberDecl.questionToken) {
              optionalFields.add(fieldName);
              if (memberDecl.type?.kind === ts.SyntaxKind.UndefinedKeyword) {
                optionalUndefinedFields.add(fieldName);
              }
            } else {
              requiredFields.add(fieldName);
            }
          }
        }
      }
    }

    return {
      name,
      declaration,
      requiredFields,
      optionalFields,
      allFields,
      optionalUndefinedFields,
      isNull,
      typeArgs: member.typeArguments ?? [],
    };
  }

  // Handle literal null type (only `null` — other literals are rejected in expand)
  if (isNullTypeMember(member)) {
    return {
      name: "null",
      requiredFields: new Set(),
      optionalFields: new Set(),
      allFields: new Set(),
      optionalUndefinedFields: new Set(),
      isNull: true,
      typeArgs: [],
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

/** `null` as a union member (a bare keyword or a `null` literal type). */
function isNullTypeMember(member: ts.TypeNode): boolean {
  return (
    member.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword)
  );
}

/**
 * A runtime test on one field that separates two non-null variants.
 *
 * - `presence`: the field is required on the owner and absent from the other
 *   variant's declaration → `"f" in value`.
 * - `defined`: the field is required on the owner and declared
 *   `f?: undefined` on the other → `"f" in value && value.f !== undefined`.
 *
 * A field that is merely optional on the other variant (with a real type)
 * does NOT separate them: a value of the other variant may carry it
 * (deep review #11 — `label` on `Circle | Labeled`).
 */
interface FieldTest {
  field: string;
  test: "presence" | "defined";
}

function separatingField(owner: VariantInfo, other: VariantInfo): FieldTest | undefined {
  for (const field of owner.requiredFields) {
    if (!other.allFields.has(field)) return { field, test: "presence" };
  }
  for (const field of owner.requiredFields) {
    if (other.optionalUndefinedFields.has(field)) return { field, test: "defined" };
  }
  return undefined;
}

/**
 * How to tell `v` apart from `other` at runtime: a field test that holds for
 * `v` (positive) or one that holds for `other` (negated).
 */
function separation(
  v: VariantInfo,
  other: VariantInfo
): { test: FieldTest; negate: boolean } | undefined {
  const own = separatingField(v, other);
  if (own) return { test: own, negate: false };
  const theirs = separatingField(other, v);
  if (theirs) return { test: theirs, negate: true };
  return undefined;
}

/**
 * Check if two variants are distinguishable by structure alone.
 */
function checkDistinguishability(a: VariantInfo, b: VariantInfo): Distinguishability {
  // Rule 1: Null vs non-null
  if (a.isNull !== b.isNull) {
    return { kind: "null-vs-nonnull" };
  }
  if (a.isNull && b.isNull) return { kind: "indistinguishable" };
  const sep = separation(a, b);
  if (sep) {
    return {
      kind: "unique-required-field",
      field: sep.test.field,
      owner: sep.negate ? b.name : a.name,
    };
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

/** `Variant<args as written in the union>` (fresh nodes each call). */
function variantTypeRef(factory: ts.NodeFactory, variant: VariantInfo): ts.TypeReferenceNode {
  return factory.createTypeReferenceNode(
    variant.name,
    variant.typeArgs.length > 0 ? variant.typeArgs.map((a) => cloneNodeDeep(a)) : undefined
  );
}

/** The ADT's own type parameters, cloned for a generated declaration. */
function adtTypeParams(
  factory: ts.NodeFactory,
  target: ts.TypeAliasDeclaration
): ts.TypeParameterDeclaration[] | undefined {
  return target.typeParameters?.map((tp) =>
    factory.createTypeParameterDeclaration(
      undefined,
      tp.name.text,
      tp.constraint ? cloneNodeDeep(tp.constraint) : undefined,
      tp.default ? cloneNodeDeep(tp.default) : undefined
    )
  );
}

/** `Adt<A, B, ...>` applied to its own type parameters. */
function adtTypeRef(
  factory: ts.NodeFactory,
  target: ts.TypeAliasDeclaration
): ts.TypeReferenceNode {
  return factory.createTypeReferenceNode(
    target.name.text,
    target.typeParameters?.map((tp) => factory.createTypeReferenceNode(tp.name.text))
  );
}

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

  const newUnionMembers: ts.TypeNode[] = [];

  for (const variant of variants) {
    if (variant.isNull && variant.name === "null") {
      newUnionMembers.push(factory.createLiteralTypeNode(factory.createNull()));
    } else if (needsTag.has(variant.name)) {
      const tagType = factory.createTypeLiteralNode([
        factory.createPropertySignature(
          [factory.createModifier(ts.SyntaxKind.ReadonlyKeyword)],
          "_tag",
          undefined,
          factory.createLiteralTypeNode(factory.createStringLiteral(variant.name))
        ),
      ]);
      newUnionMembers.push(
        factory.createIntersectionTypeNode([variantTypeRef(factory, variant), tagType])
      );
    } else {
      newUnionMembers.push(variantTypeRef(factory, variant));
    }
  }

  return factory.updateTypeAliasDeclaration(
    target,
    target.modifiers,
    target.name,
    target.typeParameters,
    factory.createUnionTypeNode(newUnionMembers)
  );
}

/**
 * Generate constructor functions for each variant.
 *
 * Constructors are generic over the ADT's OWN type parameters and return
 * `Adt<...>` — using the variant interface's parameters produced `function
 * None(): Option` (TS2314) whenever the variant didn't mention them (deep
 * review #15). Each field parameter is typed `Variant<args>["field"]`.
 */
function generateConstructors(
  ctx: MacroContext,
  target: ts.TypeAliasDeclaration,
  variants: VariantInfo[],
  needsTag: Set<string>,
  nullMap: NullRepresentationMap
): ts.Statement[] {
  const statements: ts.Statement[] = [];
  const factory = ctx.factory;

  for (const variant of variants) {
    if (variant.name === "null") continue;

    if (nullMap.has(variant.name)) {
      // export const Nil: Nil = null;
      statements.push(
        factory.createVariableStatement(
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
        )
      );
      continue;
    }

    const params: ts.ParameterDeclaration[] = [];
    const objectProps: ts.ObjectLiteralElementLike[] = [];

    if (needsTag.has(variant.name)) {
      objectProps.push(
        factory.createPropertyAssignment("_tag", factory.createStringLiteral(variant.name))
      );
    }

    for (const field of variant.requiredFields) {
      params.push(
        factory.createParameterDeclaration(
          undefined,
          undefined,
          field,
          undefined,
          factory.createIndexedAccessTypeNode(
            variantTypeRef(factory, variant),
            factory.createLiteralTypeNode(factory.createStringLiteral(field))
          ),
          undefined
        )
      );
      objectProps.push(factory.createShorthandPropertyAssignment(field));
    }

    statements.push(
      factory.createFunctionDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        undefined,
        variant.name,
        adtTypeParams(factory, target),
        params,
        adtTypeRef(factory, target),
        factory.createBlock(
          [
            factory.createReturnStatement(
              factory.createObjectLiteralExpression(objectProps, false)
            ),
          ],
          true
        )
      )
    );
  }

  return statements;
}

/** `"f" in value` or `("f" in value && value.f !== undefined)`. */
function fieldTestExpr(factory: ts.NodeFactory, paramName: string, t: FieldTest): ts.Expression {
  const inCheck = factory.createBinaryExpression(
    factory.createStringLiteral(t.field),
    ts.SyntaxKind.InKeyword,
    factory.createIdentifier(paramName)
  );
  if (t.test === "presence") return inCheck;
  return factory.createParenthesizedExpression(
    factory.createLogicalAnd(
      inCheck,
      factory.createStrictInequality(
        factory.createPropertyAccessExpression(factory.createIdentifier(paramName), t.field),
        factory.createIdentifier("undefined")
      )
    )
  );
}

function andAll(factory: ts.NodeFactory, exprs: ts.Expression[]): ts.Expression {
  return exprs.reduce((acc, e) => factory.createLogicalAnd(acc, e));
}

/**
 * Generate type guard functions for each variant.
 *
 * A guard for non-null variant V is `value !== null` (when the ADT has a
 * null-represented variant — `"f" in null` throws, deep review #11) AND
 * either its `_tag` check, or, for every other non-null variant O, a field
 * test separating V from O. The conjunction is true for every V value and,
 * for each O, false on the conjunct that separates it.
 */
function generateTypeGuards(
  ctx: MacroContext,
  target: ts.TypeAliasDeclaration,
  variants: VariantInfo[],
  needsTag: Set<string>,
  nullMap: NullRepresentationMap
): ts.Statement[] {
  const statements: ts.Statement[] = [];
  const factory = ctx.factory;
  const paramName = "value";
  const value = () => factory.createIdentifier(paramName);
  const hasNullVariant = variants.some((v) => v.isNull);

  for (const variant of variants) {
    if (variant.name === "null") continue;

    let checkExpr: ts.Expression;

    if (nullMap.has(variant.name)) {
      checkExpr = factory.createStrictEquality(value(), factory.createNull());
    } else {
      const conjuncts: ts.Expression[] = [];
      if (hasNullVariant) {
        conjuncts.push(factory.createStrictInequality(value(), factory.createNull()));
      }
      if (needsTag.has(variant.name)) {
        conjuncts.push(
          factory.createParenthesizedExpression(
            factory.createLogicalAnd(
              factory.createBinaryExpression(
                factory.createStringLiteral("_tag"),
                ts.SyntaxKind.InKeyword,
                value()
              ),
              factory.createStrictEquality(
                factory.createPropertyAccessExpression(value(), "_tag"),
                factory.createStringLiteral(variant.name)
              )
            )
          )
        );
      } else {
        for (const other of variants) {
          if (other === variant || other.isNull) continue;
          const sep = separation(variant, other);
          // Untagged variants are, by construction, separable from every
          // other non-null variant (findVariantsNeedingTag uses the same test).
          if (!sep) continue;
          const t = fieldTestExpr(factory, paramName, sep.test);
          conjuncts.push(
            sep.negate
              ? factory.createLogicalNot(
                  ts.isParenthesizedExpression(t) ? t : factory.createParenthesizedExpression(t)
                )
              : t
          );
        }
      }
      checkExpr = conjuncts.length > 0 ? andAll(factory, conjuncts) : factory.createTrue();
    }

    statements.push(
      factory.createFunctionDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        undefined,
        `is${variant.name}`,
        adtTypeParams(factory, target),
        [
          factory.createParameterDeclaration(
            undefined,
            undefined,
            paramName,
            undefined,
            adtTypeRef(factory, target),
            undefined
          ),
        ],
        factory.createTypePredicateNode(undefined, paramName, variantTypeRef(factory, variant)),
        factory.createBlock([factory.createReturnStatement(checkExpr)], true)
      )
    );
  }

  // isNil for null-represented variants that aren't union members by name
  for (const [variantName] of nullMap) {
    const guardName = `is${variantName}`;
    const alreadyGenerated = statements.some(
      (s) => ts.isFunctionDeclaration(s) && s.name?.text === guardName
    );
    if (alreadyGenerated) continue;
    statements.push(
      factory.createFunctionDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        undefined,
        guardName,
        undefined,
        [
          factory.createParameterDeclaration(
            undefined,
            undefined,
            paramName,
            undefined,
            factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
            undefined
          ),
        ],
        factory.createTypePredicateNode(
          undefined,
          paramName,
          factory.createTypeReferenceNode(variantName)
        ),
        factory.createBlock(
          [
            factory.createReturnStatement(
              factory.createStrictEquality(value(), factory.createNull())
            ),
          ],
          true
        )
      )
    );
  }

  return statements;
}

// ============================================================================
// Type Rewrite Registration
// ============================================================================

/**
 * Register type rewrites for method erasure.
 *
 * Only null-represented variants are registered as erasable constructors
 * (`Nil` → `null`). Every other variant has a REAL generated constructor
 * function; registering it (formerly `{ kind: "custom", value: name }` /
 * `identity`) made the erasure pass replace `Circle(5)` with `Circle` in
 * importing files (deep review #3). `declarationFile` lets the rewriter match
 * references by resolved symbol, not bare name.
 */
function registerAdtTypeRewrites(
  ctx: MacroContext,
  adtName: string,
  variants: VariantInfo[],
  needsTag: Set<string>,
  nullMap: NullRepresentationMap
): void {
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

  const constructors = new Map<string, ConstructorRewrite>();
  for (const variant of variants) {
    if (variant.name === "null") continue;
    if (nullMap.has(variant.name)) {
      constructors.set(variant.name, { kind: "constant", value: "null" });
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
    declarationFile: ctx.sourceFile.fileName,
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
    for (const [variantName, repr] of nullMap) {
      if (repr !== "null") {
        ctx.reportError(
          target,
          `@adt: variant '${variantName}' is configured as '${repr}', but only null representation ({ ${variantName}: null }) is supported`
        );
        return target;
      }
    }

    // Each union member must be a NAMED type reference (or a literal `null`) —
    // constructor/type-guard generation below emits references to the
    // variant BY NAME (`factory.createTypeReferenceNode(variant.name, ...)`,
    // `variant.declaration.typeParameters`, etc.), which requires a real,
    // resolvable interface/type-alias declaration to exist. An inline
    // object-literal member (`{ kind: "circle"; radius: number }`) has no
    // such name, so it's rejected here with a diagnostic that says exactly
    // that — rather than falling through to extractVariants silently
    // dropping it and reporting a misleading "found 0 variants" (which reads
    // as if the union itself were too small, not that its member SHAPE is
    // unsupported).
    for (const member of target.type.types) {
      if (ts.isLiteralTypeNode(member) && !isNullTypeMember(member)) {
        // Only `null` has a runtime representation the generated guards and
        // constructors understand; `"missing"` used to be silently turned
        // into `null` (deep review #15).
        ctx.reportError(
          member,
          `@adt: literal member "${ts.isStringLiteral(member.literal) ? member.literal.text : member.getText()}" is not supported — ` +
            `only \`null\` may appear as a literal variant. Use a named interface for this variant.`
        );
        return target;
      }
      if (!ts.isTypeReferenceNode(member) && !isNullTypeMember(member)) {
        ctx.reportError(
          member,
          `@adt requires each variant to be a named interface or type alias reference ` +
            `(e.g. "Circle | Square", not an inline object literal). Extract ` +
            `"${member.getText()}" into its own named interface first.`
        );
        return target;
      }
    }

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
    const constructors = generateConstructors(ctx, target, variants, needsTag, nullMap);

    // 5. Generate type guards
    const typeGuards = generateTypeGuards(ctx, target, variants, needsTag, nullMap);

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
