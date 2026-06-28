/**
 * @typesugar/contracts — runtime API (Case-1, PEP-050).
 *
 * These are the runtime functions that application code calls directly. They do
 * NOT import `typescript`. With the transformer enabled, calls to `requires` /
 * `ensures` / `old` are rewritten at compile time; without it they fall back to
 * the plain runtime behaviour defined here.
 *
 * The macro *definitions* (which import `typescript`) live in the `./macros`
 * entry, loaded by the transformer at build time.
 */

import { PreconditionError, PostconditionError } from "./errors.js";
import {
  registerDecidability,
  type Decidability,
  type ProofStrategy,
} from "../prover/type-facts.js";
import type { LawSet, LawsDecoratorOptions } from "../laws/types.js";

/**
 * Runtime requires function — used without the transformer.
 * With the transformer, calls to this are replaced at compile time.
 */
export function requires(condition: boolean, message?: string): void {
  if (!condition) {
    throw new PreconditionError(message ?? "Precondition failed");
  }
}

/**
 * Runtime ensures function — used without the transformer.
 */
export function ensures(condition: boolean, message?: string): void {
  if (!condition) {
    throw new PostconditionError(message ?? "Postcondition failed");
  }
}

/**
 * Runtime old function — identity at runtime (only meaningful with transformer).
 * Without the transformer, old(x) just returns x (which is wrong for mutation,
 * but at least doesn't crash).
 */
export function old<T>(value: T): T {
  return value;
}

/**
 * Programmatic version of @decidable for use without decorators.
 *
 * @example
 * ```typescript
 * import { decidable } from "@typesugar/contracts";
 *
 * // Register decidability for a custom type
 * decidable("MyCustomType", "compile-time", "constant");
 * ```
 */
export function decidable(
  brand: string,
  decidability: Decidability,
  preferredStrategy: ProofStrategy = "algebra"
): void {
  registerDecidability({
    brand,
    decidability,
    preferredStrategy,
  });
}

/**
 * Runtime stub for @laws decorator.
 * At runtime this is a no-op; all verification happens at compile time.
 */
export function laws<T extends object>(
  lawGenerator: (instance: T) => LawSet,
  options?: LawsDecoratorOptions
): (target: T) => T {
  return (target) => target;
}
