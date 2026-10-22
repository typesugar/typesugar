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
 * ## typesugar Equivalent
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
 * The same derivation backs `@derive(TC)` and `derived<TC<T>>()` (an
 * instance declared once, for a type you don't own). `summon`'s and
 * `= implicit()`'s use of it, deriving in place when no instance is in scope,
 * is deprecated (TS9009).
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
import type { MacroContext } from "@typesugar/core";
import { isSyntheticNode, isJSDocTagAtLineStart, deriveTagNames } from "@typesugar/core";
import { getGenericMeta, type GenericMeta } from "./generic.js";
import type { ResolutionAttempt } from "@typesugar/core";
// Static: instance-resolver imports nothing from this module, so there is no
// cycle (a lazy require() of it doesn't resolve when tests run the sources).
import { resolveInstance, buildInstanceReference } from "./instance-resolver.js";
import { isBuiltinObjectSymbol, isBuiltinObjectType } from "./derived-in-place.js";

/**
 * Parse cached/generated derivation text (the string cache contract — see the
 * CLAUDE.md exception for this file) into a FULLY synthetic expression.
 *
 * `ctx.parseExpression` resets node positions with `stripPositions`, but that
 * walks with `visitEachChild`, which skips TOKEN children (a binary
 * expression's `===`/`&&`, an arrow's `=>`). Those tokens kept their offsets
 * in the temporary parse file, and the printer then emitted whatever comment
 * the USER's file had at that offset: `a.name === // a < b, ...` (docs
 * review r3 #2). `ts.forEachChild` does visit tokens; the nodes are freshly
 * parsed and owned here, so resetting them in place is safe.
 */
function parseDerivedExpression(ctx: MacroContext, code: string): ts.Expression {
  const expr = ctx.parseExpression(code);
  // NodeArrays too: the printer places a list's closing token, and the
  // comments before it, by the ARRAY's `end` (`v.slice()`'s empty argument
  // list printed the user's `/** @derive(Clone) */` found at that offset).
  const resetArray = (arr: ts.NodeArray<ts.Node>): void => {
    ts.setTextRange(arr, { pos: -1, end: -1 });
    arr.forEach(reset);
  };
  const reset = (n: ts.Node): void => {
    ts.setTextRange(n, { pos: -1, end: -1 });
    ts.setCommentRange(n, { pos: -1, end: -1 });
    ts.forEachChild(n, reset, resetArray);
  };
  reset(expr);
  return expr;
}

// ============================================================================
// Derivation Result (with resolution trace for error diagnostics)
// ============================================================================

/**
 * Result of attempting to derive a typeclass instance via Generic.
 * Includes both the expression (if successful) and a trace of all
 * resolution attempts (for error diagnostics when derivation fails).
 */
export interface DerivationResult {
  /** The derived instance expression, or null if derivation failed */
  expression: ts.Expression | null;
  /** Resolution attempts made, regardless of success/failure */
  trace: ResolutionAttempt[];
  /**
   * When derivation failed because a field has no instance and none can be
   * derived: the first such field (`variant` names the sum-type member it
   * belongs to). `derived<TC<T>>()` reports it as TS9107.
   */
  failedField?: { name: string; type: string; variant?: string };
  /** The type is a built-in (TypeScript's lib), which is never derived. */
  builtin?: boolean;
}

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
 * In typesugar, `GenericMeta` is our Mirror and this interface is our `derived`.
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
  deriveProduct(ctx: MacroContext, typeName: string, meta: GenericMeta): string | null;

  /**
   * Generate code for deriving an instance for a sum type.
   * Optional — not all typeclasses support sum type derivation.
   *
   * @param ctx - The macro context
   * @param typeName - The type being derived for
   * @param meta - The Generic metadata (discriminant, variants, etc.)
   * @returns TypeScript code string for the instance, or null if not possible
   */
  deriveSum?(ctx: MacroContext, typeName: string, meta: GenericMeta): string | null;
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
  strategy: GenericDerivation
): void {
  genericDerivations.set(typeclassName, strategy);
}

/**
 * Get the Generic derivation strategy for a typeclass.
 */
export function getGenericDerivation(typeclassName: string): GenericDerivation | undefined {
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
// 1. mirror — avoids re-walking the TypeChecker for the same type DECLARATION
// 2. derivation — avoids re-generating code for the same (file, TC, declaration)
//
// Both are partitioned per `ts.Program` (WeakMap), so a rebuild (watch/LSP,
// or a second `transformCode` in the same process) starts clean without
// anyone having to remember to clear them, and are keyed by the type's
// resolved DECLARATION identity, never by its bare name: two files' unrelated
// `Point` types must not share a mirror or a derived instance. The
// derivation key also includes the requesting file, because the generated
// code references field instances resolved from THAT file's scope.
//
// Registry shape (CLAUDE.md "Resolving things a macro just generated"):
// field instances are resolved through `resolveInstance`, which consults the
// live same-pass `getSynthesized` side-table, so a `@derive(Eq)` companion
// generated earlier in the same pass is visible to a later derivation.
// ============================================================================

/**
 * Salt for the L2 disk-cache key: bump whenever a built-in strategy's output
 * shape changes, so persisted derivations from an older version (e.g. an
 * `Ord` instance with only `compare`) are never served again.
 */
const DERIVATION_OUTPUT_FORMAT = 5;

interface DerivationCaches {
  /** Keyed by the type's symbol, or by the concrete type when one was given. */
  mirror: Map<ts.Symbol | ts.Type, GenericMeta | false>;
  derivation: Map<string, string>;
}

let cachesByProgram = new WeakMap<ts.Program, DerivationCaches>();

function cachesFor(program: ts.Program): DerivationCaches {
  let c = cachesByProgram.get(program);
  if (!c) {
    c = { mirror: new Map(), derivation: new Map() };
    cachesByProgram.set(program, c);
  }
  return c;
}

/**
 * Clear all derivation caches.
 *
 * Caches are already partitioned per `ts.Program` and invalidate on rebuild;
 * this drops every partition (useful in test harnesses that re-use a program).
 */
export function clearDerivationCaches(): void {
  cachesByProgram = new WeakMap();
}

/**
 * Type information the TypeChecker mirror carries alongside the string-only
 * {@link GenericMeta} (which is a public, serializable shape). Lets the
 * builtin strategies resolve field instances from real `ts.Type`s (non-nullable
 * part of an optional field, array element types, sum-variant fields) instead
 * of re-interpreting `typeToString` output.
 */
interface MirrorTypes {
  fieldTypes: ts.Type[];
  optional: boolean[];
  variantTypes?: ts.Type[];
  /** The type the mirror describes (the product, or the union for a sum). */
  self: ts.Type;
}

const mirrorTypes = new WeakMap<GenericMeta, MirrorTypes>();

/**
 * Set while a derivation's code is generated; incremented whenever that code
 * depends on the requesting file's SCOPE (an instance resolved from scope or
 * an import injected). Scope-dependent output is never written to the disk
 * cache, whose key is structural only.
 */
let scopeDependence = 0;

/**
 * Incremented when a derivation's output depends on more than the top-level
 * field type text in the disk-cache key: a nested type's structure, an
 * alias's target (field-wise Clone). Such output is not written to the disk
 * cache.
 */
let structureDependence = 0;

// ============================================================================
// Compile-Time Derivation (used by summon macro)
// ============================================================================

/** Find the symbol of a type named `typeName` as seen from `ctx.sourceFile`. */
function findTypeSymbol(
  ctx: MacroContext,
  typeName: string,
  node?: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration
): ts.Symbol | undefined {
  const typeChecker = ctx.typeChecker;
  if (node?.name && !isSyntheticNode(node.name)) {
    const sym = typeChecker.getSymbolAtLocation(node.name);
    if (sym) return sym;
  }
  const symbols = typeChecker.getSymbolsInScope(
    ctx.sourceFile,
    ts.SymbolFlags.Type | ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.Alias
  );
  for (let sym of symbols) {
    if (sym.name !== typeName) continue;
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = typeChecker.getAliasedSymbol(sym);
      } catch {
        continue;
      }
    }
    if (sym.flags & ts.SymbolFlags.Type) return sym;
    // `export class Box` in this file: the local symbol is only the export's
    // stand-in (ExportValue/ExportType); the type is on the export symbol.
    const exported = typeChecker.getExportSymbolOfSymbol(sym);
    if (exported !== sym && exported.flags & ts.SymbolFlags.Type) return exported;
  }
  return undefined;
}

/** Stable identity of a type declaration for cache keys. */
function declKey(sym: ts.Symbol | undefined, typeName: string): string {
  const d = sym?.declarations?.[0];
  return d ? `${d.getSourceFile().fileName}:${d.pos}:${typeName}` : `name:${typeName}`;
}

/**
 * Try to derive a typeclass instance at compile time via Generic.
 *
 * Called by the `summon` macro when no explicit instance is found.
 * Follows the Scala 3 pattern:
 *
 * 1. Obtain the Generic (GenericMeta) for the type
 * 2. Check all element types have the required instances
 * 3. Invoke the derivation strategy to generate the instance code
 *
 * Results are cached at two levels:
 * - L1: in-memory, per program, keyed by (requesting file, TC, declaration)
 * - L2: disk-backed `ctx.expansionCache` — structural fingerprint plus type
 *   name and declaring file; only scope-INDEPENDENT output is stored
 *
 * @param ctx - The macro context
 * @param typeclassName - The typeclass to derive (e.g., "Show", "Read")
 * @param typeName - The type to derive for (e.g., "User")
 * @param node - The type's declaration, when deriving for one (`@derive`)
 * @param concreteType - The type `typeName` denotes at the request site, when
 *   it differs from the symbol's declared type: `summon<Clone<Feature>>()` on
 *   `interface Feature<G = Geometry, P = Props>` means `Feature<Geometry,
 *   Props>`, while the declared type is `Feature<G, P>`, whose fields are
 *   type parameters.
 * @param knownSymbol - The type's symbol, when the caller has it by identity
 *   (resolved at the request site through imports and scopes). Without it the
 *   symbol is looked up by `typeName` among the names in scope at the top of
 *   the file, which is a name match (CLAUDE.md "Deciding what a type is"):
 *   a type declared in a function, or reached as `ns.T`, is not found that way,
 *   and an outer type of the same name is found instead. Callers with a type
 *   node pass it.
 * @returns DerivationResult with expression (if successful) and trace (always)
 */
export function tryDeriveViaGeneric(
  ctx: MacroContext,
  typeclassName: string,
  typeName: string,
  node?: ts.InterfaceDeclaration | ts.ClassDeclaration | ts.TypeAliasDeclaration,
  concreteType?: ts.Type,
  knownSymbol?: ts.Symbol
): DerivationResult {
  const trace: ResolutionAttempt[] = [];

  // Step 1: Check for derivation strategy
  const strategy = genericDerivations.get(typeclassName);
  if (!strategy) {
    trace.push({
      step: "derivation-strategy",
      target: typeclassName,
      result: "not-found",
      reason: `no GenericDerivation registered for ${typeclassName}`,
    });
    return { expression: null, trace };
  }

  trace.push({
    step: "derivation-strategy",
    target: typeclassName,
    result: "found",
  });

  const caches = cachesFor(ctx.program);
  const registeredMeta = getGenericMeta(typeName);
  let typeSymbol: ts.Symbol | undefined;
  if (!registeredMeta && knownSymbol) {
    typeSymbol = knownSymbol;
  } else if (!registeredMeta) {
    try {
      // `Feature<Point>` with its concrete type (derived<Clone<Feature<Point>>>()):
      // the symbol is `Feature`'s; the mirror reads the instantiation.
      const symbolName =
        concreteType && typeName.includes("<")
          ? typeName.slice(0, typeName.indexOf("<"))
          : typeName;
      typeSymbol = findTypeSymbol(ctx, symbolName.trim(), node);
    } catch (e) {
      ctx.reportWarning(
        node ?? ctx.sourceFile,
        `derive ${typeclassName}<${typeName}>: could not resolve '${typeName}' ` +
          `(${e instanceof Error ? e.message : String(e)})`
      );
    }
  }

  // A built-in type (Array, Map, Date, ... from TypeScript's lib) has no
  // fields to derive from: its properties are methods and internals
  // (`__@unscopables@22`, `__@toStringTag@35`), and a "derivation" from them
  // compared those. Decided by the resolved type's own symbol (an interface
  // or class declared in the lib), not its alias: `Readonly<Point>` and
  // `Record<K, V>` are lib ALIASES of ordinary object types and derive from
  // their fields, while `type Nums = number[]` is an Array.
  const subjectType =
    concreteType ??
    (typeSymbol && typeSymbol.flags & ts.SymbolFlags.TypeAlias
      ? ctx.typeChecker.getDeclaredTypeOfSymbol(typeSymbol)
      : undefined);
  if (
    subjectType
      ? isBuiltinObjectType(ctx.program, subjectType)
      : isBuiltinObjectSymbol(ctx.program, typeSymbol)
  ) {
    trace.push({
      step: "generic-meta",
      target: `GenericMeta for ${typeName}`,
      result: "rejected",
      reason:
        `${typeName} is a built-in type (TypeScript's lib): derivation builds an instance ` +
        `from a type's own fields, and a built-in's properties are its methods and internals. ` +
        `A field of this type is handled inside a derived instance; for ${typeName} itself, ` +
        `put an instance in scope (a library's, such as @typesugar/std's instances and ` +
        `instance constructors like eqArray(eqNumber), or your own /** @impl ` +
        `${typeclassName}<${typeName}> */).`,
    });
    return { expression: null, trace, builtin: true };
  }

  // L1 fast path: return in-memory cached derivation
  const memKey =
    `${ctx.sourceFile.fileName}\0${typeclassName}\0${declKey(typeSymbol, typeName)}` +
    (concreteType ? "\0concrete" : "");
  const memCached = caches.derivation.get(memKey);
  if (memCached !== undefined) {
    trace.push({
      step: "cache-lookup",
      target: `${typeclassName}<${typeName}>`,
      result: "found",
      reason: "in-memory cache hit",
    });
    return { expression: parseDerivedExpression(ctx, memCached), trace };
  }

  // Step 2: Obtain GenericMeta
  let meta: GenericMeta | undefined | null = registeredMeta;
  if (!meta) {
    const mirrorKey = concreteType ?? typeSymbol;
    const mirrorCached = mirrorKey ? caches.mirror.get(mirrorKey) : undefined;
    if (mirrorCached === false || !typeSymbol) {
      trace.push({
        step: "generic-meta",
        target: `GenericMeta for ${typeName}`,
        result: "not-found",
        reason: typeSymbol ? "type has no derivable structure (cached)" : "type not found in scope",
      });
      return { expression: null, trace };
    }
    if (mirrorCached) {
      meta = mirrorCached;
    } else {
      meta = extractMetaFromSymbol(ctx, typeName, typeSymbol, concreteType);
      caches.mirror.set(mirrorKey!, meta ?? false);
      if (!meta) {
        trace.push({
          step: "generic-meta",
          target: `GenericMeta for ${typeName}`,
          result: "not-found",
          reason:
            "type has no data properties, or is a union without a string-literal discriminant",
        });
        return { expression: null, trace };
      }
    }
  }

  // Record the successful GenericMeta extraction
  const fieldSummary =
    meta.fieldNames && meta.fieldTypes
      ? `{ ${meta.fieldNames.map((n, i) => `${n}: ${meta.fieldTypes![i]}`).join(", ")} }`
      : meta.kind === "sum"
        ? `sum type with discriminant "${meta.discriminant}"`
        : "unknown structure";

  const genericMetaAttempt: ResolutionAttempt = {
    step: "generic-meta",
    target: `GenericMeta for ${typeName}: ${fieldSummary}`,
    result: "found",
    children: [],
  };

  // Step 3: Check all fields have the required instances (product types only —
  // sum types are checked per variant during code generation)
  const types = mirrorTypes.get(meta);
  let failedField: DerivationResult["failedField"];
  /**
   * Whether the strategy can build the field (by the same code that generates
   * it, when the mirror has its `ts.Type`), recorded in the trace. A field's
   * type TEXT is not enough: `Position` is an alias of `number[]`, which Eq
   * compares element by element (F12).
   */
  const checkField = (
    fieldName: string,
    fieldType: string,
    fieldTsType: ts.Type | undefined,
    variant?: string
  ): boolean => {
    const tc = strategy.fieldTypeclass!;
    let hasInstance = strategy.hasFieldInstance(fieldType);
    let via = "";
    const probe = FIELD_PROBES[strategy.typeclassName];
    if (!hasInstance && fieldTsType && probe) {
      hasInstance = probe(ctx, fieldTsType);
      // Name the instance the field goes through, when it is one from scope.
      const ref = hasInstance ? fieldInstanceRef(ctx, tc, fieldTsType, true) : undefined;
      if (ref) via = ` (instance ${ref})`;
    }
    genericMetaAttempt.children!.push({
      step: "field-check",
      target: `field \`${variant ? `${variant}.` : ""}${fieldName}\`: ${fieldType}`,
      result: hasInstance ? "found" : "rejected",
      reason: hasInstance ? `${fieldType} has ${tc}${via}` : `${fieldType} lacks ${tc}`,
    });
    if (!hasInstance && !failedField) failedField = { name: fieldName, type: fieldType, variant };
    return hasInstance;
  };

  if (strategy.fieldTypeclass && meta.kind === "product" && meta.fieldTypes && meta.fieldNames) {
    let allFieldsOk = true;
    for (let i = 0; i < meta.fieldTypes.length; i++) {
      if (!checkField(meta.fieldNames[i], meta.fieldTypes[i], types?.fieldTypes[i])) {
        allFieldsOk = false;
      }
    }
    if (!allFieldsOk) {
      genericMetaAttempt.result = "rejected";
      genericMetaAttempt.reason = "one or more fields lack required instance";
      trace.push(genericMetaAttempt);
      return { expression: null, trace, failedField };
    }
  }

  // Sum types whose strategy compares each variant's fields inline (Eq): the
  // same check per variant, so a failure names the field instead of only
  // "the strategy returned null". A variant with an instance in scope is
  // compared through it.
  if (
    strategy.fieldTypeclass &&
    meta.kind === "sum" &&
    meta.discriminant &&
    types?.variantTypes &&
    SUM_FIELD_PROBES.has(strategy.typeclassName)
  ) {
    let allFieldsOk = true;
    types.variantTypes.forEach((vt, vi) => {
      if (fieldInstanceRef(ctx, strategy.fieldTypeclass!, vt, true)) return;
      const variant = meta.variants?.[vi]?.typeName;
      for (const f of variantFields(ctx, vt, meta.discriminant!)) {
        const text = ctx.typeChecker.typeToString(f.type);
        if (!checkField(f.name, text, f.type, variant)) allFieldsOk = false;
      }
    });
    if (!allFieldsOk) {
      genericMetaAttempt.result = "rejected";
      genericMetaAttempt.reason = "one or more variant fields lack required instance";
      trace.push(genericMetaAttempt);
      return { expression: null, trace, failedField };
    }
  }

  trace.push(genericMetaAttempt);

  // L2: disk cache keyed by structure PLUS the type's name and declaring
  // file (the generated code embeds the type name, e.g. `Point(...)`).
  const diskCache = ctx.expansionCache;
  const declFile = typeSymbol?.declarations?.[0]?.getSourceFile().fileName ?? "";
  const diskKey = diskCache
    ? diskCache.computeStructuralKey(
        typeclassName,
        JSON.stringify({
          format: DERIVATION_OUTPUT_FORMAT,
          typeName,
          declFile,
          kind: meta.kind,
          fieldNames: meta.fieldNames,
          fieldTypes: meta.fieldTypes,
          // Optionality changes the output (Json's fromJson rejects a missing
          // REQUIRED field), so it must be part of the key.
          optional: mirrorTypes.get(meta)?.optional,
          discriminant: meta.discriminant,
          variants: meta.variants?.map((v) => ({ tag: v.tag, typeName: v.typeName })),
        })
      )
    : undefined;
  if (diskCache && diskKey) {
    const diskCached = diskCache.get(diskKey);
    if (diskCached !== undefined) {
      caches.derivation.set(memKey, diskCached);
      trace.push({
        step: "cache-lookup",
        target: `${typeclassName}<${typeName}>`,
        result: "found",
        reason: "disk cache hit",
      });
      return { expression: parseDerivedExpression(ctx, diskCached), trace };
    }
  }

  // Generate the derivation code
  const before = scopeDependence;
  const beforeStructure = structureDependence;
  let code: string | null;
  try {
    code = generateDerivationCode(strategy, ctx, typeName, meta);
  } catch (e) {
    if (!(e instanceof DerivationRefused)) throw e;
    trace.push({
      step: "code-generation",
      target: `${typeclassName}<${typeName}>`,
      result: "rejected",
      reason: e.reason,
    });
    return { expression: null, trace };
  }
  const dependsOnScope = scopeDependence !== before;
  // Output that depends on nested types' structure isn't determined by the
  // disk-cache key (top-level field type TEXT): in memory only.
  const dependsOnStructure = structureDependence !== beforeStructure;
  if (!code) {
    trace.push({
      step: "code-generation",
      target: `${typeclassName}<${typeName}>`,
      result: "rejected",
      reason: `derivation strategy returned null for ${meta.kind} type`,
    });
    return { expression: null, trace };
  }

  // Scope-dependent output (field instances resolved from this file's scope,
  // possibly with an import injected into THIS pass's context) is not cached
  // at all: a cache hit in a later transform of the same file would reuse the
  // reference without re-registering its import.
  if (!dependsOnScope) {
    caches.derivation.set(memKey, code);
    if (diskCache && diskKey && !dependsOnStructure) diskCache.set(diskKey, code);
  }

  trace.push({
    step: "code-generation",
    target: `${typeclassName}<${typeName}>`,
    result: "found",
  });

  return { expression: parseDerivedExpression(ctx, code), trace };
}

/**
 * Thrown by a derivation strategy that can see the type cannot be derived
 * soundly (a class with `#private` members has no field-wise Clone): the
 * reason becomes the trace entry, so the TS9106 the caller reports says why.
 */
export class DerivationRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "DerivationRefused";
  }
}

/**
 * Generate derivation code using the strategy, dispatching on product/sum kind.
 */
function generateDerivationCode(
  strategy: GenericDerivation,
  ctx: MacroContext,
  typeName: string,
  meta: GenericMeta
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
 * Does not generate code — just checks feasibility against REGISTERED
 * Generic metadata (`@derive(Generic)` / `registerGenericMeta`); without a
 * MacroContext there is no type checker to synthesize a mirror from.
 */
export function canDeriveViaGeneric(typeclassName: string, typeName: string): boolean {
  const strategy = genericDerivations.get(typeclassName);
  if (!strategy) return false;

  const meta = getGenericMeta(typeName);
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

/** Data (non-method) properties of a type, with their types. */
function dataProperties(
  ctx: MacroContext,
  type: ts.Type,
  warn: boolean
): Array<{ name: string; type: ts.Type; optional: boolean }> {
  const checker = ctx.typeChecker;
  const out: Array<{ name: string; type: ts.Type; optional: boolean }> = [];
  for (const prop of type.getProperties()) {
    const propType = checker.getTypeOfSymbolAtLocation(
      prop,
      prop.valueDeclaration ?? ctx.sourceFile
    );
    // Skip methods — they're behavior, not data.
    if (propType.getCallSignatures().length > 0) continue;
    if (warn && !ctx.isTypeReliable(propType)) {
      ctx.reportWarning(
        prop.valueDeclaration ?? ctx.sourceFile,
        `field '${prop.name}' has type 'any' (possibly unresolved) — derived instance may be incorrect`
      );
    }
    out.push({
      name: prop.name,
      type: propType,
      optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
    });
  }
  return out;
}

/**
 * Synthesize a Mirror (GenericMeta) from the TypeChecker.
 *
 * Analogous to how Scala 3 automatically provides Mirror.ProductOf for
 * case classes — no annotation needed, the compiler just knows the structure.
 */
function extractMetaFromSymbol(
  ctx: MacroContext,
  typeName: string,
  typeSymbol: ts.Symbol,
  concreteType?: ts.Type
): GenericMeta | null {
  const typeChecker = ctx.typeChecker;
  const type = concreteType ?? typeChecker.getDeclaredTypeOfSymbol(typeSymbol);

  // Discriminated union (sum type): EVERY member must carry the same
  // string-literal discriminant. A union without one is not derivable —
  // treating it as a product of its common properties would compare only
  // those (e.g. only `kind`) and silently call different values equal.
  if (type.isUnion()) {
    const unionTypes = type.types;
    const candidates = type.getProperties().map((p) => p.name);
    let discriminant: string | undefined;
    for (const fname of candidates) {
      const allLiteral = unionTypes.every((ut) => {
        const prop = ut.getProperty(fname);
        if (!prop) return false;
        const propType = typeChecker.getTypeOfSymbolAtLocation(
          prop,
          prop.valueDeclaration ?? ctx.sourceFile
        );
        return propType.isStringLiteral();
      });
      if (allLiteral) {
        discriminant = fname;
        break;
      }
    }
    if (!discriminant) return null;

    const variants = unionTypes.map((ut) => {
      const discProp = ut.getProperty(discriminant!)!;
      const discType = typeChecker.getTypeOfSymbolAtLocation(
        discProp,
        discProp.valueDeclaration ?? ctx.sourceFile
      );
      const tag = (discType as ts.StringLiteralType).value;
      // Variant type name — the symbol name when it has one; inline literal
      // variants get a synthesized display name (never referenced as a value).
      const variantTypeName =
        ut.symbol?.name && ut.symbol.name !== "__type" ? ut.symbol.name : `${typeName}_${tag}`;
      return { tag, typeName: variantTypeName };
    });
    const common = dataProperties(ctx, type, false);
    const meta: GenericMeta = {
      kind: "sum" as const,
      discriminant,
      variants,
      fieldNames: common.map((p) => p.name),
      fieldTypes: common.map((p) => typeChecker.typeToString(p.type)),
    };
    mirrorTypes.set(meta, {
      fieldTypes: common.map((p) => p.type),
      optional: common.map((p) => p.optional),
      variantTypes: [...unionTypes],
      self: type,
    });
    return meta;
  }

  const props = dataProperties(ctx, type, true);
  // If all properties were methods (no data fields), derivation isn't possible
  if (props.length === 0) return null;

  const meta: GenericMeta = {
    kind: "product",
    fieldNames: props.map((p) => p.name),
    fieldTypes: props.map((p) => typeChecker.typeToString(p.type)),
  };
  mirrorTypes.set(meta, {
    fieldTypes: props.map((p) => p.type),
    optional: props.map((p) => p.optional),
    self: type,
  });
  return meta;
}

// ============================================================================
// Field-level code generation helpers (string codegen: the derivation cache
// stores strings — the auto-derive.ts exception in CLAUDE.md)
// ============================================================================

/**
 * Per strategy that builds each field from its `ts.Type` (Eq, Semigroup,
 * Monoid): can it build a field of this type? Each probe runs the generator
 * itself, without side effects (no import injected), so the field check
 * accepts exactly what code generation can emit.
 */
const FIELD_PROBES: Record<string, (ctx: MacroContext, t: ts.Type) => boolean> = {
  Eq: (ctx, t) => eqExpr(ctx, t, "a", "b", true) !== null,
  Semigroup: (ctx, t) => combineExpr(ctx, "Semigroup", t, "a", "b", true) !== null,
  Monoid: (ctx, t) =>
    combineExpr(ctx, "Monoid", t, "a", "b", true) !== null && emptyExpr(ctx, t, true) !== null,
};

/** Strategies whose sum derivation compares each variant's fields inline. */
const SUM_FIELD_PROBES = new Set(["Eq"]);

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

/** `a.name`, or `a["content-type"]` for a key that isn't an identifier. */
function access(obj: string, name: string): string {
  return IDENT_RE.test(name) ? `${obj}.${name}` : `${obj}[${JSON.stringify(name)}]`;
}

/** An object-literal key: `name` or `"content-type"`. */
function objKey(name: string): string {
  return IDENT_RE.test(name) ? name : JSON.stringify(name);
}

const PRIMITIVE_FLAGS =
  ts.TypeFlags.NumberLike |
  ts.TypeFlags.StringLike |
  ts.TypeFlags.BooleanLike |
  ts.TypeFlags.BigIntLike |
  ts.TypeFlags.ESSymbolLike |
  ts.TypeFlags.EnumLike |
  ts.TypeFlags.Null |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Void;

function isNullish(t: ts.Type): boolean {
  return (t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0;
}

/** Split `T | null | undefined` into its non-nullish part and whether it was nullable. */
function splitNullable(ctx: MacroContext, t: ts.Type): { base: ts.Type; nullable: boolean } {
  if (t.isUnion() && t.types.some(isNullish)) {
    return { base: ctx.typeChecker.getNonNullableType(t), nullable: true };
  }
  return { base: t, nullable: isNullish(t) };
}

/**
 * Every constituent is a primitive/literal/enum type (`===`-comparable), or a
 * branded primitive. Decided by the checker's type flags, not by name.
 */
function isPrimitiveLike(t: ts.Type): boolean {
  if (t.isUnion()) return t.types.every(isPrimitiveLike);
  return (t.flags & PRIMITIVE_FLAGS) !== 0 || isBrandedPrimitive(t);
}

/**
 * A primitive intersected with an object type: a brand
 * (`number & { readonly __brand: "ProductId" }`, typesugar's `Newtype`,
 * `string & {}`). Its values ARE primitives (the object part is phantom), so
 * `===` compares them and a copy is the value itself. Spreading one as an
 * object (`{ ...id }`) would turn the number into `{}`.
 */
function isBrandedPrimitive(t: ts.Type): boolean {
  return t.isIntersection() && t.types.some((m) => (m.flags & PRIMITIVE_FLAGS) !== 0);
}

/** Element type of `T[]` / `Array<T>` / `ReadonlyArray<T>`, if `t` is one. */
function arrayElementType(ctx: MacroContext, t: ts.Type): ts.Type | undefined {
  const name = t.symbol?.name;
  if ((name === "Array" || name === "ReadonlyArray") && (t as ts.TypeReference).target) {
    return ctx.typeChecker.getTypeArguments(t as ts.TypeReference)[0];
  }
  return undefined;
}

/** Does `t`'s declaration carry `@derive(TC)` / `@deriving(TC)`? */
function declaresDerive(t: ts.Type, tc: string): ts.Declaration | undefined {
  const sym = t.aliasSymbol ?? t.symbol;
  for (const d of sym?.declarations ?? []) {
    for (const tag of ts.getJSDocTags(d)) {
      const n = tag.tagName.text;
      if (n !== "derive" && n !== "deriving") continue;
      // The shared parser: the tag's list only, never prose after it.
      if (isJSDocTagAtLineStart(tag) && deriveTagNames(tag).includes(tc)) return d;
    }
    if (ts.canHaveDecorators(d)) {
      for (const dec of ts.getDecorators(d) ?? []) {
        const e = dec.expression;
        if (
          ts.isCallExpression(e) &&
          ts.isIdentifier(e.expression) &&
          (e.expression.text === "derive" || e.expression.text === "deriving") &&
          e.arguments.some((a) => ts.isIdentifier(a) && a.text === tc)
        ) {
          return d;
        }
      }
    }
  }
  return undefined;
}

/** Is `name` bound in `sf` as a VALUE import (not `import type`)? */
function valueImportOf(sf: ts.SourceFile, name: string): boolean {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause || stmt.importClause.isTypeOnly) {
      continue;
    }
    const nb = stmt.importClause.namedBindings;
    if (
      nb &&
      ts.isNamedImports(nb) &&
      nb.elements.some((e) => !e.isTypeOnly && e.name.text === name)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Code text referencing an instance of `tc` for the (non-nullish) type `t`,
 * as seen from `ctx.sourceFile`: an in-scope `@impl`/`@instance` value
 * (imported on demand for a module-scan hit), or the `Type.TC` companion of
 * a `@derive(TC)` type that is declared in this file or value-imported into
 * it. Returns undefined when nothing suitable is in scope.
 */
function fieldInstanceRef(
  ctx: MacroContext,
  tc: string,
  t: ts.Type,
  /** Only check availability: no import is injected, scope use not recorded. */
  probe = false,
  /** Look up `t` as written, `null`/`undefined` included (default: its non-nullish part). */
  exact = false
): string | undefined {
  const base = exact ? t : splitNullable(ctx, t).base;
  try {
    const r = resolveInstance(ctx, tc, base);
    if (r && r.kind === "resolved") {
      if (probe) return r.localName ?? r.exportName;
      scopeDependence++;
      return printRef(buildInstanceReference(ctx, r));
    }
  } catch (e) {
    ctx.reportWarning(
      ctx.sourceFile,
      `derive: instance lookup for ${tc}<${ctx.typeChecker.typeToString(base)}> failed ` +
        `(${e instanceof Error ? e.message : String(e)}); trying the @derive companion instead.`
    );
  }
  const decl = declaresDerive(base, tc);
  const name = (base.aliasSymbol ?? base.symbol)?.name;
  if (decl && name && IDENT_RE.test(name)) {
    const sameFile = decl.getSourceFile().fileName === ctx.sourceFile.fileName;
    if (sameFile || valueImportOf(ctx.sourceFile, name)) {
      if (!probe) scopeDependence++;
      return `${name}.${tc}`;
    }
  }
  return undefined;
}

function printRef(e: ts.Expression): string {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return `${printRef(e.expression)}.${e.name.text}`;
  return ts
    .createPrinter()
    .printNode(ts.EmitHint.Expression, e, ts.createSourceFile("", "", ts.ScriptTarget.Latest));
}

let lambdaDepth = 0;

/**
 * Equality expression for two field values `x`/`y` of type `t` — inlined
 * `===` for primitives, element-wise for arrays, an in-scope Eq instance
 * otherwise; nullable values are guarded. Returns null when no Eq is
 * available.
 */
function eqExpr(
  ctx: MacroContext,
  t: ts.Type,
  x: string,
  y: string,
  /** Only check that a comparison can be built: no import injected. */
  probe = false
): string | null {
  const { base, nullable } = splitNullable(ctx, t);
  if (isPrimitiveLike(t)) return `${x} === ${y}`;
  // An instance for the type as written, null included (`Eq<GeoJsonProperties>`
  // for `{ [k: string]: any } | null`), compares it whole.
  if (nullable && !arrayLikeElementTypes(ctx, base)) {
    const exact = fieldInstanceRef(ctx, "Eq", t, probe, true);
    if (exact) return `${exact}.equals(${x}, ${y})`;
  }
  let inner: string | null;
  const elems = arrayLikeElementTypes(ctx, base);
  if (elems) {
    // Arrays, tuples, and unions of them (GeoJSON's BBox): same length, and
    // equal element by element. Elements of several types are all compared
    // by one expression, so they must all be primitive.
    const elem = elems.length === 1 ? elems[0] : undefined;
    // Inside the callback, TypeScript no longer narrows a nullable `y` by the
    // `!= null` guard around it.
    const yi = `${nullable ? `${y}!` : y}[__i${lambdaDepth}]`;
    const d = lambdaDepth++;
    try {
      const e = elem
        ? eqExpr(ctx, elem, `__e${d}`, yi, probe)
        : elems.every(isPrimitiveLike)
          ? `__e${d} === ${yi}`
          : null;
      inner =
        e === null
          ? null
          : `(${x}.length === ${y}.length && ${x}.every((__e${d}, __i${d}) => ${e}))`;
    } finally {
      lambdaDepth--;
    }
  } else if (isPrimitiveLike(base)) {
    inner = `${x} === ${y}`;
  } else {
    const ref = fieldInstanceRef(ctx, "Eq", base, probe);
    inner = ref ? `${ref}.equals(${x}, ${y})` : null;
  }
  if (inner === null) return null;
  return nullable ? `(${x} === ${y} || (${x} != null && ${y} != null && ${inner}))` : inner;
}

/**
 * The element types of an array, a tuple, or a union of arrays and tuples
 * (distinct types, in order), or undefined when `t` is none of these.
 */
function arrayLikeElementTypes(ctx: MacroContext, t: ts.Type): ts.Type[] | undefined {
  const members = t.isUnion() ? t.types : [t];
  const out: ts.Type[] = [];
  for (const m of members) {
    const elem = arrayElementType(ctx, m);
    const elems = elem
      ? [elem]
      : ctx.typeChecker.isTupleType(m)
        ? ctx.typeChecker.getTypeArguments(m as ts.TypeReference)
        : undefined;
    if (!elems) return undefined;
    for (const e of elems) if (!out.includes(e)) out.push(e);
  }
  return out.length > 0 ? out : undefined;
}

/** String fallback (registered GenericMeta without ts.Types). */
function stripNullableText(ft: string): string {
  return ft
    .replace(/\s*\|\s*null\s*/g, "")
    .replace(/\s*null\s*\|\s*/g, "")
    .replace(/\s*\|\s*undefined\s*/g, "")
    .replace(/\s*undefined\s*\|\s*/g, "")
    .trim();
}

const PRIMITIVE_NAMES = new Set([
  "number",
  "string",
  "boolean",
  "bigint",
  "symbol",
  "null",
  "undefined",
]);

/** Field equality from a type STRING (registered meta) — primitives/arrays only. */
function eqExprFromText(ft: string, x: string, y: string): string | null {
  const stripped = stripNullableText(ft);
  if (PRIMITIVE_NAMES.has(stripped)) return `${x} === ${y}`;
  const m =
    /^(?:readonly\s+)?(.+)\[\]$/.exec(stripped) ?? /^(?:Readonly)?Array<(.+)>$/.exec(stripped);
  if (m) {
    const d = lambdaDepth++;
    try {
      const e = eqExprFromText(m[1].trim(), `__e${d}`, `${y}[__i${d}]`);
      if (e === null) return null;
      const inner = `(${x}.length === ${y}.length && ${x}.every((__e${d}, __i${d}) => ${e}))`;
      return stripped === ft.trim()
        ? inner
        : `(${x} === ${y} || (${x} != null && ${y} != null && ${inner}))`;
    } finally {
      lambdaDepth--;
    }
  }
  return null;
}

/** Per-field equality, preferring the mirror's ts.Types. */
function fieldEq(
  ctx: MacroContext,
  meta: GenericMeta,
  i: number,
  name: string,
  types: ts.Type[] | undefined
): string | null {
  const x = access("a", name);
  const y = access("b", name);
  if (types) return eqExpr(ctx, types[i], x, y);
  return eqExprFromText(meta.fieldTypes![i], x, y);
}

/** Data fields of a sum variant, excluding the discriminant. */
function variantFields(
  ctx: MacroContext,
  vt: ts.Type,
  discriminant: string
): Array<{ name: string; type: ts.Type; optional: boolean }> {
  return dataProperties(ctx, vt, false).filter((p) => p.name !== discriminant);
}

/** Combine expression for Semigroup/Monoid fields. */
function combineExpr(
  ctx: MacroContext,
  tc: string,
  t: ts.Type,
  x: string,
  y: string,
  /** Only check that a combination can be built: no import injected. */
  probe = false
): string | null {
  const { base, nullable } = splitNullable(ctx, t);
  let inner: string | null;
  if (base.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BigIntLike)) inner = `${x} + ${y}`;
  else if (base.flags & ts.TypeFlags.StringLike) inner = `${x} + ${y}`;
  else if (base.flags & ts.TypeFlags.BooleanLike) inner = `(${x} && ${y})`;
  else if (arrayElementType(ctx, base)) inner = `[...${x}, ...${y}]`;
  else {
    const ref = fieldInstanceRef(ctx, tc, base, probe);
    inner = ref ? `${ref}.combine(${x}, ${y})` : null;
  }
  if (inner === null) return null;
  return nullable ? `(${x} == null ? ${y} : ${y} == null ? ${x} : ${inner})` : inner;
}

function combineExprFromText(ft: string, x: string, y: string): string | null {
  const stripped = stripNullableText(ft);
  let inner: string | null = null;
  if (stripped === "number" || stripped === "string" || stripped === "bigint")
    inner = `${x} + ${y}`;
  else if (stripped === "boolean") inner = `(${x} && ${y})`;
  else if (stripped.endsWith("[]") || /^(?:Readonly)?Array</.test(stripped))
    inner = `[...${x}, ...${y}]`;
  if (inner === null) return null;
  return stripped === ft.trim() ? inner : `(${x} == null ? ${y} : ${y} == null ? ${x} : ${inner})`;
}

function emptyExpr(ctx: MacroContext, t: ts.Type, probe = false): string | null {
  const { base, nullable } = splitNullable(ctx, t);
  if (nullable) return "undefined";
  if (base.flags & ts.TypeFlags.NumberLike) return "0";
  if (base.flags & ts.TypeFlags.BigIntLike) return "0n";
  if (base.flags & ts.TypeFlags.StringLike) return '""';
  if (base.flags & ts.TypeFlags.BooleanLike) return "true";
  if (arrayElementType(ctx, base)) return "[]";
  const ref = fieldInstanceRef(ctx, "Monoid", base, probe);
  return ref ? `${ref}.empty()` : null;
}

function emptyExprFromText(ft: string): string | null {
  const stripped = stripNullableText(ft);
  if (stripped !== ft.trim()) return "undefined";
  if (stripped === "number") return "0";
  if (stripped === "bigint") return "0n";
  if (stripped === "string") return '""';
  if (stripped === "boolean") return "true";
  if (stripped.endsWith("[]") || /^(?:Readonly)?Array</.test(stripped)) return "[]";
  return null;
}

// ============================================================================
// Built-in Derivation Strategies
// ============================================================================

/**
 * Helper to check if a type string represents a type with a known primitive
 * instance for a given typeclass.
 */
export function makePrimitiveChecker(
  primitiveTypes: ReadonlySet<string>
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

  hasFieldInstance: makePrimitiveChecker(new Set(["number", "string", "boolean", "bigint"])),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;

    const parts = meta.fieldNames.map((name, i) => {
      const showExpr = showFieldExpr(meta.fieldTypes![i], access("a", name));
      if (!showExpr) return null;
      return `\`${name} = \${${showExpr}}\``;
    });

    if (parts.some((p) => p === null)) return null;

    return `({ show: (a: ${typeName}) => \`${typeName}(\${[${parts.join(", ")}].join(", ")})\` })`;
  },

  deriveSum(ctx, typeName, meta) {
    if (!meta.variants || !meta.discriminant) return null;

    const cases = meta.variants
      .map((v) => `case ${JSON.stringify(v.tag)}: return \`${v.tag}(\${JSON.stringify(a)})\``)
      .join("; ");

    return `({ show: (a: ${typeName}) => { switch (${access("(a as any)", meta.discriminant)}) { ${cases}; default: return String(a) } } })`;
  },
});

// Eq derivation via Generic
registerGenericDerivation("Eq", {
  typeclassName: "Eq",
  fieldTypeclass: "Eq",

  hasFieldInstance: makePrimitiveChecker(
    new Set(["number", "string", "boolean", "bigint", "symbol", "null", "undefined"])
  ),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;
    const types = mirrorTypes.get(meta)?.fieldTypes;

    const checks: string[] = [];
    for (let i = 0; i < meta.fieldNames.length; i++) {
      const c = fieldEq(ctx, meta, i, meta.fieldNames[i], types);
      if (c === null) return null;
      checks.push(c);
    }

    const body = checks.length > 0 ? checks.join(" && ") : "true";
    return `({ equals: (a: ${typeName}, b: ${typeName}): boolean => ${body}, notEquals: (a: ${typeName}, b: ${typeName}): boolean => !(${body}) })`;
  },

  deriveSum(ctx, typeName, meta) {
    if (!meta.variants || !meta.discriminant) return null;
    const variantTypes = mirrorTypes.get(meta)?.variantTypes;
    if (!variantTypes) return null;
    const disc = meta.discriminant;

    const cases: string[] = [];
    for (let vi = 0; vi < meta.variants.length; vi++) {
      const v = meta.variants[vi];
      const vt = variantTypes[vi];
      // An Eq instance for the variant type in scope wins; otherwise compare
      // the variant's fields inline (no per-variant companion is generated).
      const ref = fieldInstanceRef(ctx, "Eq", vt);
      if (ref) {
        cases.push(`case ${JSON.stringify(v.tag)}: return ${ref}.equals(a as any, b as any);`);
        continue;
      }
      // The variant's fields, through locals of the variant's type, so each
      // comparison is type-checked (and array callbacks are typed).
      const fields = variantFields(ctx, vt, disc);
      const checks: string[] = [];
      for (const f of fields) {
        const c = eqExpr(ctx, f.type, access("__a", f.name), access("__b", f.name));
        if (c === null) return null;
        checks.push(c);
      }
      cases.push(
        checks.length === 0
          ? `case ${JSON.stringify(v.tag)}: return true;`
          : `case ${JSON.stringify(v.tag)}: { const __a = a as Extract<${typeName}, { ${objKey(disc)}: ${JSON.stringify(v.tag)} }>; ` +
              `const __b = b as typeof __a; return ${checks.join(" && ")}; }`
      );
    }

    const tagA = access("(a as any)", disc);
    const tagB = access("(b as any)", disc);
    return `(() => { const equals = (a: ${typeName}, b: ${typeName}): boolean => { if (${tagA} !== ${tagB}) return false; switch (${tagA}) { ${cases.join(" ")} default: return false; } }; return { equals, notEquals: (a: ${typeName}, b: ${typeName}): boolean => !equals(a, b) }; })()`;
  },
});

// Ord derivation via Generic (lexicographic)
registerGenericDerivation("Ord", {
  typeclassName: "Ord",
  fieldTypeclass: "Ord",

  hasFieldInstance: makePrimitiveChecker(new Set(["number", "string", "boolean", "bigint"])),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames) return null;
    return ordFromCompare(typeName, `${lexCompare(meta.fieldNames, "a", "b")} return 0;`);
  },

  deriveSum(ctx, typeName, meta) {
    if (!meta.variants || !meta.discriminant) return null;
    const variantTypes = mirrorTypes.get(meta)?.variantTypes;
    if (!variantTypes) return null;
    const disc = meta.discriminant;
    const tagOrder = meta.variants.map((v, i) => `${JSON.stringify(v.tag)}: ${i}`).join(", ");
    const cases: string[] = [];
    for (let vi = 0; vi < meta.variants.length; vi++) {
      const v = meta.variants[vi];
      const vt = variantTypes[vi];
      const ref = fieldInstanceRef(ctx, "Ord", vt);
      if (ref) {
        cases.push(`case ${JSON.stringify(v.tag)}: return ${ref}.compare(a as any, b as any)`);
        continue;
      }
      const fields = variantFields(ctx, vt, disc);
      if (!fields.every((f) => isPrimitiveLike(splitNullable(ctx, f.type).base))) return null;
      cases.push(
        `case ${JSON.stringify(v.tag)}: { ${lexCompare(
          fields.map((f) => f.name),
          "(a as any)",
          "(b as any)"
        )} return 0; }`
      );
    }
    const tagA = access("(a as any)", disc);
    const tagB = access("(b as any)", disc);
    return ordFromCompare(
      typeName,
      `const tagOrder: Record<string, number> = { ${tagOrder} }; const ta = tagOrder[${tagA}] ?? 0; const tb = tagOrder[${tagB}] ?? 0; if (ta !== tb) return ta < tb ? -1 : 1; switch (${tagA}) { ${cases.join("; ")}; default: return 0; }`
    );
  },
});

// Hash derivation via Generic
registerGenericDerivation("Hash", {
  typeclassName: "Hash",
  fieldTypeclass: "Hash",

  hasFieldInstance: makePrimitiveChecker(new Set(["number", "string", "boolean", "bigint"])),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;

    const hashSteps = meta.fieldNames.map((name, i) => {
      const hashExpr = primitiveHashExpr(meta.fieldTypes![i], access("a", name));
      if (!hashExpr) return null;
      return `h = ((h << 5) + h) ^ (${hashExpr})`;
    });

    if (hashSteps.some((s) => s === null)) return null;

    return `({ hash: (a: ${typeName}): number => { let h = 0; ${hashSteps.join("; ")}; return h >>> 0; } })`;
  },

  deriveSum(ctx, typeName, meta) {
    if (!meta.variants || !meta.discriminant) return null;
    const variantTypes = mirrorTypes.get(meta)?.variantTypes;
    if (!variantTypes) return null;
    const disc = meta.discriminant;
    const cases: string[] = [];
    for (let vi = 0; vi < meta.variants.length; vi++) {
      const v = meta.variants[vi];
      const vt = variantTypes[vi];
      const seed = vi * 2654435761;
      const ref = fieldInstanceRef(ctx, "Hash", vt);
      if (ref) {
        cases.push(`case ${JSON.stringify(v.tag)}: return (${seed} ^ ${ref}.hash(a as any)) >>> 0`);
        continue;
      }
      const steps: string[] = [];
      for (const f of variantFields(ctx, vt, disc)) {
        const e = primitiveHashExpr(
          ctx.typeChecker.typeToString(f.type),
          access("(a as any)", f.name)
        );
        if (!e) return null;
        steps.push(`h = ((h << 5) + h) ^ (${e})`);
      }
      cases.push(
        `case ${JSON.stringify(v.tag)}: { let h = ${seed}; ${steps.join("; ")}; return h >>> 0; }`
      );
    }
    return `({ hash: (a: ${typeName}): number => { switch (${access("(a as any)", disc)}) { ${cases.join("; ")}; default: return 0; } } })`;
  },
});

// ============================================================================
// Clone derivation via Generic: field-wise, like Rust's #[derive(Clone)]
// ============================================================================
//
// Each field is cloned through its own Clone: primitives (and functions) are
// copied as they are, arrays and tuples element by element, Date/Map/Set into
// new ones, a type with a Clone instance in scope (`@impl`, or a `@derive`
// companion) through that instance, and any other object type or
// discriminated union structurally, by these same rules, in place. `any`,
// `unknown`, `object` and type parameters name no type to clone by, so they
// are copied by reference (an in-scope `Clone<any>`/`Clone<unknown>` instance
// is used if there is one).
//
// The copy starts as a spread, `{ ...a }`, and overrides only the fields that
// need cloning. So an absent optional field stays absent (it is overridden
// only when present: `...(a.bbox && { bbox: ... })`), and properties the type
// doesn't declare (GeoJSON "foreign members") are kept, by reference.
//
// A discriminated union becomes a local helper with a `switch`, and so does a
// type that contains itself (found when its own clone is being generated, so
// derivation never recurses forever); the instance is then an IIFE that
// declares the helpers. Nothing is looked up at run time: an instance in
// scope is referenced directly, and everything else is inlined.

/** Lib types copied with a known expression (anything else from the lib: as is). */
const CLONE_TYPED_ARRAYS = new Set([
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

/** Nested types inlined before giving up (a generic type that grows, `L<T[]>`). */
const MAX_CLONE_DEPTH = 32;

const ENTITY_NAME_RE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

/** State for generating one Clone instance. */
interface CloneGen {
  ctx: MacroContext;
  /** What the derivation is for, as the user wrote it (`Feature`). */
  rootTypeName: string;
  /** Hoisted helpers (`const cloneGeometry = <fn>;`), in creation order. */
  helpers: Array<{ name: string; fn: string }>;
  /** References to each helper in generated code. */
  helperRefs: Map<string, number>;
  /** Helper name per type: discriminated unions, and types that contain themselves. */
  helperNames: Map<ts.Type, string>;
  /** Product types whose inline clone is being generated (recursion detection). */
  inProgress: ts.Type[];
  /** Names that a generated name must not shadow (the user file's identifiers). */
  taken: Set<string>;
  /** Lambda nesting depth: parameters are `e`, `e1`, `e2`, ... */
  depth: number;
  /** Warnings already reported (each once). */
  warned: Set<string>;
  /** Type symbols visible in the user's file, by name (lazily computed). */
  scopeTypes?: Map<string, ts.Symbol>;
}

function identifiersOf(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>();
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) out.add(n.text);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}

/** A call to helper `name` (counted, so an unreferenced root helper can be inlined). */
function helperCall(g: CloneGen, name: string, x: string): string {
  g.helperRefs.set(name, (g.helperRefs.get(name) ?? 0) + 1);
  return `${name}(${x})`;
}

function cloneWarn(g: CloneGen, message: string): void {
  if (g.warned.has(message)) return;
  g.warned.add(message);
  g.ctx.reportWarning(g.ctx.sourceFile, `derived Clone<${g.rootTypeName}>: ${message}`);
}

/** A name for a lambda parameter at the current depth (`e`, `e1`, ...; `k`, `v` for entries). */
function lambdaName(g: CloneGen, base: string): string {
  let name = g.depth === 0 ? base : `${base}${g.depth}`;
  while (g.taken.has(name)) name = `${name}_`;
  return name;
}

/**
 * `(e) => <clone of e>`, or undefined when the element is copied as is. A
 * clone that is just a helper call is passed point-free: `.map(cloneGeometry)`.
 */
function cloneLambda(g: CloneGen, elem: ts.Type, path: string): string | undefined {
  const p = lambdaName(g, "e");
  g.depth++;
  let body: string | undefined;
  try {
    body = cloneValue(g, elem, p, path);
  } finally {
    g.depth--;
  }
  if (body === undefined) return undefined;
  for (const helper of g.helperNames.values()) {
    if (body === `${helper}(${p})`) return helper;
  }
  return `(${p}) => ${body.startsWith("{") ? `(${body})` : body}`;
}

/** `typeof x` when `x` can be named in a type query, else the type's path text. */
function typeOfText(x: string, path: string): string {
  return ENTITY_NAME_RE.test(x) ? `typeof ${x}` : path;
}

/** Every constituent is an object (so `x && f(x)` guards exactly null/undefined). */
function isObjectOnly(t: ts.Type): boolean {
  const notObject =
    PRIMITIVE_FLAGS | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter;
  if (t.isUnion())
    return t.types.every((m) => (m.flags & notObject) === 0 && !isBrandedPrimitive(m));
  return (t.flags & notObject) === 0 && !isBrandedPrimitive(t);
}

function isArrayLike(ctx: MacroContext, t: ts.Type): boolean {
  return arrayElementType(ctx, t) !== undefined || ctx.typeChecker.isTupleType(t);
}

/**
 * `t` is an interface or class from TypeScript's default libs (`Date`, `Map`,
 * `Promise`, ...). Lib type ALIASES (`Record`, `Partial`, `Readonly`) are
 * not: they describe ordinary objects, cloned structurally.
 */
function isLibType(ctx: MacroContext, t: ts.Type): boolean {
  return isBuiltinObjectType(ctx.program, t);
}

/**
 * `Clone` instance call for `t` from scope, or undefined. Registry shape
 * (CLAUDE.md "Resolving things a macro just generated"): fieldInstanceRef goes
 * through resolveInstance, which reads the live same-pass `getSynthesized`
 * table, so a `@derive(Clone)` companion generated earlier in this pass is
 * found; its `@derive` fallback reads the type's own declaration, which exists
 * before the pass.
 */
function cloneInstanceCall(g: CloneGen, t: ts.Type, x: string, exact: boolean): string | undefined {
  const ref = fieldInstanceRef(g.ctx, "Clone", t, false, exact);
  return ref ? `${ref}.clone(${x})` : undefined;
}

/**
 * Expression cloning `x` (of type `t`), or undefined when `x` is copied as is.
 * `path` is a type expression for `t` that is valid in the user's file
 * (`Feature["geometry"]`), used where the generated code needs to name `t`.
 */
function cloneValue(g: CloneGen, t: ts.Type, x: string, path: string): string | undefined {
  const { ctx } = g;
  if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
    // Nothing to clone by. An instance declared for `any`/`unknown` is used.
    return cloneInstanceCall(g, t, x, true);
  }
  if (isPrimitiveLike(t)) return undefined;
  const { base, nullable } = splitNullable(ctx, t);
  if (!nullable) return cloneNonNull(g, t, x, path);
  // An instance for the type as written, null included (`Clone<GeoJsonProperties>`
  // for `{ [k: string]: any } | null`), wins over cloning the non-null part.
  if (!isArrayLike(ctx, base)) {
    const exact = cloneInstanceCall(g, t, x, true);
    if (exact) return exact;
  }
  const inner = cloneNonNull(g, base, x, `NonNullable<${path}>`);
  if (inner === undefined) return undefined;
  return isObjectOnly(base) ? `${x} && ${inner}` : `${x} == null ? ${x} : ${inner}`;
}

/** {@link cloneValue} for a type that includes neither `null` nor `undefined`. */
function cloneNonNull(g: CloneGen, t: ts.Type, x: string, path: string): string | undefined {
  const { ctx } = g;
  const checker = ctx.typeChecker;
  if (isPrimitiveLike(t)) return undefined;
  if (
    t.flags &
    (ts.TypeFlags.Any |
      ts.TypeFlags.Unknown |
      ts.TypeFlags.TypeParameter |
      ts.TypeFlags.NonPrimitive |
      ts.TypeFlags.Never)
  ) {
    // `any`/`unknown` reach here inside a union; `T` and `object` name no shape.
    return t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)
      ? cloneInstanceCall(g, t, x, true)
      : undefined;
  }
  if (t.getCallSignatures().length > 0) return undefined; // functions: shared, like Rc

  // Arrays and tuples: element-wise, through the element type's Clone.
  const elem = arrayElementType(ctx, t);
  if (elem) {
    const fn = cloneLambda(g, elem, `${path}[number]`);
    return fn === undefined ? `${x}.slice()` : `${x}.map(${fn})`;
  }
  if (checker.isTupleType(t)) return cloneTuple(g, t as ts.TupleTypeReference, x, path);

  if (t.isUnion()) {
    // A union with an instance in scope (`derived<Clone<Geometry>>()`) is
    // cloned through it, like any other type that has one.
    return cloneInstanceCall(g, t, x, false) ?? cloneUnion(g, t, x, path);
  }

  // Built-in object types.
  if (isLibType(ctx, t)) {
    const name = t.symbol.name;
    if (name === "Date") return `new Date(${x}.getTime())`;
    if (name === "RegExp") return `new RegExp(${x})`;
    if (name === "ArrayBuffer") return `${x}.slice(0)`;
    if (CLONE_TYPED_ARRAYS.has(name)) return `${x}.slice()`;
    const args = (t as ts.TypeReference).target
      ? checker.getTypeArguments(t as ts.TypeReference)
      : [];
    if ((name === "Map" || name === "ReadonlyMap") && args.length === 2) {
      // Keys are kept (a Map is looked up by key identity); values are cloned.
      const k = lambdaName(g, "k");
      const v = lambdaName(g, "v");
      g.depth++;
      let cv: string | undefined;
      try {
        cv = cloneValue(g, args[1], v, `(${path} extends ReadonlyMap<any, infer V> ? V : never)`);
      } finally {
        g.depth--;
      }
      return cv === undefined
        ? `new Map(${x})`
        : `new Map(Array.from(${x}, ([${k}, ${v}]) => [${k}, ${cv}] as const))`;
    }
    if ((name === "Set" || name === "ReadonlySet") && args.length === 1) {
      const fn = cloneLambda(g, args[0], `(${path} extends ReadonlySet<infer E> ? E : never)`);
      return fn === undefined ? `new Set(${x})` : `new Set(Array.from(${x}, ${fn}))`;
    }
    return undefined; // Promise, Error, WeakMap, ...: copied as is
  }

  // A Clone instance in scope (`@impl`, `@derive` companion) clones the type.
  const viaInstance = cloneInstanceCall(g, t, x, false);
  if (viaInstance) return viaInstance;

  const sym = t.aliasSymbol ?? t.symbol;
  if (sym && sym.flags & ts.SymbolFlags.Class) {
    cloneWarn(
      g,
      `'${checker.typeToString(t)}' is a class with no Clone instance in scope, so it is ` +
        `copied by reference. Give it one (@derive(Clone), or an @impl Clone<${sym.name}>) to clone it.`
    );
    return undefined;
  }
  return cloneProduct(g, t, x, path);
}

/** A tuple: a fixed one element by element, otherwise through `.slice()`/`.map`. */
function cloneTuple(
  g: CloneGen,
  t: ts.TupleTypeReference,
  x: string,
  path: string
): string | undefined {
  const checker = g.ctx.typeChecker;
  const elems = checker.getTypeArguments(t);
  const fixed = t.target.elementFlags.every((f) => (f & ts.ElementFlags.Required) !== 0);
  const cast = typeOfText(x, path);
  if (fixed) {
    const clones = elems.map((et, i) => cloneValue(g, et, `${x}[${i}]`, `${path}[${i}]`));
    if (clones.every((c) => c === undefined)) return `${x}.slice() as ${cast}`;
    return `[${clones.map((c, i) => c ?? `${x}[${i}]`).join(", ")}] as ${cast}`;
  }
  const union = elems.length === 1 ? elems[0] : undefined;
  const fn = union
    ? cloneLambda(g, union, `${path}[number]`)
    : elems.every((et) => isPrimitiveLike(et))
      ? undefined
      : null;
  if (fn === undefined) return `${x}.slice() as ${cast}`;
  if (fn === null) {
    cloneWarn(
      g,
      `a tuple with optional or rest elements of different types ('${checker.typeToString(t)}') ` +
        `is copied with .slice(); its elements are not cloned.`
    );
    return `${x}.slice() as ${cast}`;
  }
  return `${x}.map(${fn}) as ${cast}`;
}

/** The property every member of `t` has with a string-literal type, if any. */
function cloneDiscriminant(ctx: MacroContext, members: readonly ts.Type[]): string | undefined {
  const checker = ctx.typeChecker;
  const first = members[0];
  if (!first) return undefined;
  for (const p of first.getProperties()) {
    const ok = members.every((m) => {
      const prop = m.getProperty(p.name);
      if (!prop) return false;
      return checker
        .getTypeOfSymbolAtLocation(prop, prop.valueDeclaration ?? ctx.sourceFile)
        .isStringLiteral();
    });
    if (ok) return p.name;
  }
  return undefined;
}

/** A union without null/undefined that has at least one non-primitive member. */
function cloneUnion(g: CloneGen, t: ts.UnionType, x: string, path: string): string | undefined {
  const { ctx } = g;
  const prims = t.types.filter((m) => isPrimitiveLike(m));
  const objs = t.types.filter((m) => !isPrimitiveLike(m));
  if (objs.length === 0) return undefined;
  if (objs.length === 1) {
    const inner = cloneNonNull(g, objs[0], x, path);
    if (inner === undefined) return undefined;
    return prims.length > 0 ? `typeof ${x} === "object" ? ${inner} : ${x}` : inner;
  }
  // `[n, n, n, n] | [n, n, n, n, n, n]` (GeoJSON's BBox), `A[] | B[]`.
  if (objs.every((m) => isArrayLike(ctx, m))) {
    const elementsAsIs = objs.every((m) => {
      const elem = arrayElementType(ctx, m);
      const elems = elem ? [elem] : ctx.typeChecker.getTypeArguments(m as ts.TypeReference);
      return elems.every((e) => isPrimitiveLike(e));
    });
    if (elementsAsIs) {
      const copy = `${x}.slice() as ${typeOfText(x, path)}`;
      return prims.length > 0 ? `Array.isArray(${x}) ? ${copy} : ${x}` : copy;
    }
  } else if (prims.length === 0) {
    const helper = cloneSumHelper(g, t, path);
    if (helper) return helperCall(g, helper, x);
  }
  cloneWarn(
    g,
    `values of type '${ctx.typeChecker.typeToString(t)}' (a union of object types with no ` +
      `string-literal discriminant) are copied by reference.`
  );
  return undefined;
}

/** A type expression for `t` in the user's file: its own name if that is in scope, else `path`. */
function cloneTypeText(g: CloneGen, t: ts.Type, path: string): string {
  const checker = g.ctx.typeChecker;
  const sym = t.aliasSymbol ?? t.symbol;
  const name = sym?.name;
  if (!name || !IDENT_RE.test(name) || name.startsWith("__")) return path;
  // An instantiation (`GeometryCollection<Geometry>`): the bare name may mean
  // a different instantiation, so name it by its path.
  const typeArgs = t.aliasSymbol
    ? t.aliasTypeArguments
    : (t as ts.TypeReference).target
      ? checker.getTypeArguments(t as ts.TypeReference)
      : undefined;
  if (typeArgs?.length) return path;
  if (!g.scopeTypes) {
    g.scopeTypes = new Map();
    try {
      for (const s of checker.getSymbolsInScope(
        g.ctx.sourceFile,
        ts.SymbolFlags.Type | ts.SymbolFlags.Alias
      )) {
        if (!g.scopeTypes.has(s.name)) g.scopeTypes.set(s.name, s);
      }
    } catch {
      /* no scope information: use paths */
    }
  }
  let inScope = g.scopeTypes.get(name);
  if (inScope && inScope.flags & ts.SymbolFlags.Alias) {
    try {
      inScope = checker.getAliasedSymbol(inScope);
    } catch {
      return path;
    }
  }
  return inScope === sym ? name : path;
}

function cloneHelperName(g: CloneGen, t: ts.Type, path: string): string {
  const sym = t.aliasSymbol ?? t.symbol;
  let stem = sym?.name && IDENT_RE.test(sym.name) && !sym.name.startsWith("__") ? sym.name : "";
  if (!stem) {
    const m = /\["([A-Za-z_$][\w$]*)"\][^[]*$/.exec(path);
    stem = m ? m[1] : "Value";
  }
  let name = `clone${stem.charAt(0).toUpperCase()}${stem.slice(1)}`;
  for (let n = 2; g.taken.has(name); n++)
    name = `clone${stem.charAt(0).toUpperCase()}${stem.slice(1)}${n}`;
  g.taken.add(name);
  return name;
}

/**
 * A discriminated union's clone as a helper, `const cloneX = (a: X): X => {
 * switch (a.type) { ... } }`, with one `case` group per distinct variant body.
 * Registered before its body is generated, so a variant that contains the
 * union (a GeometryCollection's `geometries`) calls the helper.
 */
function cloneSumHelper(g: CloneGen, t: ts.UnionType, path: string): string | undefined {
  const existing = g.helperNames.get(t);
  if (existing) return existing;
  const disc = cloneDiscriminant(g.ctx, t.types);
  if (!disc) return undefined;
  const name = cloneHelperName(g, t, path);
  g.helperNames.set(t, name);
  const typeText = cloneTypeText(g, t, path);
  const savedDepth = g.depth;
  g.depth = 0;
  const groups: Array<{ tags: string[]; body: string }> = [];
  try {
    for (const v of t.types) {
      const prop = v.getProperty(disc)!;
      const tag = (
        g.ctx.typeChecker.getTypeOfSymbolAtLocation(
          prop,
          prop.valueDeclaration ?? g.ctx.sourceFile
        ) as ts.StringLiteralType
      ).value;
      const vPath = `Extract<${typeText}, { ${objKey(disc)}: ${JSON.stringify(tag)} }>`;
      const body = cloneProduct(g, v, "a", vPath);
      const group = groups.find((gr) => gr.body === body);
      if (group) group.tags.push(tag);
      else groups.push({ tags: [tag], body });
    }
  } finally {
    g.depth = savedDepth;
  }
  const cases = groups
    .map(
      (gr) => `${gr.tags.map((tag) => `case ${JSON.stringify(tag)}:`).join(" ")} return ${gr.body};`
    )
    .join(" ");
  g.helpers.push({
    name,
    fn: `(a: ${typeText}): ${typeText} => { switch (${access("a", disc)}) { ${cases} } }`,
  });
  return name;
}

/**
 * An object type: `{ ...x, f: <clone of x.f>, ... }`, inline; or a call to a
 * helper when the type contains itself.
 */
function cloneProduct(g: CloneGen, t: ts.Type, x: string, path: string): string {
  const helper = g.helperNames.get(t);
  if (helper) return helperCall(g, helper, x);
  if (g.inProgress.includes(t)) {
    // `t` contains itself: its clone becomes a helper, which the outermost
    // frame for `t` emits once this frame's body is done.
    const name = cloneHelperName(g, t, path);
    g.helperNames.set(t, name);
    return helperCall(g, name, x);
  }
  if (g.inProgress.length >= MAX_CLONE_DEPTH) {
    cloneWarn(
      g,
      `types nest more than ${MAX_CLONE_DEPTH} deep at '${g.ctx.typeChecker.typeToString(t)}'; ` +
        `it is copied with a spread, and its fields are not cloned.`
    );
    return `{ ...${x} }`;
  }
  g.inProgress.push(t);
  let body: string;
  try {
    body = cloneProductBody(g, t, x, path);
  } finally {
    g.inProgress.pop();
  }
  const name = g.helperNames.get(t);
  if (!name) return body;
  // Recursive: emit the helper (its body now calls `name` where `t` recurs).
  const typeText = cloneTypeText(g, t, path);
  const savedDepth = g.depth;
  g.depth = 0;
  g.inProgress.push(t);
  try {
    const helperBody = cloneProductBody(g, t, "a", path);
    g.helpers.push({ name, fn: `(a: ${typeText}): ${typeText} => (${helperBody})` });
  } finally {
    g.inProgress.pop();
    g.depth = savedDepth;
  }
  return helperCall(g, name, x);
}

/**
 * Why a class's instances can't be cloned field-wise, or undefined when they
 * can: a `#private` member (field, method or accessor; also an `accessor`
 * field, whose storage is one) is brand-checked, so a copy made outside the
 * class has none and every use of it throws; a class that extends a built-in
 * (`Map`, `Date`, `Error`, ...) keeps its state in internal slots that no
 * property copy reaches. Checked through the class and all its base classes.
 */
function classCloneProblem(ctx: MacroContext, t: ts.Type): string | undefined {
  const checker = ctx.typeChecker;
  const seen = new Set<ts.Type>();
  let cls: ts.Type | undefined = t;
  while (cls && !seen.has(cls)) {
    seen.add(cls);
    const sym = cls.symbol;
    if (!sym) break;
    // Before the class check: the lib declares `Map`, `Error`, ... as an
    // interface plus a constructor variable, not as a class.
    if (isLibType(ctx, cls)) {
      return (
        `it extends the built-in '${sym.name}', whose state lives in internal slots ` +
        `that a field-wise copy can't reproduce`
      );
    }
    if (!(sym.flags & ts.SymbolFlags.Class)) break;
    for (const decl of sym.declarations ?? []) {
      if (!ts.isClassLike(decl)) continue;
      for (const m of decl.members) {
        const isStatic = ts.getCombinedModifierFlags(m as ts.Declaration) & ts.ModifierFlags.Static;
        if (isStatic) continue;
        if (m.name && ts.isPrivateIdentifier(m.name)) {
          return (
            `its member '${m.name.text}' (in class ${sym.name}) is #private, and a copy made ` +
            `outside the class can't have it`
          );
        }
        if (
          ts.isPropertyDeclaration(m) &&
          m.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AccessorKeyword)
        ) {
          return (
            `its 'accessor' field '${m.name.getText()}' (in class ${sym.name}) is stored in a ` +
            `#private slot, which a copy made outside the class can't have`
          );
        }
      }
    }
    const bases: ts.BaseType[] = cls.isClassOrInterface() ? checker.getBaseTypes(cls) : [];
    cls = bases[0];
  }
  return undefined;
}

/** `t` is the instance type of a (non-lib) class: its clone keeps the prototype. */
function isClassInstanceType(ctx: MacroContext, t: ts.Type): boolean {
  const sym = t.symbol;
  return !!sym && (sym.flags & ts.SymbolFlags.Class) !== 0 && !isLibType(ctx, t);
}

function cloneProductBody(g: CloneGen, t: ts.Type, x: string, path: string): string {
  const { ctx } = g;
  const checker = ctx.typeChecker;
  const isClass = isClassInstanceType(ctx, t);
  if (isClass) {
    const problem = classCloneProblem(ctx, t);
    if (problem) {
      const name = checker.typeToString(t);
      throw new DerivationRefused(
        `Clone<${name}> can't be derived field-wise: ${problem}. ` +
          `Write it by hand with /** @impl Clone<${name}> */ (for example with a copy constructor).`
      );
    }
  }
  const parts: string[] = [`...${x}`];
  const props = dataProperties(ctx, t, false);
  for (const p of props) {
    const acc = access(x, p.name);
    const pPath = `${path}[${JSON.stringify(p.name)}]`;
    if (p.optional) {
      // Overridden only when present, so an absent field stays absent.
      const present = checker.getNonNullableType(p.type);
      const inner = cloneValue(g, present, acc, `NonNullable<${pPath}>`);
      if (inner === undefined) continue;
      const guard = isObjectOnly(present) ? acc : `${acc} != null`;
      parts.push(`...(${guard} && { ${objKey(p.name)}: ${inner} })`);
      continue;
    }
    const c = cloneValue(g, p.type, acc, pPath);
    if (c !== undefined) parts.push(`${objKey(p.name)}: ${c}`);
  }
  if (isClass) {
    // A class instance: a new object with the same prototype (methods,
    // accessors, `instanceof`, a subclass's overrides), then its own fields,
    // with the cloned ones set on top. Object.create returns `any`; the
    // instance's `clone` is annotated with the class type.
    const proto = `Object.create(Object.getPrototypeOf(${x}))`;
    const overrides = parts.slice(1);
    return overrides.length > 0
      ? `Object.assign(${proto}, ${x}, { ${overrides.join(", ")} })`
      : `Object.assign(${proto}, ${x})`;
  }
  if (props.length === 0) {
    // `{ [k: string]: V }` / `Record<string, V>`: values cloned through V's Clone.
    const index = checker.getIndexInfosOfType(t).find((i) => i.keyType.flags & ts.TypeFlags.String);
    if (index) {
      const k = lambdaName(g, "k");
      const v = lambdaName(g, "v");
      g.depth++;
      let cv: string | undefined;
      try {
        cv = cloneValue(g, index.type, v, `${path}[string]`);
      } finally {
        g.depth--;
      }
      if (cv !== undefined) {
        return `Object.fromEntries(Object.entries(${x}).map(([${k}, ${v}]) => [${k}, ${cv}]))`;
      }
    }
  }
  return `{ ${parts.join(", ")} }`;
}

/** Field-wise clone from type STRINGS (registered GenericMeta without ts.Types). */
function cloneFromText(ft: string, x: string, depth: number): string | undefined {
  const stripped = stripNullableText(ft);
  if (PRIMITIVE_NAMES.has(stripped)) return undefined;
  const m =
    /^(?:readonly\s+)?(.+)\[\]$/.exec(stripped) ?? /^(?:Readonly)?Array<(.+)>$/.exec(stripped);
  if (!m) return undefined; // nothing known about the type: copied as is
  const p = depth === 0 ? "e" : `e${depth}`;
  const inner = cloneFromText(m[1].trim(), p, depth + 1);
  return inner === undefined ? `${x}.slice()` : `${x}.map((${p}) => ${inner})`;
}

function deriveClone(ctx: MacroContext, typeName: string, meta: GenericMeta): string | null {
  const types = mirrorTypes.get(meta);
  if (!types) {
    if (meta.kind !== "product" || !meta.fieldNames || !meta.fieldTypes) return null;
    const parts = ["...a"];
    meta.fieldNames.forEach((name, i) => {
      const acc = access("a", name);
      const c = cloneFromText(meta.fieldTypes![i], acc, 0);
      if (c === undefined) return;
      // Optionality is unknown here: override only when present.
      parts.push(
        stripNullableText(meta.fieldTypes![i]) === meta.fieldTypes![i].trim()
          ? `${objKey(name)}: ${c}`
          : `...(${acc} && { ${objKey(name)}: ${c} })`
      );
    });
    if (parts.length > 1) structureDependence++;
    return `({ clone: (a: ${typeName}): ${typeName} => ({ ${parts.join(", ")} }) })`;
  }

  const g: CloneGen = {
    ctx,
    rootTypeName: typeName,
    helpers: [],
    helperRefs: new Map(),
    helperNames: new Map(),
    inProgress: [],
    taken: identifiersOf(ctx.sourceFile),
    depth: 0,
    warned: new Set(),
  };
  const root = types.self;
  // The instance's `clone` member: an arrow function, or a helper's name.
  let member: string;
  if (meta.kind === "sum") {
    if (!root.isUnion()) return null;
    const helper = cloneSumHelper(g, root, typeName);
    if (!helper) return null;
    member = helper;
  } else {
    const expr = cloneProduct(g, root, "a", typeName);
    member = g.helperNames.get(root) ?? `(a: ${typeName}): ${typeName} => (${expr})`;
  }
  // A helper referenced only as the member (a union that doesn't contain
  // itself) is the member itself: `({ clone: (a: T): T => { switch ... } })`.
  const own = g.helpers.find((h) => h.name === member);
  if (own && !g.helperRefs.get(own.name)) {
    g.helpers.splice(g.helpers.indexOf(own), 1);
    member = own.fn;
  }
  const code =
    g.helpers.length > 0
      ? `(() => { ${g.helpers.map((h) => `const ${h.name} = ${h.fn};`).join(" ")} return { clone: ${member} }; })()`
      : `({ clone: ${member} })`;
  if (code !== `({ clone: (a: ${typeName}): ${typeName} => ({ ...a }) })`) structureDependence++;
  return code;
}

registerGenericDerivation("Clone", {
  typeclassName: "Clone",
  fieldTypeclass: null,

  hasFieldInstance: () => true,

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames) return null;
    return deriveClone(ctx, typeName, meta);
  },

  deriveSum(ctx, typeName, meta) {
    if (!meta.variants) return null;
    return deriveClone(ctx, typeName, meta);
  },
});

// Debug derivation via Generic
registerGenericDerivation("Debug", {
  typeclassName: "Debug",
  fieldTypeclass: null,
  hasFieldInstance: () => true,

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames) return null;
    const pairs = meta.fieldNames
      .map((name) => `${name}: \${JSON.stringify(${access("a", name)})}`)
      .join(", ");
    return `({ debug: (a: ${typeName}): string => \`${typeName} { ${pairs} }\` })`;
  },

  deriveSum(ctx, typeName, meta) {
    if (!meta.variants || !meta.discriminant) return null;
    const disc = meta.discriminant;
    const cases = meta.variants
      .map((v) => `case ${JSON.stringify(v.tag)}: return \`${v.typeName}(\${JSON.stringify(a)})\``)
      .join("; ");
    return `({ debug: (a: ${typeName}): string => { switch (${access("(a as any)", disc)}) { ${cases}; default: return String(a) } } })`;
  },
});

// Default derivation via Generic
registerGenericDerivation("Default", {
  typeclassName: "Default",
  fieldTypeclass: null,
  hasFieldInstance: () => true,

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;
    const defaults = meta.fieldNames
      .map((name, i) => {
        const ft = meta.fieldTypes![i];
        const stripped = stripNullableText(ft);
        let val: string;
        if (stripped !== ft.trim()) val = "undefined";
        else if (ft === "number") val = "0";
        else if (ft === "string") val = '""';
        else if (ft === "boolean") val = "false";
        else if (ft.endsWith("[]")) val = "[]";
        else val = `({} as ${ft})`;
        return `${objKey(name)}: ${val}`;
      })
      .join(", ");
    return `({ default: (): ${typeName} => ({ ${defaults} }) })`;
  },
});

// Json derivation via Generic
registerGenericDerivation("Json", {
  typeclassName: "Json",
  fieldTypeclass: null,
  hasFieldInstance: () => true,

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;
    const toFields = meta.fieldNames
      .map((name) => `${objKey(name)}: ${access("a", name)}`)
      .join(", ");
    // Optionality comes from the checker mirror (`x?: T`); a pre-registered
    // meta without one falls back to the type text (a field whose type
    // admits `undefined` is treated as optional, anything else as required).
    const optional = mirrorTypes.get(meta)?.optional;
    const validations = meta.fieldNames
      .map((name, i) => {
        const v = access("obj", name);
        const ft = meta.fieldTypes![i];
        const check = runtimeTypeCheck(ft, v);
        if (check === "true") return "";
        const isOptional =
          optional?.[i] ??
          splitTopLevelUnion(ft).some((p) => p.trim() === "undefined" || p.trim() === "void");
        const typeError = `throw new Error(${JSON.stringify(`Field ${name} must be ${ft}`)});`;
        if (isOptional) return `if (${v} !== undefined && !(${check})) ${typeError}`;
        // Required: a missing field is an error, not a silently-accepted hole.
        return `if (${v} === undefined) throw new Error(${JSON.stringify(`Missing required field ${name}`)}); if (!(${check})) ${typeError}`;
      })
      .filter((x) => x)
      .join(" ");
    return `({ toJson: (a: ${typeName}): unknown => ({ ${toFields} }), fromJson: (json: unknown): ${typeName} => { if (typeof json !== "object" || json === null) throw new Error("Expected object"); const obj = json as Record<string, unknown>; ${validations} return obj as unknown as ${typeName}; } })`;
  },

  deriveSum(ctx, typeName, meta) {
    if (!meta.variants || !meta.discriminant) return null;
    const d = access("obj", meta.discriminant);
    const validTags = meta.variants.map((v) => JSON.stringify(v.tag)).join(", ");
    return `({ toJson: (a: ${typeName}): unknown => ({ ...a }), fromJson: (json: unknown): ${typeName} => { if (typeof json !== "object" || json === null) throw new Error("Expected object"); const obj = json as Record<string, unknown>; if (typeof ${d} !== "string") throw new Error("Missing discriminant"); if (![${validTags}].includes(${d} as string)) throw new Error("Invalid tag"); return obj as unknown as ${typeName}; } })`;
  },
});

// TypeGuard derivation via Generic
registerGenericDerivation("TypeGuard", {
  typeclassName: "TypeGuard",
  fieldTypeclass: null,
  hasFieldInstance: () => true,

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;
    if (meta.fieldNames.length === 0) {
      return `({ is: (value: unknown): boolean => typeof value === "object" && value !== null })`;
    }
    const checks = meta.fieldNames
      .map((name, i) => runtimeTypeCheck(meta.fieldTypes![i], access("(value as any)", name)))
      .join(" && ");
    return `({ is: (value: unknown): boolean => typeof value === "object" && value !== null && ${checks} })`;
  },

  deriveSum(ctx, typeName, meta) {
    if (!meta.variants || !meta.discriminant) return null;
    const d = access("(value as any)", meta.discriminant);
    const validTags = meta.variants.map((v) => JSON.stringify(v.tag)).join(", ");
    return `({ is: (value: unknown): boolean => typeof value === "object" && value !== null && typeof ${d} === "string" && [${validTags}].includes(${d}) })`;
  },
});

// Semigroup derivation via Generic
registerGenericDerivation("Semigroup", {
  typeclassName: "Semigroup",
  fieldTypeclass: "Semigroup",
  hasFieldInstance: makePrimitiveChecker(new Set(["number", "string", "boolean"])),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;
    const types = mirrorTypes.get(meta)?.fieldTypes;
    const combines: string[] = [];
    for (let i = 0; i < meta.fieldNames.length; i++) {
      const name = meta.fieldNames[i];
      const x = access("a", name);
      const y = access("b", name);
      const c = types
        ? combineExpr(ctx, "Semigroup", types[i], x, y)
        : combineExprFromText(meta.fieldTypes[i], x, y);
      if (c === null) return null;
      combines.push(`${objKey(name)}: ${c}`);
    }
    return `({ combine: (a: ${typeName}, b: ${typeName}): ${typeName} => ({ ${combines.join(", ")} }) })`;
  },
});

// Monoid derivation via Generic
registerGenericDerivation("Monoid", {
  typeclassName: "Monoid",
  fieldTypeclass: "Monoid",
  hasFieldInstance: makePrimitiveChecker(new Set(["number", "string", "boolean"])),

  deriveProduct(ctx, typeName, meta) {
    if (!meta.fieldNames || !meta.fieldTypes) return null;
    const types = mirrorTypes.get(meta)?.fieldTypes;
    const empties: string[] = [];
    const combines: string[] = [];
    for (let i = 0; i < meta.fieldNames.length; i++) {
      const name = meta.fieldNames[i];
      const x = access("a", name);
      const y = access("b", name);
      const e = types ? emptyExpr(ctx, types[i]) : emptyExprFromText(meta.fieldTypes[i]);
      const c = types
        ? combineExpr(ctx, "Monoid", types[i], x, y)
        : combineExprFromText(meta.fieldTypes[i], x, y);
      if (e === null || c === null) return null;
      empties.push(`${objKey(name)}: ${e}`);
      combines.push(`${objKey(name)}: ${c}`);
    }
    return `({ empty: (): ${typeName} => ({ ${empties.join(", ")} }), combine: (a: ${typeName}, b: ${typeName}): ${typeName} => ({ ${combines.join(", ")} }) })`;
  },
});

/**
 * A complete `Ord` instance from a `compare` body: every method the `Ord`
 * typeclass declares (`compare`, the four `@op` comparison methods, and the
 * inherited `Eq` `equals`/`notEquals`), all defined in terms of `compare`.
 * The `<`/`<=`/`>`/`>=` operator rewrites call `lessThan` etc. directly, so an
 * instance with only `compare` fails at runtime ("lessThan is not a function").
 */
function ordFromCompare(typeName: string, compareBody: string): string {
  const sig = `(a: ${typeName}, b: ${typeName}): boolean =>`;
  return (
    // `-1 | 0 | 1`: the `Ordering` of std's and fp's `Ord` (not `number`,
    // which isn't assignable to it), written out so no import is needed.
    `(() => { const compare = (a: ${typeName}, b: ${typeName}): -1 | 0 | 1 => { ${compareBody} }; ` +
    `return { compare, ` +
    `equals: ${sig} compare(a, b) === 0, notEquals: ${sig} compare(a, b) !== 0, ` +
    `lessThan: ${sig} compare(a, b) < 0, lessThanOrEqual: ${sig} compare(a, b) <= 0, ` +
    `greaterThan: ${sig} compare(a, b) > 0, greaterThanOrEqual: ${sig} compare(a, b) >= 0 }; })()`
  );
}

/** Lexicographic comparison statements over primitive fields. */
function lexCompare(names: string[], a: string, b: string): string {
  return names
    .map((name) => {
      const x = access(a, name);
      const y = access(b, name);
      return `{ const c = ${x} < ${y} ? -1 : ${x} > ${y} ? 1 : 0; if (c !== 0) return c; }`;
    })
    .join(" ");
}

/**
 * Runtime check that `v` matches the declared field type string, for
 * TypeGuard/Json: `typeof` for primitives, `Array.isArray` for arrays, an
 * object check otherwise; nullable/optional parts admit null/undefined.
 */
function runtimeTypeCheck(ft: string, v: string): string {
  const parts = splitTopLevelUnion(ft);
  const checks = parts.map((p) => {
    const t = p.trim();
    if (t === "undefined" || t === "void") return `${v} === undefined`;
    if (t === "null") return `${v} === null`;
    if (["number", "string", "boolean", "bigint", "symbol"].includes(t))
      return `typeof ${v} === "${t}"`;
    if (t === "true" || t === "false") return `${v} === ${t}`;
    if (/^-?\d+(\.\d+)?$/.test(t) || /^"(?:[^"\\]|\\.)*"$/.test(t)) return `${v} === ${t}`;
    if (t.endsWith("[]") || /^(?:Readonly)?Array</.test(t) || /^readonly /.test(t))
      return `Array.isArray(${v})`;
    if (t === "any" || t === "unknown") return "true";
    if (t === "Date") return `${v} instanceof Date`;
    return `(typeof ${v} === "object" && ${v} !== null)`;
  });
  if (checks.includes("true")) return "true";
  return checks.length === 1 ? checks[0] : `(${checks.join(" || ")})`;
}

/** Split a union type string at top-level `|` (outside <>, (), {}, []). */
function splitTopLevelUnion(t: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of t) {
    if ("<({[".includes(ch)) depth++;
    else if (">)}]".includes(ch)) depth--;
    if (ch === "|" && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.filter((p) => p.trim().length > 0);
}

/** `${...}` expression showing a primitive / array / nullable field value. */
function showFieldExpr(fieldType: string | undefined, accessor: string): string | null {
  if (!fieldType) return null;
  const stripped = stripNullableText(fieldType);
  const nullable = stripped !== fieldType.trim();
  let inner: string | null;
  const arr =
    /^(?:readonly\s+)?(.+)\[\]$/.exec(stripped) ?? /^(?:Readonly)?Array<(.+)>$/.exec(stripped);
  if (arr) {
    const d = lambdaDepth++;
    try {
      const el = showFieldExpr(arr[1].trim(), `__e${d}`);
      inner = el === null ? null : `"[" + ${accessor}.map((__e${d}) => ${el}).join(", ") + "]"`;
    } finally {
      lambdaDepth--;
    }
  } else {
    const fn = primitiveShowExpr(stripped);
    inner = fn ? `${fn}(${accessor})` : null;
  }
  if (inner === null) return null;
  return nullable ? `(${accessor} == null ? String(${accessor}) : ${inner})` : inner;
}

// ============================================================================
// Helpers for code generation
// ============================================================================

function primitiveShowExpr(fieldType: string | undefined): string | null {
  if (!fieldType) return null;
  const stripped = stripNullableText(fieldType);

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

function primitiveHashExpr(fieldType: string | undefined, accessor: string): string | null {
  if (!fieldType) return null;
  const stripped = stripNullableText(fieldType);
  const nullable = stripped !== fieldType.trim();

  let inner: string | null;
  switch (stripped) {
    case "number":
      inner = `(${accessor} | 0)`;
      break;
    case "string":
      inner = `Array.from(${accessor}).reduce((h, c) => ((h << 5) + h) ^ c.charCodeAt(0), 0)`;
      break;
    case "boolean":
      inner = `(${accessor} ? 1 : 0)`;
      break;
    case "bigint":
      inner = `Number(${accessor} & 0xFFFFFFFFn)`;
      break;
    default:
      inner = null;
  }
  if (inner === null) return null;
  return nullable ? `(${accessor} == null ? 0 : ${inner})` : inner;
}
