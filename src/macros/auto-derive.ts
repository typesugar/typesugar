/**
 * Scala 3-Style Typeclass Derivation
 *
 * This module provides the infrastructure for automatic typeclass derivation
 * via compile-time type mirrors, following the Scala 3 `derives` pattern:
 *
 * ## Scala 3 Model
 *
 * In Scala 3, typeclass derivation works via:
 * 1. `Mirror.ProductOf[T]` — compiler-synthesized structural mirror for case classes
 * 2. `TC.derived` — a given defined in the typeclass companion that uses Mirror
 * 3. `summon[TC[T]]` — resolves the derived instance
 *
 * ```scala
 * case class Point(x: Int, y: Int) derives Show, Eq
 *
 * // The compiler provides Mirror.ProductOf[Point] with:
 * //   MirroredElemTypes = (Int, Int)
 * //   MirroredElemLabels = ("x", "y")
 * //
 * // Show.derived uses this mirror + Show[Int] instances to synthesize Show[Point]
 * ```
 *
 * ## ttfx Equivalent
 *
 * ```typescript
 * // Just define the type — no annotations needed:
 * interface Point { x: number; y: number; }
 *
 * // summon synthesizes the Mirror automatically via the TypeChecker:
 * //   GenericMeta("Point") = {
 * //     kind: "product",
 * //     fieldNames: ["x", "y"],        // ≈ MirroredElemLabels
 * //     fieldTypes: ["number", "number"] // ≈ MirroredElemTypes
 * //   }
 *
 * // Show has a registered derivation strategy (≈ Show.derived):
 * // It requires Show for each element type. Show[number] exists.
 * // Therefore:
 * summon<Show<Point>>() // auto-derived at compile time!
 * ```
 *
 * No `@derive(Generic)` is needed — the TypeChecker provides the Mirror.
 * (`@derive(Generic)` can still be used to pre-cache the metadata, but
 * summon will synthesize it on demand if absent.)
 *
 * ## Usage
 *
 * Typeclass authors register a derivation strategy (≈ defining `derived`):
 *
 * ```typescript
 * registerGenericDerivation("Show", {
 *   fieldTypeclass: "Show",
 *   hasFieldInstance: makePrimitiveChecker(new Set(["number", "string", ...])),
 *   deriveProduct(ctx, typeName, meta) {
 *     return `{ show: (a: ${typeName}) => ... }`;
 *   },
 * });
 * ```
 *
 * Then `summon<Show<Point>>()` auto-derives if:
 * 1. No explicit instance exists
 * 2. The TypeChecker can inspect Point's structure (always true for visible types)
 * 3. All element types have the required field-level instances
 *
 * @packageDocumentation
 */

import * as ts from "typescript";
import type { MacroContext } from "../core/types.js";
import { getGenericMeta, type GenericMeta } from "./generic.js";

// ============================================================================
// Derivation Strategy (≈ Scala 3 TC.derived)
// ============================================================================

/**
 * A strategy for deriving a typeclass instance from a type mirror.
 *
 * This is the Scala 3 pattern: the typeclass companion defines `derived`
 * which uses `Mirror.ProductOf[T]` / `Mirror.SumOf[T]` to synthesize
 * an instance from element-level instances.
 *
 * In ttfx, `GenericMeta` is our Mirror and this interface is our `derived`.
 */
export interface GenericDerivation {
  /**
   * The typeclass this strategy derives (e.g., "Show", "Eq", "Read").
   */
  readonly typeclassName: string;

  /**
   * The typeclass required for each element type (≈ MirroredElemTypes).
   * E.g., "Show" for Show derivation, "Get" for Read derivation.
   * null if no per-element typeclass is needed.
   */
  readonly fieldTypeclass: string | null;

  /**
   * Check whether an element-level instance exists for a given type.
   * Used to determine if derivation is possible before generating code.
   * (≈ checking that given instances exist for each MirroredElemType)
   *
   * @param fieldType - The type string of the element (e.g., "number", "string | null")
   * @returns true if an instance exists or can be derived
   */
  hasFieldInstance(fieldType: string): boolean;

  /**
   * Generate code for deriving an instance for a product type.
   *
   * @param ctx - The macro context
   * @param typeName - The type being derived for (e.g., "User")
   * @param meta - The Generic metadata (field names, types, etc.)
   * @returns TypeScript code string for the instance, or null if not possible
   */
  deriveProduct(
    ctx: MacroContext,
    typeName: string,
    meta: GenericMeta,
  ): string | null;

  /**
   * Generate code for deriving an instance for a sum type.
   * Optional — not all typeclasses support sum type derivation.
   *
   * @param ctx - The macro context
   * @param typeName - The type being derived for
   * @param meta - The Generic metadata (discriminant, variants, etc.)
   * @returns TypeScript code string for the instance, or null if not possible
   */
  deriveSum?(
    ctx: MacroContext,
    typeName: string,
    meta: GenericMeta,
  ): string | null;
}

// ============================================================================
// Derivation Registry
// ============================================================================

const genericDerivations = new Map<string, GenericDerivation>();

/**
 * Register a Generic derivation strategy for a typeclass.
 *
 * After registration, `summon<TC<A>>()` will auto-derive `TC<A>`
 * when `A` has Generic metadata and all fields have the required instances.
 */
export function registerGenericDerivation(
  typeclassName: string,
  strategy: GenericDerivation,
): void {
  genericDerivations.set(typeclassName, strategy);
}

/**
 * Get the Generic derivation strategy for a typeclass.
 */
export function getGenericDerivation(
  typeclassName: string,
): GenericDerivation | undefined {
  return genericDerivations.get(typeclassName);
}

/**
 * Check whether a typeclass has a Generic derivation strategy.
 */
export function hasGenericDerivation(typeclassName: string): boolean {
  return genericDerivations.has(typeclassName);
}

// ============================================================================
// Caches
// ============================================================================
//
// Two in-memory caches deduplicate work within a single compilation:
//
// 1. mirrorCache — avoids re-walking TypeChecker scope for the same type
// 2. derivationCache — avoids re-generating code for the same TC<T>
//
// Lifecycle: cleared at the start of each compilation by the transformer
// factory (macroTransformerFactory calls clearDerivationCaches). This is
// correct for both single builds and watch mode (where the factory is
// re-invoked per Program).
//
// Limitation: these caches do NOT persist across compilations. In incremental
// builds (`tsc --incremental`), derivations are recomputed even if the type
// hasn't changed. TypeScript may skip re-emitting the file anyway (making the
// recomputation harmless to output), but the work is still done.
//
// Future: integrate with MacroExpansionCache (core/cache.ts) for disk-backed
// cross-compilation caching. This requires hashing the type structure (field
// names + types) as the cache key, so that a changed type invalidates the
// entry. That's a broader project affecting all macros, not just derivation.
// ============================================================================

/** Cache for synthesized Mirrors — avoids re-walking the TypeChecker scope. */
const mirrorCache = new Map<string, GenericMeta | false>();

/** Cache for derived instance code — keyed by "TC<Type>". */
const derivationCache = new Map<string, string>();

/**
 * Clear all derivation caches.
 *
 * Called by the transformer factory at the start of each compilation to
 * ensure no stale mirrors or derivations survive across rebuilds (watch
 * mode, incremental builds). Also useful in test harnesses.
 */
export function clearDerivationCaches(): void {
  mirrorCache.clear();
  derivationCache.clear();
}

// ============================================================================
// Compile-Time Derivation (used by summon macro)
// ============================================================================

/**
 * Try to derive a typeclass instance at compile time via Mirror.
 *
 * Called by the `summon` macro when no explicit instance is found.
 * Follows the Scala 3 pattern:
 *
 * 1. Obtain the Mirror (GenericMeta) for the type
 * 2. Check all MirroredElemTypes have the required given instances
 * 3. Invoke the `derived` strategy to generate the instance code
 *
 * Results are cached at two levels:
 * - L1: in-memory `derivationCache` (fast, per-compilation)
 * - L2: disk-backed `ctx.expansionCache` (cross-compilation, keyed by
 *   structural fingerprint of the type so field changes invalidate)
 *
 * @param ctx - The macro context
 * @param typeclassName - The typeclass to derive (e.g., "Show", "Read")
 * @param typeName - The type to derive for (e.g., "User")
 * @returns An AST expression for the derived instance, or null
 */
export function tryDeriveViaGeneric(
  ctx: MacroContext,
  typeclassName: string,
  typeName: string,
): ts.Expression | null {
  const strategy = genericDerivations.get(typeclassName);
  if (!strategy) return null;

  // L1 fast path: return in-memory cached derivation
  const memKey = `${typeclassName}<${typeName}>`;
  const memCached = derivationCache.get(memKey);
  if (memCached !== undefined) {
    return ctx.parseExpression(memCached);
  }

  // Obtain Mirror: check pre-cached registry, then mirror cache, then synthesize
  let meta = getGenericMeta(typeName);
  if (!meta) {
    const mirrorCached = mirrorCache.get(typeName);
    if (mirrorCached === false) {
      return null; // previously failed to synthesize
    }
    if (mirrorCached) {
      meta = mirrorCached;
    } else {
      meta = extractMetaFromTypeChecker(ctx, typeName);
      mirrorCache.set(typeName, meta ?? false);
      if (!meta) return null;
    }
  }

  // Check all fields have the required instances
  if (strategy.fieldTypeclass && meta.fieldTypes) {
    for (const fieldType of meta.fieldTypes) {
      if (!strategy.hasFieldInstance(fieldType)) {
        return null;
      }
    }
  }

  // L2: check disk cache using structural key (field names + types)
  const diskCache = ctx.expansionCache;
  if (diskCache) {
    const structuralJson = JSON.stringify({
      kind: meta.kind,
      fieldNames: meta.fieldNames,
      fieldTypes: meta.fieldTypes,
      discriminant: meta.discriminant,
      variants: meta.variants?.map((v) => ({
        tag: v.tag,
        typeName: v.typeName,
      })),
    });
    const diskKey = diskCache.computeStructuralKey(typeclassName, structuralJson);
    const diskCached = diskCache.get(diskKey);
    if (diskCached !== undefined) {
      // Populate L1 cache so subsequent calls in this compilation are fast
      derivationCache.set(memKey, diskCached);
      return ctx.parseExpression(diskCached);
    }

    // Generate the derivation code
    const code = generateDerivationCode(strategy, ctx, typeName, meta);
    if (!code) return null;

    // Store in both L1 and L2
    derivationCache.set(memKey, code);
    diskCache.set(diskKey, code);

    return ctx.parseExpression(code);
  }

  // No disk cache available — generate and store in L1 only
  const code = generateDerivationCode(strategy, ctx, typeName, meta);
  if (!code) return null;

  derivationCache.set(memKey, code);
  return ctx.parseExpression(code);
}

/**
 * Generate derivation code using the strategy, dispatching on product/sum kind.
 */
function generateDerivationCode(
  strategy: GenericDerivation,
  ctx: MacroContext,
  typeName: string,
  meta: GenericMeta,
): string | null {
  if (meta.kind === "product") {
    return strategy.deriveProduct(ctx, typeName, meta);
  }
  if (meta.kind === "sum" && strategy.deriveSum) {
    return strategy.deriveSum(ctx, typeName, meta);
  }
  return null;
}

/**
 * Check whether a typeclass instance can be derived for a type.
 * Does not generate code — just checks feasibility.
 * Uses the mirror cache if available.
 */
export function canDeriveViaGeneric(
  typeclassName: string,
  typeName: string,
): boolean {
  const strategy = genericDerivations.get(typeclassName);
  if (!strategy) return false;

  // Check derivation cache first — if we already derived it, it's derivable
  if (derivationCache.has(`${typeclassName}<${typeName}>`)) return true;

  let meta = getGenericMeta(typeName);
  if (!meta) {
    const mirrorCached = mirrorCache.get(typeName);
    if (mirrorCached === false) return false;
    meta = mirrorCached ?? null;
  }
  if (!meta) return false;

  if (strategy.fieldTypeclass && meta.fieldTypes) {
    for (const fieldType of meta.fieldTypes) {
      if (!strategy.hasFieldInstance(fieldType)) {
        return false;
      }
    }
  }

  return true;
}

// ============================================================================
// Mirror Synthesis via TypeChecker
// ============================================================================

/**
 * Synthesize a Mirror (GenericMeta) from the TypeChecker.
 *
 * Analogous to how Scala 3 automatically provides Mirror.ProductOf for
 * case classes — no annotation needed, the compiler just knows the structure.
 * We use the TypeScript type checker to extract field names and types.
 */
function extractMetaFromTypeChecker(
  ctx: MacroContext,
  typeName: string,
): GenericMeta | null {
  const typeChecker = ctx.typeChecker;
  const sourceFile = ctx.sourceFile;

  let typeSymbol: ts.Symbol | undefined;

  // Search imports and local declarations
  const symbols = typeChecker.getSymbolsInScope(
    sourceFile,
    ts.SymbolFlags.Type | ts.SymbolFlags.Interface | ts.SymbolFlags.Class,
  );

  for (const sym of symbols) {
    if (sym.name === typeName) {
      typeSymbol = sym;
      break;
    }
  }

  if (!typeSymbol) return null;

  const type = typeChecker.getDeclaredTypeOfSymbol(typeSymbol);
  const properties = type.getProperties();

  if (properties.length === 0) return null;

  const fieldNames: string[] = [];
  const fieldTypes: string[] = [];

  for (const prop of properties) {
    const propType = typeChecker.getTypeOfSymbolAtLocation(
      prop,
      prop.valueDeclaration ?? sourceFile,
    );

    fieldNames.push(prop.name);
    fieldTypes.push(typeChecker.typeToString(propType));
  }

  return {
    kind: "product",
    fieldNames,
    fieldTypes,
  };
}

// ============================================================================
// Built-in Derivation Strategies
// ============================================================================

/**
 * Helper to check if a type string represents a type with a known primitive
 * instance for a given typeclass.
 */
export function makePrimitiveChecker(
  primitiveTypes: ReadonlySet<string>,
): (fieldType: string) => boolean {
  return function hasInstance(fieldType: string): boolean {
    // Strip nullable/optional wrappers
    const stripped = fieldType
      .replace(/\s*\|\s*null\s*/g, "")
      .replace(/\s*null\s*\|\s*/g, "")
      .replace(/\s*\|\s*undefined\s*/g, "")
      .replace(/\s*undefined\s*\|\s*/g, "")
      .trim();

    // Array types: check inner
    if (stripped.endsWith("[]")) {
      return hasInstance(stripped.slice(0, -2).trim());
    }
    if (stripped.startsWith("Array<") && stripped.endsWith(">")) {
      return hasInstance(stripped.slice(6, -1).trim());
    }

    return primitiveTypes.has(stripped);
  };
}

// Show derivation via Generic
registerGenericDerivation("Show", {
  typeclassName: "Show",
  fieldTypeclass: "Show",

  hasFieldInstance: makePrimitiveChecker(
    new Set(["number", "string", "boolean", "bigint"]),
  ),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;

    const parts = meta.fieldNames.map((name, i) => {
      const ft = meta.fieldTypes![i];
      const showExpr = primitiveShowExpr(ft);
      if (!showExpr) return null;
      return `\`${name} = \${${showExpr}(a.${name})}\``;
    });

    if (parts.some((p) => p === null)) return null;

    return `({ show: (a: ${typeName}) => \`${typeName}(\${[${parts.join(", ")}].join(", ")})\` })`;
  },

  deriveSum(ctx, typeName, meta) {
    if (!meta.variants || !meta.discriminant) return null;

    const cases = meta.variants
      .map((v) => `case "${v.tag}": return \`${v.tag}(\${JSON.stringify(a)})\``)
      .join("; ");

    return `({ show: (a: ${typeName}) => { switch ((a as any).${meta.discriminant}) { ${cases}; default: return String(a) } } })`;
  },
});

// Eq derivation via Generic
registerGenericDerivation("Eq", {
  typeclassName: "Eq",
  fieldTypeclass: "Eq",

  hasFieldInstance: makePrimitiveChecker(
    new Set(["number", "string", "boolean", "bigint"]),
  ),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames) return null;

    const checks = meta.fieldNames
      .map((name) => `a.${name} === b.${name}`)
      .join(" && ");

    return `({ eq: (a: ${typeName}, b: ${typeName}) => ${checks || "true"} })`;
  },
});

// Ord derivation via Generic (lexicographic)
registerGenericDerivation("Ord", {
  typeclassName: "Ord",
  fieldTypeclass: "Ord",

  hasFieldInstance: makePrimitiveChecker(
    new Set(["number", "string", "boolean", "bigint"]),
  ),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames) return null;

    const comparisons = meta.fieldNames
      .map(
        (name) =>
          `{ const c = a.${name} < b.${name} ? -1 : a.${name} > b.${name} ? 1 : 0; if (c !== 0) return c; }`,
      )
      .join(" ");

    return `({ compare: (a: ${typeName}, b: ${typeName}): number => { ${comparisons} return 0; } })`;
  },
});

// Hash derivation via Generic
registerGenericDerivation("Hash", {
  typeclassName: "Hash",
  fieldTypeclass: "Hash",

  hasFieldInstance: makePrimitiveChecker(
    new Set(["number", "string", "boolean", "bigint"]),
  ),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;

    const hashSteps = meta.fieldNames.map((name, i) => {
      const ft = meta.fieldTypes![i];
      const hashExpr = primitiveHashExpr(ft, `a.${name}`);
      if (!hashExpr) return null;
      return `h = ((h << 5) + h) ^ (${hashExpr})`;
    });

    if (hashSteps.some((s) => s === null)) return null;

    return `({ hash: (a: ${typeName}): number => { let h = 0; ${hashSteps.join("; ")}; return h >>> 0; } })`;
  },
});

// Clone derivation via Generic
registerGenericDerivation("Clone", {
  typeclassName: "Clone",
  fieldTypeclass: null,

  hasFieldInstance: () => true,

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames) return null;

    const fields = meta.fieldNames
      .map((name) => `${name}: structuredClone(a.${name})`)
      .join(", ");

    return `({ clone: (a: ${typeName}): ${typeName} => ({ ${fields} }) })`;
  },
});

// ============================================================================
// Helpers for code generation
// ============================================================================

function primitiveShowExpr(fieldType: string): string | null {
  const stripped = fieldType
    .replace(/\s*\|\s*null\s*/g, "")
    .replace(/\s*null\s*\|\s*/g, "")
    .trim();

  switch (stripped) {
    case "number":
    case "boolean":
    case "bigint":
      return "String";
    case "string":
      return "JSON.stringify";
    default:
      return null;
  }
}

function primitiveHashExpr(fieldType: string, accessor: string): string | null {
  const stripped = fieldType
    .replace(/\s*\|\s*null\s*/g, "")
    .replace(/\s*null\s*\|\s*/g, "")
    .trim();

  switch (stripped) {
    case "number":
      return `(${accessor} | 0)`;
    case "string":
      return `Array.from(${accessor}).reduce((h, c) => ((h << 5) + h) ^ c.charCodeAt(0), 0)`;
    case "boolean":
      return `(${accessor} ? 1 : 0)`;
    case "bigint":
      return `Number(${accessor} & 0xFFFFFFFFn)`;
    default:
      return null;
  }
}
