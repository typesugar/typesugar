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
 * Help for a missing instance whose type is a primitive (`number`, `string`,
 * `boolean`, `bigint`, `symbol`, or a literal of one), which no `@derive` or
 * `derived<...>()` can build: the instance has to come from a module. Decided
 * by the type's flags, not its printed name. Undefined for any other type.
 */
export function primitiveInstanceHelp(
  type: ts.Type | undefined,
  typeclassName: string,
  typeName: string
): string | undefined {
  const primitive =
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike |
    ts.TypeFlags.ESSymbolLike;
  if (!type || !(type.flags & primitive)) return undefined;
  return (
    `${typeName} is a primitive, so there is nothing to derive ${typeclassName} from. Bring a ` +
    `${typeclassName}<${typeName}> instance into scope (import the module that provides it; ` +
    `@typesugar/std's typeclasses come with instances for the primitives they support), ` +
    `or declare one: /** @impl ${typeclassName}<${typeName}> */`
  );
}
