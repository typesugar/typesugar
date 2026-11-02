/**
 * Zero-Cost Abstractions for @typesugar/fp
 *
 * `ZeroCostOption<T>` is just `T | null` and `ZeroCostResult<T, E>` a plain
 * `{ ok: true, value } | { ok: false, error }` union, with small helper
 * objects (`ZeroCostOptionOps`, `ZeroCostResultOps`). With the typesugar
 * transformer, direct helper calls (`ZeroCostOptionOps.from(x)`,
 * `.isSome(x)`, `ZeroCostResultOps.ok(v)`, `.isOk(r)`, ...) are inlined to
 * the equivalent expression; without it they are ordinary function calls.
 * There is no method-chain API (`T | null` has no `.map`).
 *
 * This module is runtime-only; the inlining macros are registered by
 * `@typesugar/fp/macros`.
 *
 * @example
 * ```typescript
 * import { ZeroCostOptionOps as Opt, ZeroCostResultOps as Res } from "@typesugar/fp/zero-cost";
 *
 * const name = Opt.from(user.name);              // compiles to: user.name ?? null
 * const display = Opt.isSome(name) ? name.trim() : "Anonymous";
 *
 * const parsed = Res.try(() => JSON.parse(input));
 * const data = Res.isOk(parsed) ? parsed.value : undefined;
 * ```
 */

export * from "./option.js";
export * from "./result.js";
