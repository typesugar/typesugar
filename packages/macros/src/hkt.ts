/**
 * Higher-Kinded Type (HKT) Utilities
 *
 * HKT is a feature of the typeclass system that enables typeclasses to be
 * parameterized by type constructors (F[_]) rather than concrete types.
 *
 * ## Relationship to Typeclasses
 *
 * HKT exists to support typeclasses like Functor, Monad, and Traverse that
 * abstract over container types. Without HKT, you couldn't write:
 *
 * ```typescript
 * interface Functor<F> {
 *   map: <A, B>(fa: $<F, A>, f: (a: A) => B) => $<F, B>;
 * }
 * ```
 *
 * HKT is NOT a standalone feature - it's infrastructure for the typeclass
 * system. Use `@instance` from the typeclass module to define HKT instances:
 *
 * ```typescript
 * // Scala-like syntax for HKT typeclass instances
 * @instance("Monad<Option>")
 * const optionMonad = {
 *   pure: (a) => a,
 *   flatMap: (fa, f) => fa !== null ? f(fa) : null,
 *   map: (fa, f) => fa !== null ? f(fa) : null,
 *   ap: (fab, fa) => fab !== null && fa !== null ? fab(fa) : null,
 * };
 *
 * // Or with two identifiers:
 * @instance(Monad, Option)
 * const optionMonad = { ... };
 * ```
 *
 * ## The TypeScript Challenge
 *
 * TypeScript doesn't natively support HKT, so we use an encoding:
 * - `$<F, A>` expands to the concrete type via indexed access
 * - This encoding triggers "Type instantiation is excessively deep" errors
 *
 * The `@instance` macro handles this by auto-generating concrete expanded
 * types at compile time, avoiding the recursion limit.
 *
 * ## Type-Level Utilities
 *
 * This module provides utilities for working with HKT at the type level:
 * - `isKindAnnotation()` - Detect F<_> syntax in type parameters
 * - `transformHKTDeclaration()` - Transform F<A> to $<F, A> in declarations
 *
 * These are primarily used by the transformer, not directly by users.
 */

import * as ts from "typescript";
import { defineAttributeMacro } from "@typesugar/core";
import type { MacroContext } from "@typesugar/core";

// Import HKT registries from typeclass.ts (single source of truth)
// Re-export for backward compatibility
export {
  hktTypeclassNames,
  hktExpansionRegistry,
  registerHKTExpansion,
  registerHKTTypeclass,
} from "./typeclass.js";

// ============================================================================
// HKT Registry
// ============================================================================

/**
 * Information about a type parameter that has kind annotation
 */
export interface KindParamInfo {
  /** The type parameter name (e.g., "F") */
  name: string;
  /** The arity (number of type arguments it accepts) */
  arity: number;
  /** The source interface/type alias name */
  sourceType: string;
}

/**
 * Registry of type parameters with kind annotations.
 * Maps "SourceType.ParamName" to its kind info.
 */
export const kindParamRegistry = new Map<string, KindParamInfo>();

// ============================================================================
// Detection Utilities
// ============================================================================

/**
 * Check if a type parameter declaration has a kind annotation (F<_>)
 *
 * In the AST, `F<_>` appears as a type parameter with a constraint or
 * default that uses the `_` identifier.
 *
 * Actually, TypeScript parses `F<_>` as an error, so we need to detect
 * it differently. The syntax `interface Foo<F<_>>` is parsed with `F`
 * as the type param and `<_>` as... nothing valid.
 *
 * We need to handle this at the source text level or use a marker.
 */
export function isKindAnnotation(param: ts.TypeParameterDeclaration): boolean {
  // Check if the type parameter's text contains <_>
  const sourceText = param.getSourceFile().text;
  const start = param.getStart();
  const end = param.getEnd();
  const text = sourceText.slice(start, end);

  // Look for patterns like "F<_>" or "F<_, _>"
  return /<_(?:\s*,\s*_)*>/.test(text);
}

/**
 * Extract kind arity from a kind annotation
 */
export function getKindArity(param: ts.TypeParameterDeclaration): number {
  const sourceText = param.getSourceFile().text;
  const start = param.getStart();
  const end = param.getEnd();
  const text = sourceText.slice(start, end);

  const match = text.match(/<(_(?:\s*,\s*_)*)>/);
  if (!match) return 0;

  // Count underscores
  return (match[1].match(/_/g) || []).length;
}

/**
 * Get the base name of a kind parameter (F from F<_>)
 */
export function getKindParamName(param: ts.TypeParameterDeclaration): string {
  return param.name.text;
}

/**
 * Check if a type reference is a kind application (F<A> where F is a kind param)
 */
export function isKindApplication(node: ts.TypeReferenceNode, kindParams: Set<string>): boolean {
  if (!ts.isIdentifier(node.typeName)) return false;
  const name = node.typeName.text;
  return kindParams.has(name) && !!node.typeArguments;
}

// ============================================================================
// Transformation
// ============================================================================

/**
 * Transform HKT syntax in a type/interface declaration.
 *
 * 1. Replace `F<_>` type parameters with plain `F`
 * 2. Replace `F<A>` type applications with `$<F, A>`
 */
export function transformHKTDeclaration(
  ctx: MacroContext,
  node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
  const factory = ctx.factory;
  const typeParams = node.typeParameters;

  if (!typeParams) return node;

  // Find kind parameters (those with <_> annotation)
  const kindParams = new Map<string, number>(); // name -> arity
  const newTypeParams: ts.TypeParameterDeclaration[] = [];

  for (const param of typeParams) {
    if (isKindAnnotation(param)) {
      const name = getKindParamName(param);
      const arity = getKindArity(param);
      kindParams.set(name, arity);

      // Create a plain type parameter without the <_>
      newTypeParams.push(
        factory.createTypeParameterDeclaration(
          param.modifiers,
          param.name,
          param.constraint,
          param.default
        )
      );

      // Register in the kind registry
      const typeName = node.name?.text ?? "Anonymous";
      kindParamRegistry.set(`${typeName}.${name}`, {
        name,
        arity,
        sourceType: typeName,
      });
    } else {
      newTypeParams.push(param);
    }
  }

  if (kindParams.size === 0) return node;

  // Transform F<A> to $<F, A> throughout the declaration
  const kindParamNames = new Set(kindParams.keys());

  if (ts.isInterfaceDeclaration(node)) {
    const transformedMembers = node.members.map((member) =>
      transformMemberHKT(ctx, member, kindParamNames)
    );

    return factory.updateInterfaceDeclaration(
      node,
      node.modifiers,
      node.name,
      newTypeParams,
      node.heritageClauses,
      transformedMembers
    );
  } else {
    const transformedType = transformTypeHKT(ctx, node.type, kindParamNames);

    return factory.updateTypeAliasDeclaration(
      node,
      node.modifiers,
      node.name,
      newTypeParams,
      transformedType
    );
  }
}

/**
 * Transform a type signature member, replacing F<A> with $<F, A>
 */
function transformMemberHKT(
  ctx: MacroContext,
  member: ts.TypeElement,
  kindParams: Set<string>
): ts.TypeElement {
  const factory = ctx.factory;

  if (ts.isPropertySignature(member) && member.type) {
    return factory.updatePropertySignature(
      member,
      member.modifiers,
      member.name,
      member.questionToken,
      transformTypeHKT(ctx, member.type, kindParams)
    );
  }

  if (ts.isMethodSignature(member)) {
    const newParams = member.parameters.map((param) => {
      if (param.type) {
        return factory.updateParameterDeclaration(
          param,
          param.modifiers,
          param.dotDotDotToken,
          param.name,
          param.questionToken,
          transformTypeHKT(ctx, param.type, kindParams),
          param.initializer
        );
      }
      return param;
    });

    return factory.updateMethodSignature(
      member,
      member.modifiers,
      member.name,
      member.questionToken,
      member.typeParameters,
      factory.createNodeArray(newParams),
      member.type ? transformTypeHKT(ctx, member.type, kindParams) : undefined
    );
  }

  return member;
}

/**
 * Transform a type node, replacing F<A> with $<F, A>
 */
function transformTypeHKT(
  ctx: MacroContext,
  type: ts.TypeNode,
  kindParams: Set<string>
): ts.TypeNode {
  const factory = ctx.factory;

  // F<A> -> $<F, A>
  if (ts.isTypeReferenceNode(type) && isKindApplication(type, kindParams)) {
    const fName = (type.typeName as ts.Identifier).text;
    const typeArgs = type.typeArguments!;

    // Build $<F, A> or $<F, $<F, A>> for nested applications
    return factory.createTypeReferenceNode("$", [
      factory.createTypeReferenceNode(fName),
      ...typeArgs.map((arg) => transformTypeHKT(ctx, arg, kindParams)),
    ]);
  }

  // Recursively transform other type nodes
  if (ts.isTypeReferenceNode(type)) {
    if (type.typeArguments) {
      return factory.updateTypeReferenceNode(
        type,
        type.typeName,
        factory.createNodeArray(
          type.typeArguments.map((arg) => transformTypeHKT(ctx, arg, kindParams))
        )
      );
    }
    return type;
  }

  if (ts.isFunctionTypeNode(type)) {
    const newParams = type.parameters.map((param) => {
      if (param.type) {
        return factory.updateParameterDeclaration(
          param,
          param.modifiers,
          param.dotDotDotToken,
          param.name,
          param.questionToken,
          transformTypeHKT(ctx, param.type, kindParams),
          param.initializer
        );
      }
      return param;
    });

    return factory.updateFunctionTypeNode(
      type,
      type.typeParameters,
      factory.createNodeArray(newParams),
      type.type ? transformTypeHKT(ctx, type.type, kindParams) : type.type
    );
  }

  if (ts.isUnionTypeNode(type)) {
    return factory.updateUnionTypeNode(
      type,
      factory.createNodeArray(type.types.map((t) => transformTypeHKT(ctx, t, kindParams)))
    );
  }

  if (ts.isIntersectionTypeNode(type)) {
    return factory.updateIntersectionTypeNode(
      type,
      factory.createNodeArray(type.types.map((t) => transformTypeHKT(ctx, t, kindParams)))
    );
  }

  if (ts.isArrayTypeNode(type)) {
    return factory.updateArrayTypeNode(type, transformTypeHKT(ctx, type.elementType, kindParams));
  }

  if (ts.isTupleTypeNode(type)) {
    return factory.updateTupleTypeNode(
      type,
      factory.createNodeArray(
        type.elements.map((el) => {
          if (ts.isNamedTupleMember(el)) {
            return factory.updateNamedTupleMember(
              el,
              el.dotDotDotToken,
              el.name,
              el.questionToken,
              transformTypeHKT(ctx, el.type, kindParams)
            );
          }
          return transformTypeHKT(ctx, el, kindParams);
        })
      )
    );
  }

  if (ts.isParenthesizedTypeNode(type)) {
    return factory.updateParenthesizedType(type, transformTypeHKT(ctx, type.type, kindParams));
  }

  if (ts.isTypeLiteralNode(type)) {
    return factory.updateTypeLiteralNode(
      type,
      factory.createNodeArray(type.members.map((m) => transformMemberHKT(ctx, m, kindParams)))
    );
  }

  return type;
}

// ============================================================================
// Macro Registration
// ============================================================================

/**
 * @hkt attribute macro for interfaces/type aliases
 *
 * Enables the F<_> kind syntax in the decorated declaration.
 * This is optional - the transformer also auto-detects F<_> syntax.
 */
export const hktAttribute = defineAttributeMacro({
  name: "hkt",
  description: "Enable HKT syntax (F<_> kind annotations) in an interface or type alias",
  validTargets: ["interface", "typeAlias"],
  expand(ctx, decorator, node) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      return transformHKTDeclaration(ctx, node);
    }
    ctx.reportError(decorator, "@hkt can only be applied to interfaces or type aliases");
    return node;
  },
});
