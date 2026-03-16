/**
 * Runtime error thrown when a match expression is non-exhaustive and no
 * arm matches the scrutinee value. Acts as a safety net for cases the
 * type system cannot fully verify at compile time.
 *
 * @example
 * ```typescript
 * try {
 *   match(value).case("a").then(1) // no .else() — throws at runtime if value !== "a"
 * } catch (e) {
 *   if (e instanceof MatchError) {
 *     console.log(e.value); // the unmatched value
 *   }
 * }
 * ```
 */
export class MatchError extends Error {
  readonly value: unknown;

  constructor(value: unknown) {
    const display =
      typeof value === "string"
        ? `"${value}"`
        : typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : String(value);
    super(`Non-exhaustive match: no pattern matched value ${display}`);
    this.name = "MatchError";
    this.value = value;
    Object.setPrototypeOf(this, MatchError.prototype);
  }
}
