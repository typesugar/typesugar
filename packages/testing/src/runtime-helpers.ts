/**
 * Runtime helpers referenced by the code the @typesugar/testing macros emit.
 *
 * The macros build small AST calls to these functions (imported into the
 * user's file via `ctx.ensureImport(..., "@typesugar/testing")`) instead of
 * splicing large blocks of generated code. Keeping the logic here means it is
 * ordinary, type-checked, unit-tested TypeScript, and the macro output only
 * carries the compile-time data (source text, display columns, type shapes).
 *
 * The `__`-prefixed exports are implementation details of the macro output;
 * `createMockObject` is also usable directly.
 */

import { createMockFn, type MockOf } from "./mock-fn.js";

// ============================================================================
// assert() — power-assertion failure diagram
// ============================================================================

function formatValue(v: unknown): string {
  if (typeof v === "function") return `[Function${v.name ? " " + v.name : ""}]`;
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "symbol") return v.toString();
  try {
    const s = JSON.stringify(v);
    // JSON.stringify(undefined) returns undefined, not a string.
    return typeof s === "string" ? s : String(v);
  } catch {
    return String(v);
  }
}

function renderRow(values: Array<[number, string]>, pipes: number[]): string {
  const cells: Array<[number, string]> = values.concat(pipes.map((p) => [p, "|"]));
  cells.sort((a, b) => a[0] - b[0]);
  let s = "";
  let col = 0;
  for (const [pos, text] of cells) {
    if (pos < col) continue;
    if (col < pos) {
      s += " ".repeat(pos - col);
      col = pos;
    }
    s += text;
    col += text.length;
  }
  return s;
}

/**
 * Throw the power-assert failure diagram.
 *
 * @param source - the asserted expression's source text
 * @param positions - display column of each recorded sub-expression
 * @param values - recorded sub-expression values, by index. A sparse array:
 *   an index that is absent was never evaluated (short-circuit), and is
 *   omitted from the diagram rather than evaluated a second time.
 * @param message - optional user message
 * @internal emitted by the `assert` macro
 */
export function __powerAssertFail(
  source: string,
  positions: readonly number[],
  values: readonly unknown[],
  message?: unknown
): never {
  const items: Array<[number, string]> = [];
  for (let i = 0; i < positions.length; i++) {
    if (!(i in values)) continue;
    items.push([positions[i], formatValue(values[i])]);
  }
  items.sort((a, b) => a[1].length - b[1].length || a[0] - b[0]);

  let diagram =
    "\n\nPower Assert Failed" +
    (message ? ": " + String(message) : "") +
    "\n\n  assert(" +
    source +
    ")\n";
  diagram +=
    renderRow(
      [],
      items.map((x) => x[0])
    ) + "\n";

  let remaining = items.slice();
  while (remaining.length > 0) {
    const row: Array<[number, string]> = [];
    const next: Array<[number, string]> = [];
    let lastEnd = -Infinity;
    for (const item of remaining) {
      if (item[0] >= lastEnd + 1) {
        row.push(item);
        lastEnd = item[0] + item[1].length;
      } else {
        next.push(item);
      }
    }
    diagram +=
      renderRow(
        row,
        next.map((x) => x[0])
      ) + "\n";
    remaining = next;
  }
  throw new Error(diagram);
}

// ============================================================================
// assertType<T>() — shape check driven by compile-time type info
// ============================================================================

/** The `typeof` results / checks a type can be validated against at runtime. */
export type __TypeCheck = "string" | "number" | "boolean" | "bigint" | "symbol" | "array";

/** A runtime-checkable description of a type, computed by the `assertType` macro. */
export type __TypeSpec =
  /** any / unknown / something not checkable at runtime — always passes */
  | { kind: "any" }
  /** primitives and unions of primitives / literals */
  | {
      kind: "primitive";
      checks: readonly __TypeCheck[];
      literals: readonly (string | number | boolean | null | undefined)[];
    }
  /** arrays and tuples */
  | { kind: "array" }
  /** object types: field-level checks */
  | { kind: "object"; fields: readonly __FieldSpec[] };

export interface __FieldSpec {
  name: string;
  /** display text of the field's type */
  type: string;
  optional: boolean;
  /** primitive checks the field must satisfy (empty: unchecked) */
  checks: readonly __TypeCheck[];
  /** literal values the field may take (empty: unchecked) */
  literals: readonly (string | number | boolean | null | undefined)[];
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function passes(
  v: unknown,
  checks: readonly __TypeCheck[],
  literals: readonly (string | number | boolean | null | undefined)[]
): boolean {
  if (checks.length === 0 && literals.length === 0) return true;
  for (const lit of literals) if (v === lit) return true;
  for (const c of checks) {
    if (c === "array" ? Array.isArray(v) : typeof v === c) return true;
  }
  return false;
}

function expectedText(
  checks: readonly __TypeCheck[],
  literals: readonly (string | number | boolean | null | undefined)[]
): string {
  return [
    ...checks,
    ...literals.map((l) => (l === undefined ? "undefined" : JSON.stringify(l))),
  ].join(" | ");
}

/**
 * Validate `value` against a compile-time type description and throw a
 * field-level diagnostic on mismatch.
 *
 * @internal emitted by the `assertType` macro
 */
export function __assertTypeCheck(
  value: unknown,
  typeName: string,
  spec: __TypeSpec,
  message?: unknown
): void {
  const prefix =
    `Type assertion failed for '${typeName}'` +
    (message !== undefined ? ": " + String(message) : "");

  switch (spec.kind) {
    case "any":
      return;
    case "primitive":
      if (!passes(value, spec.checks, spec.literals)) {
        throw new Error(
          `${prefix}: expected ${expectedText(spec.checks, spec.literals)}, got ${
            typeof value === "string" ? JSON.stringify(value) : describe(value)
          }`
        );
      }
      return;
    case "array":
      if (!Array.isArray(value)) {
        throw new Error(`${prefix}: expected array, got ${describe(value)}`);
      }
      return;
    case "object": {
      if (typeof value !== "object" || value === null) {
        throw new Error(`${prefix}: expected object, got ${describe(value)}`);
      }
      const errors: string[] = [];
      for (const field of spec.fields) {
        const actual = (value as Record<string, unknown>)[field.name];
        if (actual === undefined) {
          if (!field.optional) {
            errors.push(`Field '${field.name}': missing (required, expected ${field.type})`);
          }
          continue;
        }
        if (!passes(actual, field.checks, field.literals)) {
          errors.push(
            `Field '${field.name}': expected ${expectedText(field.checks, field.literals)}, got ${
              typeof actual === "string" && field.literals.length > 0
                ? JSON.stringify(actual)
                : describe(actual)
            }`
          );
        }
      }
      if (errors.length > 0) {
        throw new Error(prefix + "\n  - " + errors.join("\n  - "));
      }
      return;
    }
  }
}

// ============================================================================
// @derive(Arbitrary) — seeded PRNG
// ============================================================================

/**
 * Deterministic LCG used by `@derive(Arbitrary)` generators.
 *
 * @internal emitted by the `Arbitrary` derive
 */
export function __seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ============================================================================
// mock<T>() / @mock — mock objects
// ============================================================================

/**
 * Build a mock object with one tracked {@link createMockFn} per method name,
 * plus `_calls` (per-method argument lists) and `_reset()`.
 *
 * This is what `mock<T>()` and `@mock` expand to (the macro supplies the
 * method names from the type), and it can be called directly without the
 * transformer.
 *
 * @example
 * ```typescript
 * const svc = createMockObject<UserService>(["getUser", "createUser"]);
 * svc.getUser.mockReturnValue(user);
 * ```
 */
export function createMockObject<T>(methodNames: readonly string[]): MockOf<T> {
  const calls: Record<string, unknown[][]> = {};
  const mockObj: Record<string, unknown> = { _calls: calls };

  for (const name of methodNames) {
    const inner = createMockFn<(...args: any[]) => any>();
    const own: unknown[][] = [];
    calls[name] = own;

    const tracked = ((...args: any[]) => {
      own.push(args);
      return inner(...args);
    }) as any;
    // Forward the MockFn API; chainable methods return the tracked function.
    for (const key of Object.keys(inner)) {
      const member = (inner as any)[key];
      if (typeof member === "function") {
        tracked[key] = (...a: any[]) => {
          const r = member(...a);
          return r === inner ? tracked : r;
        };
      }
    }
    Object.defineProperty(tracked, "calls", {
      get: () => inner.calls,
      enumerable: true,
    });
    mockObj[name] = tracked;
  }

  mockObj._reset = () => {
    for (const name of methodNames) {
      calls[name].length = 0;
      (mockObj[name] as any).mockReset();
    }
  };

  return mockObj as unknown as MockOf<T>;
}
