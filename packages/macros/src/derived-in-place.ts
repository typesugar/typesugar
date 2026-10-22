/**
 * Instances that `summon` and `= implicit()` derive in place (the deprecated
 * fallback, TS9009), and the TS9001 hint for a type the project doesn't own.
 * Imports nothing from this package, so `typeclass.ts`, `implicits.ts` and
 * `auto-derive.ts` can all import it statically (no cycle).
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import type { MacroContext } from "@typesugar/core";
import { TS9009 } from "@typesugar/core";

/** The (typeclass, type) pairs already warned about, per file transform (its context). */
const derivedInPlaceWarned = new WeakMap<object, Set<string>>();

/**
 * The name to suggest for a declared instance: `cloneFeature` for
 * `Clone<Feature>`, `cloneFeaturePoint` for `Clone<Feature<Point>>`.
 */
export function suggestedInstanceName(typeclassName: string, typeName: string): string {
  const stem = typeName
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return typeclassName.charAt(0).toLowerCase() + typeclassName.slice(1) + stem;
}

/**
 * Warn (TS9009) that `summon` / an `= implicit()` parameter derived an instance
 * in place because none was in scope — once per (typeclass, type) per file.
 * The fallback is deprecated: a later release makes both find-only.
 *
 * @param isInstanceInitializer - the summon is the whole initializer of a
 *   top-level const (`export const cloneFeature = summon<Clone<Feature>>()`),
 *   which `derived<...>()` replaces in place.
 */
export function warnDerivedInPlace(
  ctx: MacroContext,
  node: ts.Node,
  typeclassName: string,
  typeName: string,
  isInstanceInitializer: boolean
): void {
  let warned = derivedInPlaceWarned.get(ctx);
  if (!warned) {
    warned = new Set();
    derivedInPlaceWarned.set(ctx, warned);
  }
  const key = `${typeclassName}<${typeName}>`;
  if (warned.has(key)) return;
  warned.add(key);
  const call = `derived<${typeclassName}<${typeName}>>()`;
  ctx
    .diagnostic(TS9009)
    .at(node)
    .withArgs({ typeclass: typeclassName, type: typeName })
    .help(
      isInstanceInitializer
        ? `Write \`${call}\` here instead of summon: summon will stop deriving instances in a future release.`
        : `Declare it once with \`export const ${suggestedInstanceName(typeclassName, typeName)} = ${call};\` ` +
            `in a module of your own, and import that module where the instance is used. ` +
            `summon and implicit() will stop deriving instances in a future release.`
    )
    .emit();
}

/**
 * Help for a TS9001 on a type the project doesn't own (every declaration is in
 * a `.d.ts` or an external library, such as `Feature` from `@types/geojson`):
 * `@derive` can't go on it, so point at `derived<...>()`. Undefined otherwise.
 */
export function notOwnedTypeHelp(
  ctx: MacroContext,
  type: ts.Type | undefined,
  typeclassName: string,
  typeName: string
): string | undefined {
  const sym = type && (type.aliasSymbol ?? type.symbol);
  const decls = sym?.declarations ?? [];
  if (decls.length === 0) return undefined;
  const external = decls.every((d) => {
    const sf = d.getSourceFile();
    return sf.isDeclarationFile || ctx.program.isSourceFileFromExternalLibrary(sf);
  });
  if (!external) return undefined;
  const name = suggestedInstanceName(typeclassName, typeName);
  return (
    `\`${typeName}\` is declared outside this project, so it can't carry @derive. Declare its ` +
    `instance once, in a module of your own: \`export const ${name} = derived<${typeclassName}<${typeName}>>();\` ` +
    `(its fields need ${typeclassName} instances in scope there), or write one by hand with ` +
    `/** @impl ${typeclassName}<${typeName}> */.`
  );
}

/**
 * `sym` is a built-in object type: an interface or class declared in
 * TypeScript's default lib (`Array`, `ReadonlyArray`, `Map`, `Date`,
 * `Promise`, ...), whose properties are methods and internals rather than
 * fields. Decided by the symbol's kind and where it is declared, not by its
 * name. `some`: a library may augment a built-in (`declare global { interface
 * Array<T> ... }`), which doesn't make it a type with fields.
 */
export function isBuiltinObjectSymbol(program: ts.Program, sym: ts.Symbol | undefined): boolean {
  if (!sym || !(sym.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class))) return false;
  return (sym.declarations ?? []).some((d) =>
    program.isSourceFileDefaultLibrary(d.getSourceFile())
  );
}

/**
 * {@link isBuiltinObjectSymbol} for a resolved type: reads the type's OWN
 * symbol, never its alias. So `type Nums = number[]` is a built-in (Array),
 * while the lib's utility aliases (`Readonly<Point>`, `Partial<Point>`,
 * `Record<"a", number>`, `Pick<...>`) are not: they resolve to mapped or
 * anonymous object types whose symbol is a type literal, with ordinary fields.
 *
 * A homomorphic mapped type (`Readonly<T>`, `Partial<T>`, `Pick<T, K>`, a
 * user's `{ [K in keyof T]: ... }`, or an alias of an application of one) is
 * a built-in exactly when the type it maps, `T`, is one -- by symbol, the
 * same test as for `T` itself (review 6: `Readonly<AppError>`, with
 * `AppError` a user interface extending `Error`, was a built-in because some
 * of its properties are declared in lib's `Error`, while
 * `derived<Eq<AppError>>()` derived). `T` is read from the mapped type's
 * declaration and the alias application's type arguments. When it can't be
 * determined, the mapped type is a built-in only if every property is
 * declared as a member of a lib interface or class.
 */
export function isBuiltinObjectType(program: ts.Program, type: ts.Type, depth = 0): boolean {
  if (isBuiltinObjectSymbol(program, type.symbol)) return true;
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  if (!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped)) return false;
  const checker = program.getTypeChecker();
  const source = depth < 8 ? mappedTypeSource(checker, type) : undefined;
  if (source) return isBuiltinObjectType(program, source, depth + 1);
  const props = type.getProperties();
  return (
    props.length > 0 &&
    props.every((prop) =>
      (prop.declarations ?? []).some(
        (d) =>
          (ts.isInterfaceDeclaration(d.parent) || ts.isClassDeclaration(d.parent)) &&
          program.isSourceFileDefaultLibrary(d.getSourceFile())
      )
    )
  );
}

/**
 * The type a homomorphic mapped type maps (`T` in `{ [P in keyof T]: ... }`,
 * or in `{ [P in K]: ... }` with `K extends keyof T`): the type parameter's
 * index in the alias declaring the mapped type, looked up in the type
 * arguments that alias was applied with -- the type's own alias arguments
 * (`Readonly<Map<K, V>>`), or, for an alias of an application (`type RM =
 * Readonly<Map<K, V>>`), the application in that alias's declaration. By
 * symbol throughout; undefined when the shape is anything else.
 */
function mappedTypeSource(checker: ts.TypeChecker, type: ts.Type): ts.Type | undefined {
  const decl = type.symbol?.declarations?.find(ts.isMappedTypeNode);
  if (!decl) return undefined;
  const typeParamOf = (node: ts.TypeNode | undefined) => {
    if (!node || !ts.isTypeReferenceNode(node)) return undefined;
    return checker
      .getSymbolAtLocation(node.typeName)
      ?.declarations?.find(ts.isTypeParameterDeclaration);
  };
  let constraint = decl.typeParameter.constraint;
  const keyParam = typeParamOf(constraint);
  if (keyParam) constraint = keyParam.constraint;
  if (
    !constraint ||
    !ts.isTypeOperatorNode(constraint) ||
    constraint.operator !== ts.SyntaxKind.KeyOfKeyword
  ) {
    return undefined;
  }
  const mapped = typeParamOf(constraint.type);
  const alias = mapped?.parent;
  if (!mapped || !alias || !ts.isTypeAliasDeclaration(alias) || !alias.typeParameters) {
    return undefined;
  }
  const index = alias.typeParameters.indexOf(mapped);
  const aliasSymbol = checker.getSymbolAtLocation(alias.name);
  if (index < 0 || !aliasSymbol) return undefined;
  if (type.aliasSymbol === aliasSymbol) return type.aliasTypeArguments?.[index];
  // An alias of an application of it, possibly through further aliases.
  let outer = type.aliasSymbol;
  for (let i = 0; outer && i < 8; i++) {
    const body = outer.declarations?.find(ts.isTypeAliasDeclaration)?.type;
    if (!body || !ts.isTypeReferenceNode(body)) return undefined;
    let target = checker.getSymbolAtLocation(body.typeName);
    if (target && target.flags & ts.SymbolFlags.Alias) target = checker.getAliasedSymbol(target);
    if (target === aliasSymbol) {
      const arg = body.typeArguments?.[index];
      return arg ? checker.getTypeFromTypeNode(arg) : undefined;
    }
    outer = target;
  }
  return undefined;
}

/**
 * Help for a missing instance whose type is a primitive (`number`, `string`,
 * `boolean`, `bigint`, `symbol`, or a literal of one), which no `@derive` or
 * `derived<...>()` can build: the instance has to come from a module. Decided
 * by the type's flags, not its printed name. Undefined for any other type.
 */
export function primitiveInstanceHelp(
  type: ts.Type | undefined,
  typeclassName: string,
  typeName: string,
  program?: ts.Program
): string | undefined {
  const primitive =
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike |
    ts.TypeFlags.ESSymbolLike;
  if (!type) return undefined;
  // A built-in object type (Array, Map, Date, ...: declared in TypeScript's
  // lib) isn't derived either; derived<...>() rejects it.
  if (program && !(type.flags & primitive) && isBuiltinObjectType(program, type)) {
    return (
      `${typeName} is a built-in type, which derivation doesn't take apart. Bring a ` +
      `${typeclassName}<${typeName}> instance into scope (a library's, such as @typesugar/std's ` +
      `instances and instance constructors, or your own: /** @impl ${typeclassName}<${typeName}> */).`
    );
  }
  if (!(type.flags & primitive)) return undefined;
  return (
    `${typeName} is a primitive, so there is nothing to derive ${typeclassName} from. Bring a ` +
    `${typeclassName}<${typeName}> instance into scope (import the module that provides it; ` +
    `a library's typeclasses, such as @typesugar/std's and @typesugar/fp's, come with instances ` +
    `for the primitives they support), ` +
    `or declare one: /** @impl ${typeclassName}<${typeName}> */`
  );
}
