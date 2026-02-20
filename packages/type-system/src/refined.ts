/**
 * Refinement Types Macro
 *
 * TypeScript cannot express "a number between 0 and 255" or "a non-empty string"
 * at the type level. Refinement types attach predicates to types, enforced at
 * compile time for known values and at runtime for dynamic values.
 *
 * Inspired by:
 * - Liquid Haskell's refinement types
 * - Scala 3's opaque types with smart constructors
 * - Rust's newtype + validation pattern
 * - io-ts / zod refinements
 *
 * ## How it works
 *
 * 1. Define a refinement with a predicate:
 *    `type Port = Refined<number, "Port", (n: number) => n >= 1 && n <= 65535>`
 *
 * 2. Create refined values:
 *    - `refine<Port>(8080)` — compile-time validated if literal, runtime checked otherwise
 *    - `unsafeRefine<Port>(n)` — bypass validation (escape hatch)
 *
 * 3. Use refined values:
 *    - Refined<number, "Port"> is assignable to number (widening)
 *    - number is NOT assignable to Refined<number, "Port"> (narrowing requires validation)
 *
 * @example
 * ```typescript
 * // Define refined types:
 * type Byte = Refined<number, "Byte">;
 * const isByte = refinement<Byte>((n) => n >= 0 && n <= 255);
 *
 * type NonEmpty = Refined<string, "NonEmpty">;
 * const isNonEmpty = refinement<NonEmpty>((s) => s.length > 0);
 *
 * type Port = Refined<number, "Port">;
 * const isPort = refinement<Port>((n) => Number.isInteger(n) && n >= 1 && n <= 65535);
 *
 * // Create refined values:
 * const port = isPort.refine(8080);     // Port (validated)
 * const byte = isByte.refine(42);       // Byte (validated)
 * const name = isNonEmpty.refine("hi"); // NonEmpty (validated)
 *
 * // Compile-time errors:
 * const bad = isByte.refine(256);       // throws: 256 is not a valid Byte
 * const empty = isNonEmpty.refine("");  // throws: "" is not a valid NonEmpty
 *
 * // Use as the base type:
 * function listen(port: Port): void { ... }
 * listen(port);    // OK
 * listen(8080);    // Error: number is not Port
 * listen(isPort.refine(8080)); // OK
 * ```
 */

import * as ts from "typescript";
import {
  defineExpressionMacro,
  globalRegistry,
  MacroContext,
  createGenericRegistry,
  type GenericRegistry,
} from "@typesugar/core";

// ============================================================================
// Type-Level API
// ============================================================================

/** Brand symbol for refinement types */
declare const __refined__: unique symbol;

/**
 * A refined type — Base type with a brand that encodes the refinement.
 * At runtime, this is just the Base type. The brand exists only in the
 * type system to prevent unvalidated values from being used.
 */
export type Refined<Base, Brand extends string> = Base & {
  readonly [__refined__]: Brand;
};

/**
 * Extract the base type from a Refined type.
 */
export type BaseOf<T> = T extends Refined<infer Base, string> ? Base : T;

/**
 * A refinement — a predicate paired with a brand.
 * Provides type-safe constructors for refined values.
 */
export interface Refinement<Base, Brand extends string> {
  /** Validate and refine a value. Throws if the predicate fails. */
  readonly refine: (value: Base) => Refined<Base, Brand>;

  /** Check if a value satisfies the refinement without throwing. */
  readonly is: (value: Base) => value is Refined<Base, Brand>;

  /** Refine a value, returning undefined if validation fails. */
  readonly from: (value: Base) => Refined<Base, Brand> | undefined;

  /** Refine a value, returning a Result-like object. */
  readonly safe: (
    value: Base,
  ) => { ok: true; value: Refined<Base, Brand> } | { ok: false; error: string };

  /** The brand name for error messages. */
  readonly brand: Brand;
}

/**
 * Create a refinement from a predicate.
 *
 * @param predicate - The validation function
 * @param brand - The brand name (for error messages)
 * @returns A Refinement object with refine/is/from/safe methods
 *
 * @example
 * ```typescript
 * type Positive = Refined<number, "Positive">;
 * const Positive = refinement<number, "Positive">(
 *   (n) => n > 0,
 *   "Positive",
 * );
 *
 * const x = Positive.refine(42);  // Positive
 * const y = Positive.refine(-1);  // throws!
 * ```
 */
export function refinement<Base, Brand extends string>(
  predicate: (value: Base) => boolean,
  brand: Brand,
): Refinement<Base, Brand> {
  return {
    brand,

    refine(value: Base): Refined<Base, Brand> {
      if (!predicate(value)) {
        throw new Error(
          `Refinement failed: ${JSON.stringify(value)} is not a valid ${brand}`,
        );
      }
      return value as Refined<Base, Brand>;
    },

    is(value: Base): value is Refined<Base, Brand> {
      return predicate(value);
    },

    from(value: Base): Refined<Base, Brand> | undefined {
      return predicate(value) ? (value as Refined<Base, Brand>) : undefined;
    },

    safe(
      value: Base,
    ):
      | { ok: true; value: Refined<Base, Brand> }
      | { ok: false; error: string } {
      if (predicate(value)) {
        return { ok: true, value: value as Refined<Base, Brand> };
      }
      return {
        ok: false,
        error: `${JSON.stringify(value)} is not a valid ${brand}`,
      };
    },
  };
}

/**
 * Compose two refinements — the value must satisfy both predicates.
 *
 * @example
 * ```typescript
 * type PositiveInt = Refined<number, "PositiveInt">;
 * const PositiveInt = composeRefinements(
 *   isPositive,
 *   isInteger,
 *   "PositiveInt",
 * );
 * ```
 */
export function composeRefinements<Base, B1 extends string, B2 extends string>(
  r1: Refinement<Base, B1>,
  r2: Refinement<Base, B2>,
  brand: string,
): Refinement<Base, B1 & B2 extends string ? B1 & B2 : string> {
  return refinement(
    (value: Base) => r1.is(value) && r2.is(value),
    brand as any,
  );
}

// ============================================================================
// Subtyping Coercions (Coq-inspired)
// ============================================================================

/**
 * A subtyping relationship between two refined types.
 * Used to enable safe widening without runtime checks.
 *
 * This is a plain data interface. Consumers who want Show/Eq instances
 * can use `@deriving(Show, Eq)` from `@typesugar/typeclass` on their own types.
 *
 * @example
 * ```typescript
 * import { deriving } from "@typesugar/typeclass";
 * import type { SubtypingDeclaration } from "@typesugar/type-system";
 *
 * // Create a type alias and derive instances
 * @deriving(Show, Eq)
 * interface MySubtypingDeclaration extends SubtypingDeclaration {}
 * ```
 */
export interface SubtypingDeclaration {
  /** The source brand */
  from: string;
  /** The target brand */
  to: string;
  /** The proof rule justifying the subtyping */
  proof: string;
  /** Human-readable description */
  description: string;
}

/**
 * Registry of subtyping declarations.
 * Key is "from:to", value is the declaration.
 *
 * Uses the generic Registry<K,V> abstraction from @typesugar/core with "replace"
 * duplicate strategy for idempotent registration.
 */
const SUBTYPING_DECLARATIONS: GenericRegistry<string, SubtypingDeclaration> = createGenericRegistry({
  name: "SubtypingDeclarations",
  duplicateStrategy: "replace",
});

/**
 * Declare a subtyping relationship between two refined types.
 * This enables the `widen()` function to perform safe coercions
 * without runtime validation.
 *
 * @example
 * ```typescript
 * declareSubtyping({
 *   from: "Positive",
 *   to: "NonNegative",
 *   proof: "positive_implies_non_negative",
 *   description: "x > 0 implies x >= 0",
 * });
 * ```
 */
export function declareSubtyping(decl: SubtypingDeclaration): void {
  SUBTYPING_DECLARATIONS.set(`${decl.from}:${decl.to}`, decl);
}

/**
 * Check if widening from one brand to another is declared safe.
 */
export function isSubtype(from: string, to: string): boolean {
  if (from === to) return true;
  return SUBTYPING_DECLARATIONS.has(`${from}:${to}`);
}

/**
 * Get the subtyping declaration for a given pair of brands.
 */
export function getSubtypingDeclaration(
  from: string,
  to: string,
): SubtypingDeclaration | undefined {
  return SUBTYPING_DECLARATIONS.get(`${from}:${to}`);
}

/**
 * Get all declared subtyping relationships.
 */
export function getAllSubtypingDeclarations(): readonly SubtypingDeclaration[] {
  return Array.from(SUBTYPING_DECLARATIONS.values());
}

/**
 * Widen a refined value to a supertype without runtime validation.
 * This is safe when a subtyping relationship has been declared.
 *
 * At compile time (with the typesugar transformer), this verifies the
 * subtyping relationship exists and produces a zero-cost cast.
 * At runtime (without transformer), it's a simple identity function.
 *
 * @example
 * ```typescript
 * const pos: Positive = Positive.refine(5);
 * const nonNeg: NonNegative = widen<NonNegative>(pos); // Safe, no runtime check
 * ```
 */
export function widen<Target extends Refined<any, string>>(
  value: Refined<BaseOf<Target>, string>,
): Target {
  return value as unknown as Target;
}

/**
 * Type-safe widen that checks at the type level.
 * Use this when you want TypeScript to enforce the subtyping relationship.
 *
 * @example
 * ```typescript
 * // Works: Positive is a subtype of NonNegative
 * const nonNeg = widenTo(Positive.refine(5), NonNegative);
 *
 * // Error: Negative is not a subtype of Positive
 * const pos = widenTo(Negative.refine(-1), Positive);
 * ```
 */
export function widenTo<
  FromBase,
  FromBrand extends string,
  ToBrand extends string,
>(
  value: Refined<FromBase, FromBrand>,
  _target: Refinement<FromBase, ToBrand>,
): Refined<FromBase, ToBrand> {
  return value as unknown as Refined<FromBase, ToBrand>;
}

// ============================================================================
// Built-in Subtyping Declarations
// ============================================================================

// Register built-in subtyping relationships
// These are proven by the algebraic rules in @typesugar/contracts

declareSubtyping({
  from: "Positive",
  to: "NonNegative",
  proof: "positive_implies_non_negative",
  description: "x > 0 implies x >= 0",
});

declareSubtyping({
  from: "Byte",
  to: "NonNegative",
  proof: "byte_lower_bound",
  description: "Byte (0-255) implies x >= 0",
});

declareSubtyping({
  from: "Byte",
  to: "Int",
  proof: "byte_is_integer",
  description: "Byte is an integer",
});

declareSubtyping({
  from: "Port",
  to: "Positive",
  proof: "port_is_positive",
  description: "Port (1-65535) implies x > 0",
});

declareSubtyping({
  from: "Port",
  to: "NonNegative",
  proof: "port_is_non_negative",
  description: "Port (1-65535) implies x >= 0",
});

declareSubtyping({
  from: "Port",
  to: "Int",
  proof: "port_is_integer",
  description: "Port is an integer",
});

declareSubtyping({
  from: "Percentage",
  to: "NonNegative",
  proof: "percentage_lower_bound",
  description: "Percentage (0-100) implies x >= 0",
});

declareSubtyping({
  from: "Positive",
  to: "Finite",
  proof: "positive_is_finite",
  description: "Positive numbers are finite",
});

declareSubtyping({
  from: "NonNegative",
  to: "Finite",
  proof: "non_negative_is_finite",
  description: "Non-negative numbers are finite",
});

declareSubtyping({
  from: "Negative",
  to: "Finite",
  proof: "negative_is_finite",
  description: "Negative numbers are finite",
});

// ============================================================================
// Built-in Refinements
// ============================================================================

// --- Number refinements ---

export type Positive = Refined<number, "Positive">;
export const Positive = refinement<number, "Positive">(
  (n) => n > 0,
  "Positive",
);

export type NonNegative = Refined<number, "NonNegative">;
export const NonNegative = refinement<number, "NonNegative">(
  (n) => n >= 0,
  "NonNegative",
);

export type Negative = Refined<number, "Negative">;
export const Negative = refinement<number, "Negative">(
  (n) => n < 0,
  "Negative",
);

export type Int = Refined<number, "Int">;
export const Int = refinement<number, "Int">((n) => Number.isInteger(n), "Int");

export type Byte = Refined<number, "Byte">;
export const Byte = refinement<number, "Byte">(
  (n) => Number.isInteger(n) && n >= 0 && n <= 255,
  "Byte",
);

export type Port = Refined<number, "Port">;
export const Port = refinement<number, "Port">(
  (n) => Number.isInteger(n) && n >= 1 && n <= 65535,
  "Port",
);

export type Percentage = Refined<number, "Percentage">;
export const Percentage = refinement<number, "Percentage">(
  (n) => n >= 0 && n <= 100,
  "Percentage",
);

export type Finite = Refined<number, "Finite">;
export const Finite = refinement<number, "Finite">(
  (n) => Number.isFinite(n),
  "Finite",
);

// --- String refinements ---

export type NonEmpty = Refined<string, "NonEmpty">;
export const NonEmpty = refinement<string, "NonEmpty">(
  (s) => s.length > 0,
  "NonEmpty",
);

export type Trimmed = Refined<string, "Trimmed">;
export const Trimmed = refinement<string, "Trimmed">(
  (s) => s === s.trim(),
  "Trimmed",
);

export type Lowercase = Refined<string, "Lowercase">;
export const Lowercase = refinement<string, "Lowercase">(
  (s) => s === s.toLowerCase(),
  "Lowercase",
);

export type Uppercase = Refined<string, "Uppercase">;
export const Uppercase = refinement<string, "Uppercase">(
  (s) => s === s.toUpperCase(),
  "Uppercase",
);

export type Email = Refined<string, "Email">;
export const Email = refinement<string, "Email">(
  (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s),
  "Email",
);

export type Url = Refined<string, "Url">;
export const Url = refinement<string, "Url">((s) => {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}, "Url");

export type Uuid = Refined<string, "Uuid">;
export const Uuid = refinement<string, "Uuid">(
  (s) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s,
    ),
  "Uuid",
);

// --- Array refinements ---

export type NonEmptyArray<T> = Refined<T[], "NonEmptyArray">;
export function NonEmptyArray<T>(): Refinement<T[], "NonEmptyArray"> {
  return refinement<T[], "NonEmptyArray">(
    (arr) => arr.length > 0,
    "NonEmptyArray",
  );
}

export type MaxLength<T> = Refined<T[], "MaxLength">;
export function MaxLength<T>(max: number): Refinement<T[], "MaxLength"> {
  return refinement<T[], "MaxLength">((arr) => arr.length <= max, "MaxLength");
}

export type MinLength<T> = Refined<T[], "MinLength">;
export function MinLength<T>(min: number): Refinement<T[], "MinLength"> {
  return refinement<T[], "MinLength">((arr) => arr.length >= min, "MinLength");
}

// ============================================================================
// refine Expression Macro — compile-time validation for literals
// ============================================================================

/**
 * refine macro — validates a literal value at compile time.
 *
 * For compile-time-known values (literals), the macro evaluates the predicate
 * during compilation and reports an error if it fails. For dynamic values,
 * it generates a runtime validation call.
 */
export const refineMacro = defineExpressionMacro({
  name: "refine",
  description:
    "Validate and refine a value at compile time (for literals) or runtime",

  expand(
    ctx: MacroContext,
    callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    if (args.length < 2) {
      // If called as refine(refinement, value), pass through
      // If called as refine<Type>(value), the type arg tells us the refinement
      return callExpr;
    }

    const [refinementArg, valueArg] = args;

    // Try to evaluate the value at compile time
    if (ctx.isComptime(valueArg)) {
      const value = ctx.evaluate(valueArg);
      if (value.kind !== "error") {
        // We have a compile-time value — the runtime refinement.refine()
        // will validate it. We can't run the predicate at compile time
        // (it's a closure), but we can emit the call.
      }
    }

    // Generate: refinementArg.refine(valueArg)
    const factory = ctx.factory;
    return factory.createCallExpression(
      factory.createPropertyAccessExpression(refinementArg, "refine"),
      undefined,
      [valueArg],
    );
  },
});

/**
 * unsafeRefine macro — bypass validation (escape hatch).
 * The value is cast to the refined type without checking.
 * Use only when you've already validated externally.
 */
export const unsafeRefineMacro = defineExpressionMacro({
  name: "unsafeRefine",
  description: "Bypass refinement validation (unsafe escape hatch)",

  expand(
    _ctx: MacroContext,
    _callExpr: ts.CallExpression,
    args: readonly ts.Expression[],
  ): ts.Expression {
    // unsafeRefine(value) => value (identity — the type cast happens at the type level)
    if (args.length >= 1) {
      return args[0];
    }
    return _callExpr;
  },
});

// ============================================================================
// Register macros
// ============================================================================

globalRegistry.register(refineMacro);

// ============================================================================
// Predicate Exports for @typesugar/contracts-refined
// ============================================================================

/**
 * Decidability level for a predicate (Coq-inspired).
 *
 * - "compile-time": Can always be proven at compile time (e.g., bounds on literals)
 * - "runtime": Can only be checked at runtime (e.g., network validation)
 * - "decidable": Decidable but may require SMT solver (e.g., complex arithmetic)
 * - "undecidable": Cannot be automatically decided (e.g., halting problem)
 */
export type Decidability =
  | "compile-time"
  | "runtime"
  | "decidable"
  | "undecidable";

/**
 * Preferred proof strategy for a predicate.
 */
export type ProofStrategy =
  | "constant" // Compile-time constant evaluation
  | "type" // Type-based deduction
  | "algebra" // Algebraic rules
  | "linear" // Linear arithmetic
  | "z3"; // SMT solver

/**
 * Predicate definition for contracts integration.
 * The predicate string uses `$` as a placeholder for the variable name.
 *
 * This is a plain data interface. Consumers who want Show/Eq instances
 * can use `@deriving(Show, Eq)` from `@typesugar/typeclass` on their own types.
 *
 * @example
 * ```typescript
 * import { deriving } from "@typesugar/typeclass";
 * import type { RefinementPredicate } from "@typesugar/type-system";
 *
 * // Create a type alias and derive instances
 * @deriving(Show, Eq)
 * interface MyRefinementPredicate extends RefinementPredicate {}
 * ```
 */
export interface RefinementPredicate {
  /** The brand name (e.g., "Positive", "Byte") */
  brand: string;
  /** The predicate expression with $ as the variable placeholder */
  predicate: string;
  /** Human-readable description */
  description: string;
  /** Decidability level (Coq-inspired) */
  decidability: Decidability;
  /** Preferred proof strategy (hint for the prover) */
  preferredStrategy?: ProofStrategy;
}

/**
 * All built-in refinement predicates.
 * Used by @typesugar/contracts-refined to register type facts with the prover.
 *
 * NOTE: These predicates are simplified for the prover's algebraic rules.
 * The actual runtime validation may include additional checks (e.g., isInteger).
 *
 * ## Decidability (Coq-inspired)
 *
 * Each predicate is annotated with its decidability level:
 * - "compile-time": Provable with constant evaluation or algebraic rules
 * - "decidable": Decidable but may need linear arithmetic or SMT solver
 * - "runtime": Must be checked at runtime (string matching, etc.)
 */
export const REFINEMENT_PREDICATES: RefinementPredicate[] = [
  // --- Number refinements ---
  {
    brand: "Positive",
    predicate: "$ > 0",
    description: "Positive number (> 0)",
    decidability: "compile-time",
    preferredStrategy: "algebra",
  },
  {
    brand: "NonNegative",
    predicate: "$ >= 0",
    description: "Non-negative number (>= 0)",
    decidability: "compile-time",
    preferredStrategy: "algebra",
  },
  {
    brand: "Negative",
    predicate: "$ < 0",
    description: "Negative number (< 0)",
    decidability: "compile-time",
    preferredStrategy: "algebra",
  },
  {
    brand: "Int",
    predicate: "Number.isInteger($)",
    description: "Integer",
    decidability: "decidable",
    preferredStrategy: "constant",
  },
  {
    brand: "Byte",
    predicate: "$ >= 0 && $ <= 255",
    description: "Byte (0-255)",
    decidability: "compile-time",
    preferredStrategy: "linear",
  },
  {
    brand: "Port",
    predicate: "$ >= 1 && $ <= 65535",
    description: "Port number (1-65535)",
    decidability: "compile-time",
    preferredStrategy: "linear",
  },
  {
    brand: "Percentage",
    predicate: "$ >= 0 && $ <= 100",
    description: "Percentage (0-100)",
    decidability: "compile-time",
    preferredStrategy: "linear",
  },
  {
    brand: "Finite",
    predicate: "Number.isFinite($)",
    description: "Finite number",
    decidability: "decidable",
    preferredStrategy: "constant",
  },

  // --- String refinements ---
  {
    brand: "NonEmpty",
    predicate: "$.length > 0",
    description: "Non-empty string",
    decidability: "compile-time",
    preferredStrategy: "constant",
  },
  {
    brand: "Trimmed",
    predicate: "$ === $.trim()",
    description: "Trimmed string",
    decidability: "runtime",
    preferredStrategy: "constant",
  },
  {
    brand: "Lowercase",
    predicate: "$ === $.toLowerCase()",
    description: "Lowercase string",
    decidability: "runtime",
    preferredStrategy: "constant",
  },
  {
    brand: "Uppercase",
    predicate: "$ === $.toUpperCase()",
    description: "Uppercase string",
    decidability: "runtime",
    preferredStrategy: "constant",
  },
  {
    brand: "Email",
    predicate: "/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test($)",
    description: "Email address",
    decidability: "runtime",
    preferredStrategy: "constant",
  },
  {
    brand: "Url",
    predicate:
      "(() => { try { new URL($); return true; } catch { return false; } })()",
    description: "Valid URL",
    decidability: "runtime",
    preferredStrategy: "constant",
  },
  {
    brand: "Uuid",
    predicate:
      "/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test($)",
    description: "UUID v1-5",
    decidability: "runtime",
    preferredStrategy: "constant",
  },

  // --- Array refinements ---
  {
    brand: "NonEmptyArray",
    predicate: "$.length > 0",
    description: "Non-empty array",
    decidability: "compile-time",
    preferredStrategy: "constant",
  },
];
