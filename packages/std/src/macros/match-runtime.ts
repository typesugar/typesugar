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

function inferDiscriminant(
  value: Record<string, unknown>,
  handlers: Record<string, unknown>
): string | undefined {
  for (const name of DISCRIMINANT_NAMES) {
    if (name in value) {
      const tag = value[name];
      if (typeof tag === "string" || typeof tag === "number" || typeof tag === "boolean") {
        if (String(tag) in handlers || "_" in handlers) return name;
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
// Overload: fluent chain (macro-only)
export function match(value: unknown): never;
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
    // Handle OR patterns: "a|b" splits on pipe
    for (const [handlerKey, handler] of Object.entries(handlers)) {
      if (handlerKey === "_") continue;
      const variants = handlerKey.split("|").filter(Boolean);
      if (variants.includes(tag)) return handler(value);
    }
    const fallback = handlers._;
    if (fallback) return fallback(value);
    throw new Error(`Non-exhaustive match: no handler for '${tag}'`);
  }

  // Primitive value: literal dispatch
  const handler = handlers[value] ?? handlers._;
  if (!handler) throw new Error(`Non-exhaustive match: no handler for '${String(value)}'`);
  return handler(value);
}
