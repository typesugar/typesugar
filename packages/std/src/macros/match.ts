/**
 * Zero-Cost Exhaustive Pattern Matching
 *
 * A unified match() macro providing Scala-quality pattern matching that compiles
 * to optimized decision trees. Supports discriminated unions with destructuring,
 * literal dispatch, guard predicates, OR patterns, type patterns, and array
 * helpers — all with compile-time exhaustiveness checking and zero runtime overhead.
 *
 * ## Compilation Strategies
 *
 * | Pattern Kind          | Arms ≤ 6           | Arms > 6                 |
 * |-----------------------|---------------------|--------------------------|
 * | Discriminated union   | Ternary chain       | IIFE + switch statement  |
 * | String literals       | Ternary chain       | IIFE + switch statement  |
 * | Integer literals      | Ternary chain       | Binary search tree       |
 * | Dense integer range   | Ternary chain       | IIFE + switch (V8 jump)  |
 * | Guard predicates      | Ternary chain       | Ternary chain            |
 *
 * Binary search gives O(log n) comparisons for sparse integers vs O(n) linear.
 * Switch statements let V8 apply its own optimizations (hash tables, jump tables).
 *
 * @example
 * ```typescript
 * import { match, when, otherwise, isType, P } from "@typesugar/std";
 *
 * // Discriminated union with destructuring
 * type Shape =
 *   | { kind: "circle"; radius: number }
 *   | { kind: "square"; side: number }
 *   | { kind: "triangle"; base: number; height: number };
 *
 * const area = match(shape, {
 *   circle: ({ radius }) => Math.PI * radius ** 2,
 *   square: ({ side }) => side ** 2,
 *   triangle: ({ base, height }) => 0.5 * base * height,
 * });
 *
 * // OR patterns — pipe-separated keys share a handler
 * const flat = match(shape, {
 *   "circle|square": (s) => "flat shape",
 *   triangle: (s) => "angled shape",
 * });
 * // Compiles to: (kind === "circle" || kind === "square") ? handler : ...
 *
 * // Note: If your discriminant value literally contains `|`, use quoted key names
 * // and a separate handler for each variant. See Finding #7 in FINDINGS.md.
 *
 * // Literal dispatch with compile-time exhaustiveness
 * const msg = match(statusCode, {
 *   200: () => "OK",
 *   404: () => "Not Found",
 *   _: (code) => `Unknown: ${code}`,
 * });
 *
 * // Type patterns — isType<T>() generates optimal type guards
 * const desc = match(value, [
 *   when(isType("string"), s => `str: ${s}`),
 *   when(isType("number"), n => n.toFixed(2)),
 *   otherwise(() => "other"),
 * ]);
 *
 * // Array pattern helpers
 * const result = match(list, [
 *   when(P.empty, () => "empty"),
 *   when(P.length(1), ([x]) => `one: ${x}`),
 *   when(P.minLength(2), ([a, b]) => `starts: ${a}, ${b}`),
 *   otherwise(() => "default"),
 * ]);
 *
 * // Guard-based matching
 * const category = match(age, [
 *   when(n => n < 13, () => "child"),
 *   when(n => n < 18, () => "teen"),
 *   otherwise(() => "adult"),
 * ]);
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

// ============================================================================
// Type-Level API
// ============================================================================

/** Extracts discriminant literal values from a union type */
type DiscriminantOf<T, K extends keyof T> =
  T extends Record<K, infer V> ? (V extends string | number | boolean ? V : never) : never;

/** Handler map for discriminated union matching — each handler receives the narrowed variant */
type DiscriminantHandlers<T, K extends keyof T, R> = {
  [V in DiscriminantOf<T, K>]: (value: Extract<T, Record<K, V>>) => R;
} & { _?: (value: T) => R };

/** Handler map for literal value matching */
type LiteralHandlers<T extends string | number, R> = {
  [K in T]?: (value: K) => R;
} & { _?: (value: T) => R };

/** A guard arm produced by when() or otherwise() */
export interface GuardArm<T, R> {
  readonly predicate: (value: T) => boolean;
  readonly handler: (value: T) => R;
}

/** Create a guard arm — matches when predicate returns true */
export function when<T, R>(
  predicate: (value: T) => boolean,
  handler: (value: T) => R
): GuardArm<T, R> {
  return { predicate, handler };
}

/** Create a catch-all guard arm — always matches */
export function otherwise<T, R>(handler: (value: T) => R): GuardArm<T, R> {
  return { predicate: () => true, handler };
}

// ============================================================================
// Type Patterns — isType() generates optimal runtime type guards
// ============================================================================

type PrimitiveTypeName =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "undefined"
  | "function";

/**
 * Create a type guard predicate for use in match() guard arms.
 *
 * For primitives: generates `typeof x === "..."` checks.
 * For classes: pass the constructor directly for `instanceof` checks.
 * For null: use `isType("null")`.
 *
 * @example
 * ```typescript
 * match(value, [
 *   when(isType("string"), s => s.length),
 *   when(isType("number"), n => n.toFixed(2)),
 *   when(isType("null"), () => "nothing"),
 *   when(isType(Date), d => d.toISOString()),
 *   otherwise(() => "unknown"),
 * ]);
 * ```
 */
export function isType(
  typeName: PrimitiveTypeName | "null" | "object"
): (value: unknown) => boolean;
export function isType<T>(ctor: new (...args: any[]) => T): (value: unknown) => value is T;
export function isType(
  typeOrCtor: string | (new (...args: any[]) => any)
): (value: unknown) => boolean {
  if (typeof typeOrCtor === "string") {
    if (typeOrCtor === "null") return (v) => v === null;
    return (v) => typeof v === typeOrCtor;
  }
  return (v) => v instanceof typeOrCtor;
}

// ============================================================================
// Array Pattern Helpers — compile-time optimized array predicates
// ============================================================================

/**
 * Pattern helpers for array/tuple matching in guard arms.
 *
 * These are recognized by the match macro and compiled to optimal checks.
 * At runtime they work as regular predicates.
 *
 * @example
 * ```typescript
 * match(list, [
 *   when(P.empty, () => "empty list"),
 *   when(P.length(1), ([x]) => `singleton: ${x}`),
 *   when(P.length(2), ([a, b]) => `pair: ${a}, ${b}`),
 *   when(P.minLength(3), ([a, b, c, ...rest]) => `3+`),
 *   when(P.head(x => x > 0), ([pos, ...rest]) => `starts positive`),
 *   otherwise(() => "default"),
 * ]);
 * ```
 */
export const P = {
  /**
   * Matches empty arrays: `arr.length === 0`
   *
   * Note: This also works on strings since strings have a `.length` property.
   * Using `P.empty` on a string will return true for empty strings `""`.
   * This is intentional - any value with `length === 0` matches.
   * See Finding #6 in FINDINGS.md.
   */
  empty: (arr: readonly unknown[]): boolean => arr.length === 0,

  /** Matches null or undefined */
  nil: (value: unknown): value is null | undefined => value == null,

  /** Matches non-null, non-undefined */
  defined: (value: unknown): boolean => value != null,

  /** Matches arrays of exactly n elements */
  length(n: number): (arr: readonly unknown[]) => boolean {
    return (arr) => arr.length === n;
  },

  /** Matches arrays with at least n elements */
  minLength(n: number): (arr: readonly unknown[]) => boolean {
    return (arr) => arr.length >= n;
  },

  /** Matches arrays whose first element satisfies a predicate */
  head<T>(pred: (value: T) => boolean): (arr: readonly T[]) => boolean {
    return (arr) => arr.length > 0 && pred(arr[0]);
  },

  /** Matches values in a set of allowed values */
  oneOf<T>(...values: T[]): (value: T) => boolean {
    const set = new Set<unknown>(values);
    return (v) => set.has(v);
  },

  /** Matches values within a numeric range [lo, hi] inclusive */
  between(lo: number, hi: number): (value: number) => boolean {
    return (v) => v >= lo && v <= hi;
  },

  /** Matches values satisfying all predicates */
  allOf<T>(...preds: Array<(value: T) => boolean>): (value: T) => boolean {
    return (v) => preds.every((p) => p(v));
  },

  /** Matches values satisfying any predicate (OR combinator for guards) */
  anyOf<T>(...preds: Array<(value: T) => boolean>): (value: T) => boolean {
    return (v) => preds.some((p) => p(v));
  },

  /** Matches objects that have a given property */
  has<K extends string>(key: K): (value: unknown) => boolean {
    return (v) => typeof v === "object" && v !== null && key in v;
  },

  /** Matches strings against a regex */
  regex(pattern: RegExp): (value: string) => boolean {
    return (v) => pattern.test(v);
  },
} as const;

// ============================================================================
// Runtime Fallbacks
// ============================================================================

/**
 * Unified pattern matching — compile-time macro with runtime fallback.
 *
 * Three forms:
 * 1. `match(value, { variant: handler, ... })` — discriminated union / literal
 * 2. `match(value, { variant: handler, ... }, "discriminant")` — explicit discriminant
 * 3. `match(value, [when(...), otherwise(...)])` — guard predicates
 */
export function match<T extends Record<string, unknown>, K extends keyof T, R>(
  value: T,
  handlers: DiscriminantHandlers<T, K, R>,
  discriminant?: K
): R;
export function match<T extends string | number, R>(value: T, handlers: LiteralHandlers<T, R>): R;
export function match<T, R>(value: T, arms: GuardArm<T, R>[]): R;
export function match(value: any, handlersOrArms: any, discriminant?: any): any {
  if (Array.isArray(handlersOrArms)) {
    for (const arm of handlersOrArms) {
      const result = arm.predicate(value);
      // Finding #4: Detect async predicates and throw helpful error
      if (result && typeof result === "object" && typeof result.then === "function") {
        throw new Error(
          "match() guard predicates must be synchronous. " +
            "Use await before match() for async logic."
        );
      }
      if (result) return arm.handler(value);
    }
    throw new Error("Non-exhaustive match: no guard matched");
  }
  if (typeof value === "object" && value !== null) {
    // Finding #3: Try common discriminant names, then infer from handler keys
    const key = discriminant ?? inferDiscriminant(value, handlersOrArms);
    const tag = value[key] as string;
    const handler = handlersOrArms[tag] ?? handlersOrArms._;
    if (!handler) throw new Error(`Non-exhaustive match: no handler for '${String(tag)}'`);
    return handler(value);
  }
  const handler = handlersOrArms[value] ?? handlersOrArms._;
  if (!handler) throw new Error(`Non-exhaustive match: no handler for '${String(value)}'`);
  return handler(value);
}

/**
 * Infer discriminant from value and handler keys.
 * Tries common discriminant names, then checks if handler keys match any property.
 */
function inferDiscriminant(
  value: Record<string, unknown>,
  handlers: Record<string, unknown>
): string {
  // Common discriminant names to try first
  const commonNames = ["kind", "_tag", "type", "ok", "status", "tag", "discriminant"];

  for (const name of commonNames) {
    if (name in value) {
      const tag = value[name];
      // Check if handlers have a key matching this discriminant value
      if (typeof tag === "string" || typeof tag === "number" || typeof tag === "boolean") {
        const tagKey = String(tag);
        if (tagKey in handlers || "_" in handlers) {
          return name;
        }
      }
    }
  }

  // Fallback: check if handler keys are "true"/"false" and look for boolean property
  const handlerKeys = Object.keys(handlers).filter((k) => k !== "_");
  if (handlerKeys.length === 2 && handlerKeys.includes("true") && handlerKeys.includes("false")) {
    // Look for a boolean property in value
    for (const [propName, propValue] of Object.entries(value)) {
      if (typeof propValue === "boolean") {
        return propName;
      }
    }
  }

  // Default fallback
  return "kind";
}

/** @deprecated Use `match()` with literal keys instead */
export function matchLiteral<T extends string | number, R>(
  value: T,
  handlers: LiteralHandlers<T, R>
): R {
  const handler = (handlers as Record<string | number, ((v: T) => R) | undefined>)[value];
  if (handler) return handler(value);
  const wildcard = (handlers as Record<string, ((v: T) => R) | undefined>)["_"];
  if (wildcard) return wildcard(value);
  throw new Error(`Non-exhaustive match: no handler for '${value}'`);
}

/** @deprecated Use `match()` with when()/otherwise() arms instead */
export function matchGuard<T, R>(
  value: T,
  arms: Array<[(value: T) => boolean, (value: T) => R]>
): R {
  for (const [pred, handler] of arms) {
    if (pred(value)) return handler(value);
  }
  throw new Error("Non-exhaustive match: no guard matched");
}

// ============================================================================
// Exhaustiveness Checking
// ============================================================================

const KNOWN_DISCRIMINANTS = ["kind", "_tag", "type", "tag", "__typename", "ok", "status"];

function detectDiscriminant(type: ts.Type, checker: ts.TypeChecker): string | null {
  if (!type.isUnion()) return null;
  for (const candidate of KNOWN_DISCRIMINANTS) {
    let allHave = true;
    let allLiteral = true;
    for (const member of type.types) {
      const prop = member.getProperty(candidate);
      if (!prop) {
        allHave = false;
        break;
      }
      const propType = checker.getTypeOfSymbol(prop);
      if (
        !propType.isStringLiteral() &&
        !propType.isNumberLiteral() &&
        !(propType.flags & ts.TypeFlags.BooleanLiteral)
      ) {
        allLiteral = false;
        break;
      }
    }
    if (allHave && allLiteral) return candidate;
  }
  return null;
}

function getUnionVariantTags(
  type: ts.Type,
  discriminant: string,
  checker: ts.TypeChecker
): Set<string> {
  const tags = new Set<string>();
  if (!type.isUnion()) return tags;
  for (const member of type.types) {
    const prop = member.getProperty(discriminant);
    if (!prop) continue;
    const propType = checker.getTypeOfSymbol(prop);
    if (propType.isStringLiteral()) {
      tags.add(propType.value);
    } else if (propType.isNumberLiteral()) {
      tags.add(String(propType.value));
    } else if (propType.flags & ts.TypeFlags.BooleanLiteral) {
      const boolName = (propType as ts.Type & { intrinsicName?: string }).intrinsicName;
      tags.add(boolName === "true" ? "true" : "false");
    }
  }
  return tags;
}

function getLiteralTypeValues(type: ts.Type): Set<string> | null {
  const values = new Set<string>();
  if (type.isUnion()) {
    for (const member of type.types) {
      if (member.isStringLiteral()) values.add(member.value);
      else if (member.isNumberLiteral()) values.add(String(member.value));
      else return null;
    }
    return values.size > 0 ? values : null;
  }
  if (type.isStringLiteral()) {
    values.add(type.value);
    return values;
  }
  if (type.isNumberLiteral()) {
    values.add(String(type.value));
    return values;
  }
  return null;
}

interface ExhaustivenessResult {
  isExhaustive: boolean;
  missingVariants: string[];
  extraVariants: string[];
}

function checkExhaustiveness(
  expectedVariants: Set<string>,
  providedKeys: string[],
  hasWildcard: boolean
): ExhaustivenessResult {
  const providedSet = new Set(providedKeys);
  const missing = [...expectedVariants].filter((v) => !providedSet.has(v));
  const extra = [...providedSet].filter((v) => !expectedVariants.has(v));
  return {
    isExhaustive: hasWildcard || missing.length === 0,
    missingVariants: missing,
    extraVariants: extra,
  };
}

function performExhaustivenessCheck(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  value: ts.Expression,
  analysis: MatchAnalysis
): void {
  const checker = ctx.typeChecker;
  const valueType = ctx.getTypeOf(value);
  let expectedVariants: Set<string> | null = null;

  if (analysis.form === MatchForm.Discriminant && analysis.discriminant) {
    expectedVariants = getUnionVariantTags(valueType, analysis.discriminant, checker);
  } else if (
    analysis.form === MatchForm.StringLiteral ||
    analysis.form === MatchForm.IntegerLiteral
  ) {
    expectedVariants = getLiteralTypeValues(valueType);
  }

  if (!expectedVariants || expectedVariants.size === 0) return;

  const result = checkExhaustiveness(expectedVariants, analysis.keys, analysis.hasWildcard);
  if (!result.isExhaustive && result.missingVariants.length > 0) {
    const label = result.missingVariants.length === 1 ? "case" : "cases";
    ctx.reportError(
      callExpr,
      `Non-exhaustive match: missing ${label} for ` +
        result.missingVariants.map((v) => `'${v}'`).join(", ")
    );
  }
  for (const extra of result.extraVariants) {
    ctx.reportWarning(callExpr, `match() has handler for unknown variant '${extra}'`);
  }
}

// ============================================================================
// Code Generation Strategies
// ============================================================================

/** Threshold at which we switch from ternary chains to switch/binary-search */
const SWITCH_THRESHOLD = 6;

function generateTernaryChain(
  factory: ts.NodeFactory,
  entries: Array<{ condition: ts.Expression; result: ts.Expression }>,
  fallback: ts.Expression
): ts.Expression {
  let result = fallback;
  for (let i = entries.length - 1; i >= 0; i--) {
    result = factory.createConditionalExpression(
      entries[i].condition,
      factory.createToken(ts.SyntaxKind.QuestionToken),
      entries[i].result,
      factory.createToken(ts.SyntaxKind.ColonToken),
      result
    );
  }
  return result;
}

/**
 * Generates: ((__v) => { switch(__v) { case X: return ...; default: return ...; } })(scrutinee)
 *
 * The IIFE parameter ensures the scrutinee is evaluated exactly once.
 * V8 optimizes switch on strings via hash tables, on dense ints via jump tables.
 */
function generateSwitchIIFE(
  factory: ts.NodeFactory,
  scrutinee: ts.Expression,
  switchTarget: (param: ts.Identifier) => ts.Expression,
  cases: Array<{ test: ts.Expression; body: ts.Expression }>,
  defaultBody: ts.Expression
): ts.Expression {
  const paramId = factory.createIdentifier("__v");
  const param = factory.createParameterDeclaration(undefined, undefined, paramId);

  const clauseList: ts.CaseOrDefaultClause[] = cases.map((c) =>
    factory.createCaseClause(c.test, [factory.createReturnStatement(c.body)])
  );
  clauseList.push(factory.createDefaultClause([factory.createReturnStatement(defaultBody)]));

  const switchStmt = factory.createSwitchStatement(
    switchTarget(paramId),
    factory.createCaseBlock(clauseList)
  );

  const fn = factory.createArrowFunction(
    undefined,
    undefined,
    [param],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createBlock([switchStmt], true)
  );

  return factory.createCallExpression(factory.createParenthesizedExpression(fn), undefined, [
    scrutinee,
  ]);
}

/**
 * Balanced binary search tree over sorted numeric entries.
 *
 * For n entries, performs at most ⌈log₂(n)⌉ + 1 comparisons (one < and one ===
 * per level), compared to n comparisons for a linear scan. The generated code is
 * a tree of ternary expressions — no IIFE, no statements, purely expression-level.
 */
function generateBinarySearch(
  factory: ts.NodeFactory,
  scrutinee: ts.Expression,
  entries: Array<{ value: number; result: ts.Expression }>,
  fallback: ts.Expression
): ts.Expression {
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  return binarySearchHelper(factory, scrutinee, sorted, fallback, 0, sorted.length - 1);
}

function binarySearchHelper(
  factory: ts.NodeFactory,
  scrutinee: ts.Expression,
  entries: Array<{ value: number; result: ts.Expression }>,
  fallback: ts.Expression,
  lo: number,
  hi: number
): ts.Expression {
  if (lo > hi) return fallback;

  if (lo === hi) {
    return factory.createConditionalExpression(
      factory.createBinaryExpression(
        scrutinee,
        factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
        factory.createNumericLiteral(entries[lo].value)
      ),
      factory.createToken(ts.SyntaxKind.QuestionToken),
      entries[lo].result,
      factory.createToken(ts.SyntaxKind.ColonToken),
      fallback
    );
  }

  const mid = (lo + hi) >>> 1;
  const midValue = entries[mid].value;

  // scrutinee < midValue ? search(lo..mid-1) : (scrutinee === midValue ? result : search(mid+1..hi))
  return factory.createConditionalExpression(
    factory.createBinaryExpression(
      scrutinee,
      factory.createToken(ts.SyntaxKind.LessThanToken),
      factory.createNumericLiteral(midValue)
    ),
    factory.createToken(ts.SyntaxKind.QuestionToken),
    binarySearchHelper(factory, scrutinee, entries, fallback, lo, mid - 1),
    factory.createToken(ts.SyntaxKind.ColonToken),
    factory.createConditionalExpression(
      factory.createBinaryExpression(
        scrutinee,
        factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
        factory.createNumericLiteral(midValue)
      ),
      factory.createToken(ts.SyntaxKind.QuestionToken),
      entries[mid].result,
      factory.createToken(ts.SyntaxKind.ColonToken),
      binarySearchHelper(factory, scrutinee, entries, fallback, mid + 1, hi)
    )
  );
}

function isDenseIntegerRange(values: number[]): boolean {
  if (values.length < 2) return true;
  const sorted = [...values].sort((a, b) => a - b);
  const range = sorted[sorted.length - 1] - sorted[0] + 1;
  return range <= values.length * 2;
}

function generateThrowIIFE(factory: ts.NodeFactory, message: string): ts.Expression {
  return factory.createCallExpression(
    factory.createParenthesizedExpression(
      factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createBlock([
          factory.createThrowStatement(
            factory.createNewExpression(factory.createIdentifier("Error"), undefined, [
              factory.createStringLiteral(message),
            ])
          ),
        ])
      )
    ),
    undefined,
    []
  );
}

// ============================================================================
// Match Form Detection
// ============================================================================

const enum MatchForm {
  Discriminant,
  StringLiteral,
  IntegerLiteral,
  Guard,
  Mixed,
}

interface HandlerEntry {
  /** For OR patterns, names contains multiple variants (e.g., ["circle", "square"]) */
  names: string[];
  handler: ts.Expression;
}

interface MatchAnalysis {
  form: MatchForm;
  discriminant?: string;
  /** All individual variant keys (OR patterns expanded) */
  keys: string[];
  handlers: HandlerEntry[];
  wildcardHandler?: ts.Expression;
  hasWildcard: boolean;
}

function extractHandlers(
  factory: ts.NodeFactory,
  obj: ts.ObjectLiteralExpression
): { entries: HandlerEntry[]; wildcardHandler?: ts.Expression } {
  const entries: HandlerEntry[] = [];
  let wildcardHandler: ts.Expression | undefined;

  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop) && !ts.isMethodDeclaration(prop)) continue;
    const rawName = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : ts.isNumericLiteral(prop.name)
          ? prop.name.text
          : null;
    if (!rawName) continue;

    let handler: ts.Expression;
    if (ts.isPropertyAssignment(prop)) {
      handler = prop.initializer;
    } else {
      handler = factory.createArrowFunction(
        undefined,
        undefined,
        prop.parameters,
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        prop.body ?? factory.createBlock([])
      );
    }

    if (rawName === "_") {
      wildcardHandler = handler;
    } else {
      // OR patterns: split "circle|square" into ["circle", "square"]
      const names = rawName.includes("|")
        ? rawName
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean)
        : [rawName];
      entries.push({ names, handler });
    }
  }
  return { entries, wildcardHandler };
}

function analyzeMatchForm(
  ctx: MacroContext,
  value: ts.Expression,
  handlers: ts.ObjectLiteralExpression,
  explicitDiscriminant?: string
): MatchAnalysis {
  const factory = ctx.factory;
  const checker = ctx.typeChecker;
  const valueType = ctx.getTypeOf(value);
  const { entries, wildcardHandler } = extractHandlers(factory, handlers);
  const keys = entries.flatMap((e) => e.names);
  const hasWildcard = wildcardHandler !== undefined;

  if (explicitDiscriminant) {
    return {
      form: MatchForm.Discriminant,
      discriminant: explicitDiscriminant,
      keys,
      handlers: entries,
      wildcardHandler,
      hasWildcard,
    };
  }

  if (keys.length > 0 && keys.every((k) => !isNaN(Number(k)) && k.trim() !== "")) {
    return {
      form: MatchForm.IntegerLiteral,
      keys,
      handlers: entries,
      wildcardHandler,
      hasWildcard,
    };
  }

  const disc = detectDiscriminant(valueType, checker);
  if (disc) {
    return {
      form: MatchForm.Discriminant,
      discriminant: disc,
      keys,
      handlers: entries,
      wildcardHandler,
      hasWildcard,
    };
  }

  const literalValues = getLiteralTypeValues(valueType);
  if (literalValues) {
    return {
      form: MatchForm.StringLiteral,
      keys,
      handlers: entries,
      wildcardHandler,
      hasWildcard,
    };
  }

  return {
    form: MatchForm.Mixed,
    keys,
    handlers: entries,
    wildcardHandler,
    hasWildcard,
  };
}

// ============================================================================
// Per-Form Expansion
// ============================================================================

/**
 * Build a condition testing whether disc matches any of the given names.
 * Single name: `v.kind === "circle"`
 * OR pattern: `(v.kind === "circle" || v.kind === "square")`
 */
function buildDiscriminantCondition(
  factory: ts.NodeFactory,
  scrutinee: ts.Expression,
  disc: string,
  names: string[]
): ts.Expression {
  const conditions = names.map((name) =>
    factory.createBinaryExpression(
      factory.createPropertyAccessExpression(scrutinee, disc),
      factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
      factory.createStringLiteral(name)
    )
  );
  if (conditions.length === 1) return conditions[0];
  return factory.createParenthesizedExpression(
    conditions.reduce((left, right) =>
      factory.createBinaryExpression(left, factory.createToken(ts.SyntaxKind.BarBarToken), right)
    )
  );
}

function expandDiscriminantMatch(
  ctx: MacroContext,
  value: ts.Expression,
  analysis: MatchAnalysis
): ts.Expression {
  const factory = ctx.factory;
  const disc = analysis.discriminant!;
  const fallback = analysis.wildcardHandler
    ? factory.createCallExpression(analysis.wildcardHandler, undefined, [value])
    : generateThrowIIFE(factory, "Non-exhaustive match");

  const totalKeys = analysis.keys.length;

  if (totalKeys > SWITCH_THRESHOLD) {
    const paramId = factory.createIdentifier("__v");
    // For switch form, OR patterns become multiple case labels falling through
    const switchCases: ts.CaseOrDefaultClause[] = [];
    for (const h of analysis.handlers) {
      for (let i = 0; i < h.names.length; i++) {
        if (i < h.names.length - 1) {
          // Fall-through case (empty statement list)
          switchCases.push(factory.createCaseClause(factory.createStringLiteral(h.names[i]), []));
        } else {
          // Last name in the OR group gets the handler
          switchCases.push(
            factory.createCaseClause(factory.createStringLiteral(h.names[i]), [
              factory.createReturnStatement(
                factory.createCallExpression(h.handler, undefined, [paramId])
              ),
            ])
          );
        }
      }
    }
    const defaultBody = analysis.wildcardHandler
      ? factory.createCallExpression(analysis.wildcardHandler, undefined, [paramId])
      : generateThrowIIFE(factory, "Non-exhaustive match");
    switchCases.push(factory.createDefaultClause([factory.createReturnStatement(defaultBody)]));

    const param = factory.createParameterDeclaration(undefined, undefined, paramId);
    const switchStmt = factory.createSwitchStatement(
      factory.createPropertyAccessExpression(paramId, disc),
      factory.createCaseBlock(switchCases)
    );
    const fn = factory.createArrowFunction(
      undefined,
      undefined,
      [param],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock([switchStmt], true)
    );
    return factory.createCallExpression(factory.createParenthesizedExpression(fn), undefined, [
      value,
    ]);
  }

  const entries = analysis.handlers.map((h) => ({
    condition: buildDiscriminantCondition(factory, value, disc, h.names),
    result: factory.createCallExpression(h.handler, undefined, [value]),
  }));

  return generateTernaryChain(factory, entries, fallback);
}

function expandIntegerMatch(
  ctx: MacroContext,
  value: ts.Expression,
  analysis: MatchAnalysis
): ts.Expression {
  const factory = ctx.factory;
  const fallback = analysis.wildcardHandler
    ? factory.createCallExpression(analysis.wildcardHandler, undefined, [value])
    : generateThrowIIFE(factory, "Non-exhaustive match");

  // Flatten OR patterns: each handler may cover multiple numeric values
  const flatEntries: Array<{ value: number; handler: ts.Expression }> = [];
  for (const h of analysis.handlers) {
    for (const name of h.names) {
      flatEntries.push({ value: Number(name), handler: h.handler });
    }
  }

  const values = flatEntries.map((e) => e.value);

  if (flatEntries.length > SWITCH_THRESHOLD && isDenseIntegerRange(values)) {
    const paramId = factory.createIdentifier("__v");
    // For switch form, OR patterns on the same handler get fall-through cases
    const switchCases: ts.CaseOrDefaultClause[] = [];
    for (const h of analysis.handlers) {
      const nums = h.names.map(Number);
      for (let i = 0; i < nums.length; i++) {
        if (i < nums.length - 1) {
          switchCases.push(factory.createCaseClause(factory.createNumericLiteral(nums[i]), []));
        } else {
          switchCases.push(
            factory.createCaseClause(factory.createNumericLiteral(nums[i]), [
              factory.createReturnStatement(
                factory.createCallExpression(h.handler, undefined, [paramId])
              ),
            ])
          );
        }
      }
    }
    const defaultBody = analysis.wildcardHandler
      ? factory.createCallExpression(analysis.wildcardHandler, undefined, [paramId])
      : generateThrowIIFE(factory, "Non-exhaustive match");
    switchCases.push(factory.createDefaultClause([factory.createReturnStatement(defaultBody)]));

    const param = factory.createParameterDeclaration(undefined, undefined, paramId);
    const switchStmt = factory.createSwitchStatement(paramId, factory.createCaseBlock(switchCases));
    const fn = factory.createArrowFunction(
      undefined,
      undefined,
      [param],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock([switchStmt], true)
    );
    return factory.createCallExpression(factory.createParenthesizedExpression(fn), undefined, [
      value,
    ]);
  }

  if (flatEntries.length > SWITCH_THRESHOLD) {
    const bsEntries = flatEntries.map((e) => ({
      value: e.value,
      result: factory.createCallExpression(e.handler, undefined, [value]),
    }));
    return generateBinarySearch(factory, value, bsEntries, fallback);
  }

  // For ternary form, group OR'd integers into || conditions
  const entries = analysis.handlers.map((h) => {
    const nums = h.names.map(Number);
    const condition =
      nums.length === 1
        ? factory.createBinaryExpression(
            value,
            factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            factory.createNumericLiteral(nums[0])
          )
        : factory.createParenthesizedExpression(
            nums
              .map((n) =>
                factory.createBinaryExpression(
                  value,
                  factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
                  factory.createNumericLiteral(n)
                )
              )
              .reduce((left, right) =>
                factory.createBinaryExpression(
                  left,
                  factory.createToken(ts.SyntaxKind.BarBarToken),
                  right
                )
              )
          );
    return {
      condition,
      result: factory.createCallExpression(h.handler, undefined, [value]),
    };
  });

  return generateTernaryChain(factory, entries, fallback);
}

function expandLiteralMatch(
  ctx: MacroContext,
  value: ts.Expression,
  analysis: MatchAnalysis
): ts.Expression {
  const factory = ctx.factory;
  const fallback = analysis.wildcardHandler
    ? factory.createCallExpression(analysis.wildcardHandler, undefined, [value])
    : generateThrowIIFE(factory, "Non-exhaustive match");

  const totalKeys = analysis.keys.length;

  if (totalKeys > SWITCH_THRESHOLD) {
    const paramId = factory.createIdentifier("__v");
    const switchCases: ts.CaseOrDefaultClause[] = [];
    for (const h of analysis.handlers) {
      for (let i = 0; i < h.names.length; i++) {
        if (i < h.names.length - 1) {
          switchCases.push(factory.createCaseClause(factory.createStringLiteral(h.names[i]), []));
        } else {
          switchCases.push(
            factory.createCaseClause(factory.createStringLiteral(h.names[i]), [
              factory.createReturnStatement(
                factory.createCallExpression(h.handler, undefined, [paramId])
              ),
            ])
          );
        }
      }
    }
    const defaultBody = analysis.wildcardHandler
      ? factory.createCallExpression(analysis.wildcardHandler, undefined, [paramId])
      : generateThrowIIFE(factory, "Non-exhaustive match");
    switchCases.push(factory.createDefaultClause([factory.createReturnStatement(defaultBody)]));

    const param = factory.createParameterDeclaration(undefined, undefined, paramId);
    const switchStmt = factory.createSwitchStatement(paramId, factory.createCaseBlock(switchCases));
    const fn = factory.createArrowFunction(
      undefined,
      undefined,
      [param],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock([switchStmt], true)
    );
    return factory.createCallExpression(factory.createParenthesizedExpression(fn), undefined, [
      value,
    ]);
  }

  // Build ternary chain with OR conditions for multi-name handlers
  const entries = analysis.handlers.map((h) => {
    const condition =
      h.names.length === 1
        ? factory.createBinaryExpression(
            value,
            factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            factory.createStringLiteral(h.names[0])
          )
        : factory.createParenthesizedExpression(
            h.names
              .map((name) =>
                factory.createBinaryExpression(
                  value,
                  factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
                  factory.createStringLiteral(name)
                )
              )
              .reduce((left, right) =>
                factory.createBinaryExpression(
                  left,
                  factory.createToken(ts.SyntaxKind.BarBarToken),
                  right
                )
              )
          );
    return {
      condition,
      result: factory.createCallExpression(h.handler, undefined, [value]),
    };
  });

  return generateTernaryChain(factory, entries, fallback);
}

/**
 * Recognizes known pattern helpers (isType, P.empty, P.length, etc.) and
 * replaces them with inlined arrow functions for zero-cost dispatch.
 *
 * isType("string") → (__x) => typeof __x === "string"
 * isType("null")   → (__x) => __x === null
 * P.empty          → (__x) => __x.length === 0
 * P.nil            → (__x) => __x == null
 * P.defined        → (__x) => __x != null
 * P.length(n)      → (__x) => __x.length === n
 * P.minLength(n)   → (__x) => __x.length >= n
 * P.between(a, b)  → (__x) => __x >= a && __x <= b
 * P.oneOf(a, b, c) → (__x) => __x === a || __x === b || __x === c
 */
function tryOptimizeGuardPredicate(
  factory: ts.NodeFactory,
  node: ts.Expression
): ts.Expression | undefined {
  const paramId = factory.createIdentifier("__x");
  const param = factory.createParameterDeclaration(undefined, undefined, paramId);
  const makeArrow = (body: ts.Expression) =>
    factory.createArrowFunction(
      undefined,
      undefined,
      [param],
      undefined,
      factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      body
    );

  // isType("string"), isType("number"), isType("null"), isType(SomeClass)
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "isType" &&
    node.arguments.length === 1
  ) {
    const arg = node.arguments[0];
    if (ts.isStringLiteral(arg)) {
      const typeName = arg.text;
      if (typeName === "null") {
        return makeArrow(
          factory.createBinaryExpression(
            paramId,
            factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            factory.createNull()
          )
        );
      }
      // typeof check for primitive type names
      return makeArrow(
        factory.createBinaryExpression(
          factory.createTypeOfExpression(paramId),
          factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
          factory.createStringLiteral(typeName)
        )
      );
    }
    // isType(SomeClass) → instanceof check
    return makeArrow(
      factory.createBinaryExpression(
        paramId,
        factory.createToken(ts.SyntaxKind.InstanceOfKeyword),
        arg
      )
    );
  }

  // P.empty, P.nil, P.defined (property access, not call)
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "P"
  ) {
    const prop = node.name.text;
    if (prop === "empty") {
      return makeArrow(
        factory.createBinaryExpression(
          factory.createPropertyAccessExpression(paramId, "length"),
          factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
          factory.createNumericLiteral(0)
        )
      );
    }
    if (prop === "nil") {
      return makeArrow(
        factory.createBinaryExpression(
          paramId,
          factory.createToken(ts.SyntaxKind.EqualsEqualsToken),
          factory.createNull()
        )
      );
    }
    if (prop === "defined") {
      return makeArrow(
        factory.createBinaryExpression(
          paramId,
          factory.createToken(ts.SyntaxKind.ExclamationEqualsToken),
          factory.createNull()
        )
      );
    }
  }

  // P.length(n), P.minLength(n), P.between(a, b), P.oneOf(...)
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "P"
  ) {
    const method = node.expression.name.text;
    const args = node.arguments;

    if (method === "length" && args.length === 1) {
      return makeArrow(
        factory.createBinaryExpression(
          factory.createPropertyAccessExpression(paramId, "length"),
          factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
          args[0]
        )
      );
    }
    if (method === "minLength" && args.length === 1) {
      return makeArrow(
        factory.createBinaryExpression(
          factory.createPropertyAccessExpression(paramId, "length"),
          factory.createToken(ts.SyntaxKind.GreaterThanEqualsToken),
          args[0]
        )
      );
    }
    if (method === "between" && args.length === 2) {
      return makeArrow(
        factory.createBinaryExpression(
          factory.createBinaryExpression(
            paramId,
            factory.createToken(ts.SyntaxKind.GreaterThanEqualsToken),
            args[0]
          ),
          factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
          factory.createBinaryExpression(
            paramId,
            factory.createToken(ts.SyntaxKind.LessThanEqualsToken),
            args[1]
          )
        )
      );
    }
    if (method === "oneOf" && args.length > 0) {
      const checks = Array.from(args).map((arg) =>
        factory.createBinaryExpression(
          paramId,
          factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
          arg
        )
      );
      const combined = checks.reduce((left, right) =>
        factory.createBinaryExpression(left, factory.createToken(ts.SyntaxKind.BarBarToken), right)
      );
      return makeArrow(
        args.length > 1 ? factory.createParenthesizedExpression(combined) : combined
      );
    }
    if (method === "head" && args.length === 1) {
      return makeArrow(
        factory.createBinaryExpression(
          factory.createBinaryExpression(
            factory.createPropertyAccessExpression(paramId, "length"),
            factory.createToken(ts.SyntaxKind.GreaterThanToken),
            factory.createNumericLiteral(0)
          ),
          factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
          factory.createCallExpression(args[0], undefined, [
            factory.createElementAccessExpression(paramId, factory.createNumericLiteral(0)),
          ])
        )
      );
    }
    if (method === "has" && args.length === 1) {
      return makeArrow(
        factory.createBinaryExpression(
          factory.createBinaryExpression(
            factory.createTypeOfExpression(paramId),
            factory.createToken(ts.SyntaxKind.EqualsEqualsEqualsToken),
            factory.createStringLiteral("object")
          ),
          factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
          factory.createBinaryExpression(
            factory.createBinaryExpression(
              paramId,
              factory.createToken(ts.SyntaxKind.ExclamationEqualsEqualsToken),
              factory.createNull()
            ),
            factory.createToken(ts.SyntaxKind.AmpersandAmpersandToken),
            factory.createBinaryExpression(
              args[0],
              factory.createToken(ts.SyntaxKind.InKeyword),
              paramId
            )
          )
        )
      );
    }
    if (method === "regex" && args.length === 1) {
      return makeArrow(
        factory.createCallExpression(
          factory.createPropertyAccessExpression(args[0], "test"),
          undefined,
          [paramId]
        )
      );
    }
  }

  return undefined;
}

function expandGuardMatch(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  value: ts.Expression,
  arms: ts.ArrayLiteralExpression
): ts.Expression {
  const factory = ctx.factory;
  const guardArms: Array<{ predicate: ts.Expression; handler: ts.Expression }> = [];

  for (const element of arms.elements) {
    if (ts.isCallExpression(element) && ts.isIdentifier(element.expression)) {
      const fnName = element.expression.text;
      if (fnName === "when" && element.arguments.length === 2) {
        const rawPred = element.arguments[0];
        const predicate = tryOptimizeGuardPredicate(factory, rawPred) ?? rawPred;
        guardArms.push({
          predicate,
          handler: element.arguments[1],
        });
        continue;
      }
      if (fnName === "otherwise" && element.arguments.length === 1) {
        guardArms.push({
          predicate: factory.createArrowFunction(
            undefined,
            undefined,
            [],
            undefined,
            factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            factory.createTrue()
          ),
          handler: element.arguments[0],
        });
        continue;
      }
    }

    // Backwards-compatible [predicate, handler] tuple form
    if (ts.isArrayLiteralExpression(element) && element.elements.length === 2) {
      guardArms.push({
        predicate: element.elements[0],
        handler: element.elements[1],
      });
      continue;
    }

    ctx.reportError(
      element,
      "Invalid match arm: expected when(pred, handler), otherwise(handler), or [pred, handler]"
    );
  }

  if (guardArms.length === 0) {
    ctx.reportError(callExpr, "match() requires at least one arm");
    return callExpr;
  }

  const fallback = generateThrowIIFE(factory, "Non-exhaustive match: no guard matched");

  const entries = guardArms.map((arm) => ({
    condition: factory.createCallExpression(arm.predicate, undefined, [value]),
    result: factory.createCallExpression(arm.handler, undefined, [value]),
  }));

  return generateTernaryChain(factory, entries, fallback);
}

// ============================================================================
// Main Macro
// ============================================================================

function expandMatch(
  ctx: MacroContext,
  callExpr: ts.CallExpression,
  args: readonly ts.Expression[]
): ts.Expression {
  if (args.length < 2) {
    ctx.reportError(callExpr, "match() requires at least 2 arguments: value and handlers/arms");
    return callExpr;
  }

  const value = args[0];
  const handlersOrArms = args[1];

  if (ts.isArrayLiteralExpression(handlersOrArms)) {
    return expandGuardMatch(ctx, callExpr, value, handlersOrArms);
  }

  if (!ts.isObjectLiteralExpression(handlersOrArms)) {
    ctx.reportError(
      handlersOrArms,
      "match() second argument must be an object literal or array of guard arms"
    );
    return callExpr;
  }

  let explicitDiscriminant: string | undefined;
  if (args.length >= 3 && ts.isStringLiteral(args[2])) {
    explicitDiscriminant = args[2].text;
  }

  const analysis = analyzeMatchForm(ctx, value, handlersOrArms, explicitDiscriminant);
  performExhaustivenessCheck(ctx, callExpr, value, analysis);

  switch (analysis.form) {
    case MatchForm.Discriminant:
      return expandDiscriminantMatch(ctx, value, analysis);
    case MatchForm.IntegerLiteral:
      return expandIntegerMatch(ctx, value, analysis);
    case MatchForm.StringLiteral:
    case MatchForm.Mixed:
      return expandLiteralMatch(ctx, value, analysis);
    default:
      return callExpr;
  }
}

export const matchMacro = defineExpressionMacro({
  name: "match",
  module: "@typesugar/std",
  description: "Zero-cost exhaustive pattern matching with compile-time optimization",
  expand: expandMatch,
});

export const matchLiteralMacro = defineExpressionMacro({
  name: "matchLiteral",
  module: "@typesugar/std",
  description: "Zero-cost literal matching (deprecated — use match())",
  expand: expandMatch,
});

export const matchGuardMacro = defineExpressionMacro({
  name: "matchGuard",
  module: "@typesugar/std",
  description: "Zero-cost guard matching (deprecated — use match())",
  expand: expandMatch,
});

globalRegistry.register(matchMacro);
globalRegistry.register(matchLiteralMacro);
globalRegistry.register(matchGuardMacro);
