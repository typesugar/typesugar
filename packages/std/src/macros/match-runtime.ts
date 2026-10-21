/**
 * Runtime fallback for `match()` (PEP-050 Case-1).
 *
 * This entry is **runtime-only** and does NOT import `typescript`. It holds the
 * runtime `match(value, handlers)` dispatch used when the value is matched
 * imperatively (no fluent chain). The fluent `.case().then().else()` chain is a
 * compile-time macro and lives in `match.ts` (loaded by the transformer via the
 * `./macros` entry).
 */

// Common discriminant property names, ordered by frequency
const DISCRIMINANT_NAMES = [
  "kind",
  "_tag",
  "type",
  "ok",
  "status",
  "tag",
  "variant",
  "action",
  "event",
  "case",
  "state",
  "name",
  "nodeType",
];

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function inferDiscriminant(
  value: Record<string, unknown>,
  handlers: Record<string, any>
): string | undefined {
  for (const name of DISCRIMINANT_NAMES) {
    if (name in value) {
      const tag = value[name];
      if (typeof tag === "string" || typeof tag === "number" || typeof tag === "boolean") {
        if (findHandler(handlers, String(tag))) return name;
      }
    }
  }
  // Fallback: check boolean "true"/"false" handler keys
  const keys = Object.keys(handlers).filter((k) => k !== "_");
  if (keys.length === 2 && keys.includes("true") && keys.includes("false")) {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "boolean") return k;
    }
  }
  return undefined;
}

/**
 * Find the handler for a tag: an exact own key, then an `"a|b"` OR key, then
 * `_`. Own properties only — `match("toString", { _: ... })` must not pick up
 * `Object.prototype.toString` (deep review #17).
 */
function findHandler(
  handlers: Record<string, any>,
  tag: string
): ((v: unknown) => unknown) | undefined {
  if (tag !== "_" && hasOwn(handlers, tag)) return handlers[tag];
  for (const handlerKey of Object.keys(handlers)) {
    if (handlerKey === "_" || !handlerKey.includes("|")) continue;
    if (handlerKey.split("|").filter(Boolean).includes(tag)) return handlers[handlerKey];
  }
  return hasOwn(handlers, "_") ? handlers._ : undefined;
}

// ============================================================================
// Types of the fluent chain for tools that check UNEXPANDED source
// ============================================================================
//
// The transformer replaces a whole `match(x).case(...).then(...)` chain, so
// none of these types exist in the expanded program. They are what plain
// `tsc`, tsup's own `.d.ts` step, typescript-eslint, typedoc and anything
// else that type-checks the source as written see (Turf case study, F20).
// The chain used to be typed `never`, so every fluent match failed there
// with "Property 'case' does not exist on type 'never'".
//
// What they give: literal and `.else()` arms type-check, and the chain's
// value is the union of its arm results. What they can't give:
// - Names bound by a pattern (`.case({ kind: "circle", radius: r })`) are
//   undeclared identifiers to plain tsc (TS2304), whatever these types say.
// - Exhaustiveness. TypeScript can't tell which `.then()` is the last, so the
//   chain's value after every `.then()` is also the chain (`R & FluentMatch`).
//   For the same reason `null`/`undefined` results are kept out of that
//   intersection (it would collapse to `never`) and unioned beside it. A
//   chain that goes on after an arm whose result may be `null`/`undefined`
//   is therefore "possibly null" (TS2531/TS18047) to plain tsc: put that arm
//   last or end the chain with `.else()`. typesugar's own checks suppress it.

/**
 * The fluent `match(x)` chain, as tools that type-check unexpanded source
 * see it. `R` is the union of the arm results so far.
 */
export interface FluentMatch<T, R = never> {
  /** Start an arm. The pattern is checked by the macro, not by these types. */
  case(pattern: unknown): FluentMatchCase<T, R>;
  /** The value for every case the arms above don't cover. Ends the chain. */
  else<V>(value: V): R | V;
}

/** An arm between `.case()` and `.then()`. */
export interface FluentMatchCase<T, R> {
  /** Another pattern for the same arm. */
  or(pattern: unknown): FluentMatchCase<T, R>;
  /** Bind the whole matched value. */
  as(binding: unknown): FluentMatchCase<T, R>;
  /** A guard: the arm matches only when it is truthy. */
  if(guard: unknown): FluentMatchCase<T, R>;
  /** The arm's result. */
  then<V>(value: V): FluentMatchArms<T, R | V>;
}

/**
 * The value of a chain that ends in `.then()`: the arm results so far, which
 * can also be continued with `.case()` / `.else()`. Nullish results sit
 * outside the intersection, which would otherwise collapse to `never`.
 */
export type FluentMatchArms<T, R> = [R] extends [never]
  ? FluentMatch<T, never>
  : (NonNullable<R> & FluentMatch<T, R>) | Extract<R, null | undefined>;

/**
 * Runtime match function.
 *
 * Two forms:
 * 1. `match(value, handlers)` — discriminated union or literal dispatch (runtime)
 * 2. `match(value)` — fluent chain (macro-only, requires transformer)
 */
// Overload: discriminated union with `kind` property
export function match<T extends { kind: string }, R>(
  value: T,
  handlers: { [K in T["kind"]]?: (value: Extract<T, { kind: K }>) => R } & { _?: (value: T) => R }
): R;
// Overload: discriminated union with explicit discriminant
export function match<T extends object, K extends keyof T & string, R>(
  value: T,
  handlers: Record<string, (value: T) => R>,
  discriminant: K
): R;
// Overload: literal dispatch
export function match<T extends string | number, R>(
  value: T,
  handlers: Partial<Record<string & T, (value: T) => R>> & { _?: (value: T) => R }
): R;
// Overload: fluent chain (macro-only; typed for tools that read unexpanded source)
export function match<T>(value: T): FluentMatch<T>;
// Implementation
export function match(value: any, handlers?: Record<string, any>, discriminant?: string): any {
  if (handlers === undefined) {
    throw new Error(
      "match() fluent API requires the typesugar transformer. " +
        "The .case().then().else() chain is expanded at compile time. " +
        "Ensure your build pipeline includes @typesugar/transformer, " +
        "or use the runtime form: match(value, { variant: handler })."
    );
  }

  // Object value: discriminated union matching
  if (typeof value === "object" && value !== null) {
    const key = discriminant ?? inferDiscriminant(value, handlers);
    if (!key) throw new Error("Non-exhaustive match: cannot infer discriminant property");
    const tag = String(value[key]);
    const handler = findHandler(handlers, tag);
    if (handler) return handler(value);
    throw new Error(`Non-exhaustive match: no handler for '${tag}'`);
  }

  // Primitive value: literal dispatch
  const handler = findHandler(handlers, String(value));
  if (!handler) throw new Error(`Non-exhaustive match: no handler for '${String(value)}'`);
  return handler(value);
}
