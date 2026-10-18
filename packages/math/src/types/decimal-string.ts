/**
 * Exact, strict decimal-string parsing shared by FixedDecimal, BigDecimal and
 * Money (MU-9, MU-10, MU-19).
 *
 * Accepts `[+-]digits[.digits][e[+-]digits]` (also `.5` and `5.`), and nothing
 * else: no empty string, no hex/octal/binary prefixes (which `BigInt()` would
 * silently accept), no doubled signs, no dangling exponent. The result is
 * exact — the value is `unscaled · 10^-scale`, where `scale` may be negative
 * for positive exponents — so callers round once, with their own mode, using
 * `roundBigInt(unscaled, targetScale, scale, mode)`.
 */

const DECIMAL_RE = /^([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?$/;

/** An exact decimal value: `unscaled · 10^-scale`. */
export interface ParsedDecimal {
  readonly unscaled: bigint;
  readonly scale: number;
}

/**
 * Parse a decimal string exactly.
 *
 * @param input - The string to parse (surrounding whitespace is ignored)
 * @param what - Name used in the error message (e.g. "BigDecimal")
 * @throws RangeError for anything that is not a plain decimal literal
 */
export function parseDecimalString(input: string, what: string): ParsedDecimal {
  const s = input.trim();
  const m = DECIMAL_RE.exec(s);
  if (!m) {
    throw new RangeError(`${what}: invalid decimal string "${input}"`);
  }
  const [, sign, body, expText] = m;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot + 1);
  let unscaled = BigInt(intPart + fracPart || "0");
  if (sign === "-") unscaled = -unscaled;
  const exp = expText === undefined ? 0 : Number(expText);
  if (!Number.isSafeInteger(exp)) {
    throw new RangeError(`${what}: exponent out of range in "${input}"`);
  }
  return { unscaled, scale: fracPart.length - exp };
}
