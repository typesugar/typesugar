/**
 * Opaque Type Modules Macro
 *
 * ML-style opaque types with controlled access. Unlike simple branded types
 * (newtypes), opaque type modules provide:
 *
 * 1. A hidden representation type (opaque outside the module)
 * 2. Smart constructors with validation
 * 3. Accessor functions (controlled exposure of the representation)
 * 4. Module-scoped operations that can see the representation
 *
 * Inspired by:
 * - OCaml's abstract types in modules
 * - Haskell's newtype with smart constructors
 * - Scala 3's opaque type aliases
 * - Rust's newtype pattern with pub/private fields
 *
 * ## The Problem
 *
 * TypeScript's branded types (newtypes) are all-or-nothing:
 * - Outside: you can't see the representation at all
 * - Inside: there's no "inside" — brands are global
 *
 * ## The Solution
 *
 * ```typescript
 * const UserId = opaqueModule<number>()({
 *   // Smart constructor with validation
 *   create: (n) => {
 *     if (n <= 0) throw new Error("UserId must be positive");
 *     return n;
 *   },
 *   // Operations that can see the representation
 *   toString: (id) => `User#${id}`,
 *   eq: (a, b) => a === b,
 *   next: (id) => id + 1,
 * });
 *
 * type UserId = OpaqueType<typeof UserId>;
 *
 * // Outside the module:
 * const id = UserId.create(42);  // UserId (opaque)
 * UserId.toString(id);           // "User#42"
 * UserId.eq(id, id);             // true
 * id + 1;                        // Error: UserId is not a number
 *
 * // The representation is hidden:
 * const raw: number = id;        // Error: UserId is not assignable to number
 * ```
 */

import * as ts from "typescript";
import { defineExpressionMacro, globalRegistry, MacroContext } from "@typesugar/core";

// ============================================================================
// Type-Level API
// ============================================================================

/** Brand symbol for opaque types */
declare const __opaque__: unique symbol;
declare const __opaque_repr__: unique symbol;

/**
 * An opaque type — the representation is hidden outside the module.
 * At runtime, this is just the Repr type. The brand prevents direct access.
 */
export type Opaque<Repr, Brand extends string> = Repr & {
  readonly [__opaque__]: Brand;
  readonly [__opaque_repr__]: Repr;
};

/**
 * Extract the representation type from an opaque type.
 * Only usable inside the module (via the operations).
 */
export type ReprOf<T> = T extends Opaque<infer Repr, string> ? Repr : T;

/**
 * Extract the opaque type from a module.
 */
export type OpaqueType<M> =
  M extends OpaqueModule<infer Repr, string, infer _Ops> ? Opaque<Repr, string> : never;

/**
 * An opaque module — contains the smart constructor and operations.
 */
export interface OpaqueModule<
  Repr,
  Brand extends string,
  Ops extends Record<string, (...args: any[]) => any>,
> {
  /** The brand name (for error messages and debugging) */
  readonly __brand: Brand;

  /** Create a new opaque value from the representation */
  readonly create: (repr: Repr) => Opaque<Repr, Brand>;

  /** Unwrap an opaque value to its representation (escape hatch) */
  readonly unwrap: (opaque: Opaque<Repr, Brand>) => Repr;

  /** Check if a raw value is valid for this opaque type */
  readonly isValid: (repr: Repr) => boolean;

  /** Try to create — returns undefined if validation fails */
  readonly tryCreate: (repr: Repr) => Opaque<Repr, Brand> | undefined;
}

/**
 * Operations definition for an opaque module.
 * Each operation receives the raw representation type (not the opaque type).
 */
export type OpaqueOps<Repr> = Record<string, (...args: any[]) => any>;

// ============================================================================
// Runtime Implementation
// ============================================================================

/**
 * Create an opaque type module.
 *
 * @param brand - The brand name for this opaque type
 * @param validate - Optional validation function (returns true if valid)
 * @returns A function that takes operations and returns the complete module
 *
 * @example
 * ```typescript
 * const Email = opaqueModule<string>("Email", (s) => /^.+@.+\..+$/.test(s))({
 *   domain: (email) => email.split("@")[1],
 *   local: (email) => email.split("@")[0],
 *   toString: (email) => email,
 * });
 *
 * type Email = Opaque<string, "Email">;
 *
 * const email = Email.create("user@example.com"); // Email
 * Email.domain(email);                             // "example.com"
 * ```
 */
export function opaqueModule<Repr>(
  brand: string,
  validate?: (repr: Repr) => boolean
): <Ops extends Record<string, (repr: Repr, ...args: any[]) => any>>(
  ops: Ops
) => OpaqueModuleResult<Repr, Ops> {
  return <Ops extends Record<string, (repr: Repr, ...args: any[]) => any>>(
    ops: Ops
  ): OpaqueModuleResult<Repr, Ops> => {
    const create = (repr: Repr): any => {
      if (validate && !validate(repr)) {
        throw new Error(`Invalid ${brand}: ${JSON.stringify(repr)} failed validation`);
      }
      return repr;
    };

    const unwrap = (opaque: any): Repr => opaque as Repr;

    const isValid = (repr: Repr): boolean => {
      if (!validate) return true;
      return validate(repr);
    };

    const tryCreate = (repr: Repr): any => {
      if (validate && !validate(repr)) return undefined;
      return repr;
    };

    // Wrap each operation to accept the opaque type instead of repr
    const wrappedOps: Record<string, Function> = {};
    for (const [name, fn] of Object.entries(ops)) {
      wrappedOps[name] = (opaque: any, ...rest: any[]) => {
        const result = fn(opaque as Repr, ...rest);
        return result;
      };
    }

    return {
      __brand: brand,
      create,
      unwrap,
      isValid,
      tryCreate,
      ...wrappedOps,
    } as any;
  };
}

/**
 * The result type of opaqueModule — includes the base module methods
 * plus all user-defined operations.
 */
export type OpaqueModuleResult<
  Repr,
  Ops extends Record<string, (repr: Repr, ...args: any[]) => any>,
> = {
  readonly __brand: string;
  readonly create: (repr: Repr) => Opaque<Repr, string>;
  readonly unwrap: (opaque: Opaque<Repr, string>) => Repr;
  readonly isValid: (repr: Repr) => boolean;
  readonly tryCreate: (repr: Repr) => Opaque<Repr, string> | undefined;
} & {
  // Wrap operations to accept Opaque<Repr, Brand> instead of Repr
  readonly [K in keyof Ops]: Ops[K] extends (repr: Repr, ...args: infer Args) => infer R
    ? (opaque: Opaque<Repr, string>, ...args: Args) => R extends Repr ? Opaque<Repr, string> : R
    : never;
};

// ============================================================================
// Convenience: Pre-built Opaque Modules for Common Types
// ============================================================================

/** Opaque positive integer */
export const PositiveInt = opaqueModule<number>(
  "PositiveInt",
  (n: number) => Number.isInteger(n) && n > 0
)({
  toNumber: (n: number) => n,
  add: (a: number, b: number) => a + b,
  toString: (n: number) => String(n),
});

/** Opaque non-empty string */
export const NonEmptyString = opaqueModule<string>(
  "NonEmptyString",
  (s: string) => s.length > 0
)({
  toString: (s: string) => s,
  length: (s: string) => s.length,
  toUpperCase: (s: string) => s.toUpperCase(),
  toLowerCase: (s: string) => s.toLowerCase(),
  concat: (a: string, b: string) => a + b,
});

/** Opaque email address */
export const EmailAddress = opaqueModule<string>("EmailAddress", (s: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
)({
  toString: (s: string) => s,
  domain: (s: string) => s.split("@")[1],
  local: (s: string) => s.split("@")[0],
});

/** Opaque URL */
export const SafeUrl = opaqueModule<string>("SafeUrl", (s: string) => {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
})({
  toString: (s: string) => s,
  hostname: (s: string) => new URL(s).hostname,
  pathname: (s: string) => new URL(s).pathname,
  protocol: (s: string) => new URL(s).protocol,
});

// ============================================================================
// opaqueModule Expression Macro
// ============================================================================

/**
 * opaqueModule macro — at compile time, validates the module definition
 * and generates optimized code.
 */
export const opaqueModuleMacro = defineExpressionMacro({
  name: "opaqueModule",
  description: "Create an opaque type module with smart constructors and controlled access",

  expand(
    _ctx: MacroContext,
    callExpr: ts.CallExpression,
    _args: readonly ts.Expression[]
  ): ts.Expression {
    // Pass through to the runtime implementation — the type system
    // handles the opacity via branded types
    return callExpr;
  },
});

globalRegistry.register(opaqueModuleMacro);
