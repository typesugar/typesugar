/**
 * Zero-Cost Abstractions for @ttfx/fp
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
 * Choose the regular @ttfx/fp data types when:
 * - You want the full monadic API with typeclass instances
 * - You're composing with other @ttfx/fp abstractions
 * - You prefer explicit ADTs (Some/None, Left/Right)
 *
 * @example
 * ```typescript
 * import { Option, Result, match, matchLiteral, matchGuard } from "@ttfx/fp/zero-cost";
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
 *
 * // Zero-cost pattern matching (compiles to if/else chains)
 * const area = match(shape, {
 *   circle: (s) => Math.PI * s.radius ** 2,
 *   rect: (s) => s.width * s.height,
 * });
 * ```
 */

export * from "./option.js";
export * from "./result.js";
export * from "./match.js";
