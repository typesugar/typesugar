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
 *   map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B>;
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
 * - `Kind<F, A>` is a phantom kind marker; the preprocessor resolves known type functions
 * - This encoding triggers "Type instantiation is excessively deep" errors
 *
 * The `@instance` macro handles this by auto-generating concrete expanded
 * types at compile time, avoiding the recursion limit.
 *
 * ## Type-Level Utilities
 *
 * This module provides utilities for working with HKT at the type level:
 * - `isKindAnnotation()` - Detect F<_> syntax in type parameters
 * - `transformHKTDeclaration()` - Transform F<A> to Kind<F, A> in declarations
 *
 * These are primarily used by the transformer, not directly by users.
 */

import * as ts from "typescript";
import { defineAttributeMacro, globalRegistry } from "@typesugar/core";
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
// Type Constructor Resolution via TypeChecker (Tier 1 Implicit Resolution)
// ============================================================================

/**
 * Result of resolving a type constructor string like "Option" or "Either<string>".
 */
export interface TypeConstructorResolution {
  /** Base type name (e.g., "Either" for "Either<string>") */
  baseType: string;
  /** Fixed type arguments from partial application (e.g., ["string"] for "Either<string>") */
  fixedArgs: string[];
  /** Total arity of the base type (number of type parameters) */
  arity: number;
  /** Name of the hole type parameter (the one that varies, typically the last) */
  holeName: string;
}

/**
 * Parse a type constructor string into its base type and any fixed arguments.
 *
 * "Option"          → { base: "Option", fixedArgs: [] }
 * "Either<string>"  → { base: "Either", fixedArgs: ["string"] }
 * "Map<string>"     → { base: "Map", fixedArgs: ["string"] }
 */
export function parseTypeConstructor(
  typeStr: string
): { base: string; fixedArgs: string[] } {
  const openBracket = typeStr.indexOf("<");
  if (openBracket === -1) {
    return { base: typeStr.trim(), fixedArgs: [] };
  }

  const base = typeStr.slice(0, openBracket).trim();

  // Find matching closing bracket with depth tracking
  let depth = 0;
  let closeBracket = -1;
  for (let i = openBracket; i < typeStr.length; i++) {
    if (typeStr[i] === "<") depth++;
    else if (typeStr[i] === ">") {
      depth--;
      if (depth === 0) {
        closeBracket = i;
        break;
      }
    }
  }

  if (closeBracket === -1) {
    return { base, fixedArgs: [] };
  }

  // Split args respecting nested brackets
  const argsStr = typeStr.slice(openBracket + 1, closeBracket);
  const fixedArgs: string[] = [];
  let currentArg = "";
  let argDepth = 0;

  for (const ch of argsStr) {
    if (ch === "<") argDepth++;
    else if (ch === ">") argDepth--;

    if (ch === "," && argDepth === 0) {
      fixedArgs.push(currentArg.trim());
      currentArg = "";
    } else {
      currentArg += ch;
    }
  }
  if (currentArg.trim()) {
    fixedArgs.push(currentArg.trim());
  }

  return { base, fixedArgs };
}

/**
 * Resolve a type constructor string via the TypeScript TypeChecker.
 *
 * Given a string like "Option" or "Either<string>", determines:
 * - Whether the base type is a valid generic type
 * - How many type parameters it has
 * - Which type parameter is the "hole" (the one HKT varies over)
 * - What arguments are "fixed" by partial application
 *
 * For partial application (e.g., "Either<string>"):
 * - Either has params [E, A], arity=2
 * - "Either<string>" fixes E=string, hole=A
 * - fixedArgs=["string"], holeName="A"
 *
 * Returns undefined if the type can't be resolved or isn't generic.
 */
export function resolveTypeConstructorViaTypeChecker(
  ctx: MacroContext,
  typeNameStr: string
): TypeConstructorResolution | undefined {
  const checker = ctx.typeChecker;
  if (!checker) return undefined;

  const { base, fixedArgs } = parseTypeConstructor(typeNameStr);

  // Find the symbol for the base type in the current source file's scope
  const sourceFile = ctx.sourceFile;
  let symbol: ts.Symbol | undefined;

  // Try to resolve via a temporary type reference parse
  try {
    const tempSource = `type __Probe = ${base}<${Array(10).fill("unknown").join(",")}>;`;
    const tempFile = ts.createSourceFile("__probe.ts", tempSource, ts.ScriptTarget.Latest, true);
    // This approach is fragile; instead, walk the source file's symbols
  } catch {
    // Fall through to symbol-based approach
  }

  // Look up the type name in the current program's type checker
  // Walk the source file to find a matching type declaration
  const program = ctx.program;
  if (!program) return undefined;

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf === sourceFile) {
      ts.forEachChild(sf, (node) => {
        if (symbol) return; // already found
        if (
          (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
           ts.isClassDeclaration(node)) &&
          node.name?.text === base
        ) {
          symbol = checker.getSymbolAtLocation(node.name);
        }
      });
    }
    if (symbol) break;
  }

  // Also try resolving from the checker's global scope for built-in types
  if (!symbol) {
    // For built-in types like Array, Map, Set, Promise
    try {
      const tempCode = `declare const __x: ${base}<any>;`;
      const tempSf = ts.createSourceFile("__resolve.ts", tempCode, ts.ScriptTarget.Latest, true);
      for (const stmt of tempSf.statements) {
        if (ts.isVariableStatement(stmt)) {
          const decl = stmt.declarationList.declarations[0];
          if (decl?.type && ts.isTypeReferenceNode(decl.type)) {
            // Try to resolve via the real checker using the original source file
            // Built-in types like Array are globally available
            symbol = checker.resolveName(base, sourceFile, ts.SymbolFlags.Type, false);
          }
        }
      }
    } catch {
      // Fall through
    }
  }

  if (!symbol) return undefined;

  // Get the type and its declarations to find type parameters
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) return undefined;

  let typeParams: readonly ts.TypeParameterDeclaration[] | undefined;
  for (const decl of declarations) {
    if (
      ts.isInterfaceDeclaration(decl) ||
      ts.isTypeAliasDeclaration(decl) ||
      ts.isClassDeclaration(decl)
    ) {
      if (decl.typeParameters && decl.typeParameters.length > 0) {
        typeParams = decl.typeParameters;
        break;
      }
    }
  }

  if (!typeParams || typeParams.length === 0) {
    return undefined; // Not a generic type
  }

  const arity = typeParams.length;

  // Determine the hole: last unfixed parameter
  // For "Either<string>" with params [E, A]: fixedArgs fixes E, hole is A
  // For "Option" with params [A]: no fixed args, hole is A
  const numFixed = fixedArgs.length;
  if (numFixed >= arity) {
    return undefined; // All params are fixed, no hole left for HKT
  }

  const holeIndex = arity - 1; // Convention: hole is always the last param
  const holeName = typeParams[holeIndex].name.text;

  return {
    baseType: base,
    fixedArgs,
    arity,
    holeName,
  };
}

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
 * 2. Replace `F<A>` type applications with `Kind<F, A>`
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

  // Transform F<A> to Kind<F, A> throughout the declaration
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
 * Transform a type signature member, replacing F<A> with Kind<F, A>
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
 * Transform a type node, replacing F<A> with Kind<F, A>
 */
function transformTypeHKT(
  ctx: MacroContext,
  type: ts.TypeNode,
  kindParams: Set<string>
): ts.TypeNode {
  const factory = ctx.factory;

  // F<A> -> Kind<F, A>
  if (ts.isTypeReferenceNode(type) && isKindApplication(type, kindParams)) {
    const fName = (type.typeName as ts.Identifier).text;
    const typeArgs = type.typeArguments!;

    // Build Kind<F, A> or Kind<F, Kind<F, A>> for nested applications
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
// Tier 3: _ Marker Detection for @hkt on Type Aliases
// ============================================================================

/**
 * Check if a type node is the `_` marker type.
 *
 * Detection strategy:
 * 1. Symbol resolution: resolve the type reference and check if its declaration
 *    is the `type _ = never & "__kind__"` from @typesugar/type-system
 * 2. Structural fallback: match `never & "__kind__"` intersection pattern
 */
function isUnderscoreMarker(node: ts.TypeNode, checker: ts.TypeChecker | undefined): boolean {
  if (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === "_"
  ) {
    if (checker) {
      const symbol = checker.getSymbolAtLocation(node.typeName);
      if (symbol) {
        const decl = symbol.declarations?.[0];
        if (decl && ts.isTypeAliasDeclaration(decl)) {
          const typeNode = decl.type;
          return isNeverAndKindIntersection(typeNode);
        }
      }
    }
    return true;
  }
  return false;
}

/**
 * Structural check: is this `never & "__kind__"`?
 */
function isNeverAndKindIntersection(node: ts.TypeNode): boolean {
  if (!ts.isIntersectionTypeNode(node)) return false;
  let hasNever = false;
  let hasKindLiteral = false;
  for (const member of node.types) {
    if (member.kind === ts.SyntaxKind.NeverKeyword) hasNever = true;
    if (
      ts.isLiteralTypeNode(member) &&
      ts.isStringLiteral(member.literal) &&
      member.literal.text === "__kind__"
    ) {
      hasKindLiteral = true;
    }
  }
  return hasNever && hasKindLiteral;
}

/**
 * Count occurrences of `_` marker in a type node tree.
 */
function countUnderscoreMarkers(node: ts.TypeNode, checker: ts.TypeChecker | undefined): number {
  if (isUnderscoreMarker(node, checker)) return 1;

  let count = 0;
  ts.forEachChild(node, (child) => {
    if (ts.isTypeNode(child as ts.Node)) {
      count += countUnderscoreMarkers(child as ts.TypeNode, checker);
    }
  });
  return count;
}

/**
 * Replace all `_` marker occurrences with `this["__kind__"]` in source text.
 * Returns the transformed type string.
 */
function replaceUnderscoreInTypeText(typeText: string): string {
  // We need to replace the standalone identifier `_` used as a type, not inside strings.
  // A simple regex handles the common case: `_` surrounded by non-identifier chars.
  return typeText.replace(/(?<![a-zA-Z0-9_$])_(?![a-zA-Z0-9_$])/g, 'this["__kind__"]');
}

/**
 * Print a type node to string using the TypeScript printer.
 */
function printTypeNode(node: ts.TypeNode): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const sourceFile = ts.createSourceFile(
    "__print__.ts",
    "",
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
}

/**
 * Expand a Tier 3 `@hkt` type alias with `_` marker into a TypeFunction interface.
 *
 * Input: `/** @hkt *\/ type ArrayF = Array<_>`
 * Output: `interface ArrayF extends TypeFunction { readonly __kind__: unknown; readonly _: Array<this["__kind__"]> }`
 *
 * Input: `/** @hkt *\/ type MapF<K> = Map<K, _>`
 * Output: `interface MapF<K> extends TypeFunction { readonly __kind__: unknown; readonly _: Map<K, this["__kind__"]> }`
 */
function expandTier3HKT(
  ctx: MacroContext,
  node: ts.TypeAliasDeclaration,
  decorator: ts.Node
): ts.Node | ts.Node[] {
  const typeName = node.name.text;
  const typeParams = node.typeParameters;
  const rhs = node.type;
  const checker = ctx.typeChecker;

  const underscoreCount = countUnderscoreMarkers(rhs, checker);

  if (underscoreCount === 0) {
    ctx.reportError(decorator, `[TS9303] @hkt type alias must contain \`_\` placeholder`);
    return node;
  }

  if (underscoreCount > 1) {
    ctx.reportError(
      decorator,
      `[TS9304] @hkt must contain exactly one \`_\` placeholder, found ${underscoreCount}`
    );
    return node;
  }

  const rhsText = printTypeNode(rhs);
  const replacedRhs = replaceUnderscoreInTypeText(rhsText);

  const typeParamsStr =
    typeParams && typeParams.length > 0
      ? `<${typeParams
          .map((tp) => {
            let s = tp.name.text;
            if (tp.constraint) s += ` extends ${printTypeNode(tp.constraint)}`;
            if (tp.default) s += ` = ${printTypeNode(tp.default)}`;
            return s;
          })
          .join(", ")}>`
      : "";

  const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const exportPrefix = hasExport ? "export " : "";

  const code = `${exportPrefix}interface ${typeName}${typeParamsStr} extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: ${replacedRhs};
}`;

  const stmts = ctx.parseStatements(code);
  return stmts.length === 1 ? stmts[0] : stmts;
}

// ============================================================================
// Tier 2: Companion Generation for Parameterized Type Aliases
// ============================================================================

/**
 * Generate a companion `*F` TypeFunction interface for a parameterized type.
 *
 * The LAST type parameter becomes the HKT hole. All preceding parameters
 * become fixed parameters on the generated companion interface.
 *
 * Works for both type aliases and interfaces:
 *   `/** @hkt *\/ type Option<A> = A | null`        → OptionF extends TypeFunction
 *   `/** @hkt *\/ type Either<E, A> = ...`           → EitherF<E> extends TypeFunction
 *   `/** @hkt *\/ interface NonEmptyList<A> { ... }`  → NonEmptyListF extends TypeFunction
 *
 * Returns the original node plus the generated companion.
 */
function expandTier2Companion(
  ctx: MacroContext,
  node: ts.TypeAliasDeclaration | ts.InterfaceDeclaration,
  typeParams: ts.NodeArray<ts.TypeParameterDeclaration>
): ts.Node[] {
  const typeName = node.name.text;
  const companionName = `${typeName}F`;

  const lastParam = typeParams[typeParams.length - 1];
  const fixedParams = typeParams.slice(0, -1);

  const fixedParamsStr =
    fixedParams.length > 0
      ? `<${fixedParams
          .map((tp) => {
            let s = tp.name.text;
            if (tp.constraint) s += ` extends ${printTypeNode(tp.constraint)}`;
            if (tp.default) s += ` = ${printTypeNode(tp.default)}`;
            return s;
          })
          .join(", ")}>`
      : "";

  const allParamNames = typeParams.map((tp) => tp.name.text);
  const typeArgsStr = allParamNames
    .map((name) => (name === lastParam.name.text ? 'this["__kind__"]' : name))
    .join(", ");

  const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const exportPrefix = hasExport ? "export " : "";

  const companionCode = `${exportPrefix}interface ${companionName}${fixedParamsStr} extends TypeFunction {
  readonly __kind__: unknown;
  readonly _: ${typeName}<${typeArgsStr}>;
}`;

  const companionStmts = ctx.parseStatements(companionCode);
  return [node, ...companionStmts];
}

// ============================================================================
// Macro Registration
// ============================================================================

/**
 * @hkt attribute macro for interfaces/type aliases
 *
 * Tier 2 (type alias with type params, no `_` in RHS):
 *   Generates a companion `*F` interface (last param as hole).
 *   Returns BOTH the original type alias AND the generated companion.
 *
 * Tier 3 (type alias with `_` marker):
 *   Detects `_` in RHS, replaces with `this["__kind__"]`, emits TypeFunction interface.
 *
 * Legacy (interface with F<_> params):
 *   Transforms F<A> to Kind<F, A> within the declaration.
 */
export const hktAttribute = defineAttributeMacro({
  name: "hkt",
  description:
    "Generate a TypeFunction interface from a type alias with _ placeholder, or enable F<_> syntax",
  validTargets: ["interface", "type"],
  expand(ctx, decorator, node) {
    if (ts.isTypeAliasDeclaration(node)) {
      const checker = ctx.typeChecker;
      const hasUnderscore = countUnderscoreMarkers(node.type, checker) > 0;
      const hasTypeParams = node.typeParameters && node.typeParameters.length > 0;

      if (hasUnderscore) {
        return expandTier3HKT(ctx, node, decorator);
      }

      if (hasTypeParams) {
        return expandTier2Companion(ctx, node, node.typeParameters!);
      }

      ctx.reportError(
        decorator,
        `[TS9302] @hkt on a type alias with no type parameters requires a \`_\` placeholder (Tier 3 form)`
      );
      return node;
    }

    if (ts.isInterfaceDeclaration(node)) {
      const hasKindParams = node.typeParameters?.some((p) => isKindAnnotation(p)) ?? false;
      const hasTypeParams = node.typeParameters && node.typeParameters.length > 0;

      if (hasKindParams) {
        return transformHKTDeclaration(ctx, node);
      }

      if (hasTypeParams) {
        return expandTier2Companion(ctx, node, node.typeParameters!);
      }

      ctx.reportError(
        decorator,
        `[TS9302] @hkt on an interface with no type parameters requires F<_> kind parameters`
      );
      return node;
    }

    ctx.reportError(decorator, "@hkt can only be applied to interfaces or type aliases");
    return node;
  },
});

globalRegistry.register(hktAttribute);
