/**
 * Zero-Cost Abstractions for @typesugar/fp
 *
 * This module provides compile-time-optimized versions of Option, Result,
 * and pattern matching that compile away to simple null checks and
 * conditionals — no wrapper objects, no allocations.
 *
 * Choose this when:
 * - You want zero runtime overhead
 * - You don't need the full typeclass ecosystem
 * - You're working in a hot path or performance-critical code
 *
 * Choose the regular @typesugar/fp data types when:
 * - You want the full monadic API with typeclass instances
 * - You're composing with other @typesugar/fp abstractions
 * - You prefer explicit ADTs (Some/None, Left/Right)
 *
 * @example
 * ```typescript
 * import { Option, Result } from "@typesugar/fp/zero-cost";
 * import { match } from "@typesugar/std";
 *
 * // Zero-cost Option (compiles to null checks)
 * const name = Option.from(user.name)
 *   .map(n => n.trim())
 *   .unwrapOr("Anonymous");
 *
 * // Zero-cost Result (compiles to { ok, value/error } checks)
 * const parsed = Result.try(() => JSON.parse(input))
 *   .map(data => data.name)
 *   .unwrapOr("unknown");
 * ```
 */

export * from "./option.js";
export * from "./result.js";
