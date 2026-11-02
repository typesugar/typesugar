# Findings: packages/math/src + packages/units/src (+ one transformer-core root cause)

Repro scripts: /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/poly.cjs, poly2.cjs, bridge.mjs, units-macro.mjs, units/t.ts (tsc type-soundness check). Every "confirmed" finding below was run against packages/math/dist or packages/units/dist (built 2026-10-18), or through transformer/dist/pipeline.js transformCode.

### 1. [transformer-core, root cause for sql + units] An imported expression macro used as a tagged template never expands: the symbol cache is keyed by symbol only, not by macro kind
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/transformer-core/src/import-resolution.ts:490-497 (`symbolMacroCache` get/set keyed by `symbolId` alone), together with packages/transformer-core/src/rewriting.ts (tryExpandTaggedTemplate: first `resolveMacroFromSymbol(node.tag, tagName, "tagged-template")`, then `resolveMacroFromSymbol(node.tag, tagName, "expression")`)
- Problem: the first lookup, with kind "tagged-template", finds nothing and caches `null` for the tag's symbol. The second lookup, with kind "expression", hits that cached `null` and returns undefined. So any expression macro used as a tag (`sql`, `sql$`, `units`) never expands when the user imports it, which is the normal usage. It does expand when the identifier has no symbol, because that path skips the cache.
- Failure scenario: `import { units } from "@typesugar/units"; units\`100 km/h\`` stays as `units\`100 km/h\``. Without the import it becomes `kilometersPerHour(100)`. `import { sql } from "@typesugar/sql"; sql\`SELECT ... ${id}\`` is likewise never expanded, so sql's compile-time validation never runs and the runtime tag is always used. This is why the sql reviewer could not get `sql` to expand. Note that fixing this exposes the latent bare-identifier bugs in sql (sql finding "Macro output references runtime identifiers it never imports") and units (next finding): they are masked today only because the macros never run.
- Suggested fix: key the cache by `${symbolId}:${kind}`. Add a test that imports an expression macro from a package and uses it as a tag.
- Fix size: S

### 2. [units] `Unit<D>` never uses `D` structurally, so there is no compile-time dimension checking at all
- Severity: high
- Confidence: confirmed (tsc 5.9.3 --strict on a 10-line file)
- Location: packages/units/src/types.ts:309-407 (class `Unit<D>` has no member of type `D`)
- Problem: `Unit` declares only `value: number` and `symbol: string`. `D` appears only in method signatures, which are bivariant, so all `Unit<…>` instantiations are mutually assignable. This is the package's headline claim (README line 7, docs/guides/units.md:48/55/109 "✗ Compile error"), and the root README showcases it.
- Failure scenario: `const a: Unit<Mass> = meters(5);`, `meters(1).add(seconds(1))`, and `const c: Unit<Length> = meters(1).mul(meters(1))` all compile with zero errors. A sanity line `const s: number = "x"` in the same file does error, so tsc was checking.
- Suggested fix: add a phantom member such as `declare readonly __dims: D;` (or `private readonly _dims?: D`) to `Unit`, then add `@ts-expect-error` type tests for the three cases above. Expect fallout: `AddMap` saturates at ±5 (see the low finding below), and `mul()`/`div()` results will become strictly checked.
- Fix size: S (plus test fallout)

### 3. [units] The `units` macro emits bare constructor identifiers, and the transformer strips the `units` import, so the expanded code throws ReferenceError
- Severity: high
- Confidence: confirmed (call form repro'd via transformCode; the tagged form is masked by finding 1)
- Location: packages/units/src/macros.ts:94-96, 133-135 (`factory.createIdentifier(fnName)`)
- Problem: the macro emits `kilometersPerHour(100)` as a free identifier. The user imported only `units` (README quick start), and the import cleanup removes that specifier because it resolved to a macro, so nothing binds `kilometersPerHour`. The bare name can also capture a user's local `meters` variable. `ctx.safeRef` / `ctx.ensureImport` (core/src/context.ts:984-989) exist for exactly this.
- Failure scenario: `import { units } from "@typesugar/units"; export const s = units("100 km/h");` transforms to `export const s = kilometersPerHour(100);` with the import line gone, which gives ReferenceError at load. In `function f(){ const meters = 42; return units\`5 m\`; }` the expansion would call the local `meters` once the tagged path works.
- Suggested fix: `ctx.safeRef(fnName, "@typesugar/units")`. Add an expansion test that runs the output; today only the runtime fallback is tested (tests/red-team-units.test.ts, packages/units/tests/units.test.ts).
- Fix size: S

### 4. [math] HALF_CEIL rounds negative values the wrong way, by up to 2 units, in all three rounding implementations
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/rounding.ts (roundBigInt `case "HALF_CEIL"`: `if (moreThanHalf || (isExactlyHalf && !negative)) quotient += 1n; else if (moreThanHalf && negative) …` makes the else branch dead); rounding.ts roundNumber `case "HALF_CEIL"` (`fracPart <= -0.5` returns `intPart`); packages/math/src/types/fixed-decimal.ts:401-405 (fixedDiv, same as roundBigInt)
- Problem: for a negative value with more than half a unit of remainder, the code adds +1 to the truncated quotient instead of -1. In roundNumber it returns the truncated value.
- Failure scenario: `roundBigInt(-27n, 0, 1, "HALF_CEIL")` gives `-1n` (expected -3). `fixedDiv(-27n, 10n, 0, "HALF_CEIL")` gives `-1n`. `roundNumber(-2.7, 0, "HALF_CEIL")` gives `-2`. Every Money/FixedDecimal operation that takes a mode (fixedMul, fixedRound, moneyScale, moneyFromMajor, moneyConvert, …) inherits this. No test covers HALF_CEIL.
- Suggested fix: in the bigint versions, `if (moreThanHalf) quotient += negative ? -1n : 1n; else if (isExactlyHalf && !negative) quotient += 1n;`. In roundNumber, `fracPart < -0.5` should return `intPart - 1`. Add a table test of all 8 modes against ±2.3/±2.5/±2.7.
- Fix size: S

### 5. [math] `rationalToFixed` returns a value 10^10 times too large
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/conversions.ts:71-82
- Problem: the function computes `scaled = num * 10^(scale+10) / den` and then calls `fixed(scaled, scale, mode)`. But `fixed()` with a bigint argument "assumes already scaled" and returns it unchanged, so the 10 guard digits are never rounded away.
- Failure scenario: `fixedToString(rationalToFixed(rational(1n,3n), 2), 2)` gives `"3333333333.33"` (expected `"0.33"`). The conversions module has no tests.
- Suggested fix: `return roundBigInt(scaled, scale, extraScale, mode) as FixedDecimal<N>`. Better, round exactly from num/den with a remainder instead of using guard digits.
- Fix size: S

### 6. [math] `divPoly` / `gcdPoly` loop forever for non-number coefficients (Rational, Complex, …) and return a wrong quotient for float coefficients
- Severity: high
- Confidence: confirmed (repro'd: the Rational case was still running after 4 s and was killed; the float case returned quotient `-1.265e-320` instead of `0.125`)
- Location: packages/math/src/types/polynomial.ts `isZeroCoeff` (only `number`/`bigint` count as zero; `isZeroCoeffWith` is defined but unused), `polynomial()` trimming, and the `divPoly` loop
- Problem: termination depends on `subPoly` producing an exact zero leading coefficient that `polynomial()` then trims. For object coefficients nothing is ever trimmed, so `degree(remainder)` never drops. For floats, the cancellation `leadR - (leadR/leadB)*leadB` is often not exact, so the loop keeps running on a residue and overwrites `quotCoeffs[degDiff]` with garbage until the residue underflows. A related effect is that `subPoly(p, p)` over Rational is not `isZeroPoly`.
- Failure scenario: `divPoly(polynomial([R(1n),R(2n),R(1n)]), polynomial([R(1n),R(1n)]), numericRational, fractionalRational)` hangs, although Fractional coefficients are the documented use case. `divPoly([1, 0.1], [1, 0.7999999999999999])` returns q ≈ 0 (expected 0.125).
- Suggested fix: in each step, drop the leading term explicitly (`remainder.coeffs.slice(0, -1)` after subtracting the lower terms) rather than relying on cancellation, and trim with an `N`-aware zero test (`isZeroCoeffWith`, or an Eq instance). Tests use only `number` coefficients that cancel exactly.
- Fix size: S-M

### 7. [math] `Mod<N>` multiplication and exponentiation silently lose precision for moduli above about 9.5e7 (e.g. 1e9+7)
- Severity: high
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/modular.ts:86-88 (`mod(a.value * b.value, …)` in float), modPow, and crt (line 374, `m1 * ((x * (r2 - r1)) % m2)`)
- Problem: `a.value * b.value` exceeds 2^53 once the modulus is above sqrt(2^53) ≈ 9.49e7, so the result is rounded before `%`. `modPow` also uses `e >>>= 1`, which truncates exponents ≥ 2^32.
- Failure scenario: with P = 1_000_000_007, `modMul(mod(999999999,P), mod(999999999,P)).value` gives 63 (exact: 64), and `modPow(mod(2,P), P-2).value` gives 550424600 (exact: 500000004), so Fermat inverses are wrong. 1e9+7 is the most common modulus in practice, and nothing documents or checks the limit.
- Suggested fix: multiply via BigInt when `modulus > 94906265` (or always), use `Math.floor(e/2)` in place of `>>>`, and validate `Number.isSafeInteger(modulus)` and integral values in `mod()`.
- Fix size: S

### 8. [math] `moneyDivide` with a bigint divisor rounds HALF_UP (and HALF_CEIL/HALF_FLOOR) wrongly for odd divisors
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/money.ts moneyDivide bigint branch (`case "HALF_UP": if (absRemainder >= halfDivisor)` and the `default:` branch)
- Problem: `halfDivisor = absDivisor / 2n` is floored, so for an odd divisor `absRemainder >= halfDivisor` is true below the half point. HALF_CEIL and HALF_FLOOR fall into `default`, which is HALF_UP again and ignores their semantics. This is a hand-rolled copy of `roundBigInt`; HALF_EVEN and HALF_DOWN happen to be right.
- Failure scenario: `moneyDivide(10n, 3n, USD, "HALF_UP")` gives `4n` (3.33 cents should round to 3). `"HALF_CEIL"` also gives `4n`.
- Suggested fix: compare `2n * absRemainder` with `absDivisor`, or delegate to the shared rounding helper once finding 4 is fixed.
- Fix size: S

### 9. [math] `fixed("…e-N", scale)` is off by a factor of 10^(2N)
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/fixed-decimal.ts:125-135
- Problem: for a negative exponent the mantissa is parsed at `scale + |exp|`, which multiplies by 10^|exp| when it should divide by it, and the result is returned as is.
- Failure scenario: `fixed("1e-2", 2)` gives 100.00 (expected 0.01). `fixed("1.5e-1", 2)` gives 15.00 (expected 0.15). Positive exponents are correct.
- Suggested fix: parse the mantissa to an exact (unscaled, inputScale) pair, set `inputScale -= exp`, and call `roundBigInt(unscaled, scale, inputScale, mode)`, applying a positive factor when inputScale < 0.
- Fix size: S

### 10. [math] Money string parsing is lossy and locale-wrong: "1.234,56" gives 1.23 and "1e3" gives 13.00
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/money.ts moneyFromString (`s.replace(/[^\d.\-]/g, "")` then `parseFloat`)
- Problem: the parser strips every character except digits, `.` and `-`, then goes through a float. Comma-decimal locales, exponents and accounting negatives are all misread without an error, and amounts above 2^53 minor units lose precision even though the input is a string.
- Failure scenario: `moneyFromMajor("1.234,56", EUR)` gives 1.23. `moneyFromMajor("1e3", USD)` gives 13.00. `moneyFromMajor("(12.34)", USD)` gives +12.34.
- Suggested fix: reuse the exact decimal string parser (as `fixed(string)` does once finding 9 is fixed), accept only `^[+-]?\d[\d,]*(\.\d+)?$` after stripping a currency symbol, and throw otherwise. Locale-aware parsing could be an explicit option.
- Fix size: S

### 11. [math] Conversions ignore their `mode` argument, or go through float, defeating the exact types
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/conversions.ts: bigDecimalToFixed (`mode === "HALF_EVEN" ? "round" : "round"`), rationalToMoney (truncating `/`, `mode` unused), rationalToBigDecimal (truncates), bigDecimalToMoney (`bigDecimalToNumber` then the float path)
- Problem: the public signatures take a `RoundingMode` that has no effect, and the BigDecimal-to-Money conversion rounds through a JS number.
- Failure scenario: `bigDecimalToFixed(bigDecimal("1.239"), 2, "FLOOR")` gives 1.24. `rationalToMoney(2/3, USD, "HALF_UP")` gives 66n (expected 67n). `bigDecimalToMoney(bigDecimal("1.005"), USD, "HALF_UP")` gives 100n (expected 101n), and `bigDecimal("12345678901234567.89")` becomes 1234567890123456823n.
- Suggested fix: route all of them through `roundBigInt(unscaled, targetScale, sourceScale, mode)` on exact bigint values. For Rational, round `num * 10^s / den` using the remainder.
- Fix size: S

### 12. [math] `moneyAllocate` throws on non-integer ratios and can hand remainder cents to a zero-ratio party
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/money.ts moneyAllocate (`BigInt(ratio)`, `BigInt(total)`; the remainder loop starts at index 0)
- Problem: `ratios: readonly number[]` accepts `[0.3, 0.7]`, but `BigInt(0.3)` throws. The remainder is spread from index 0 regardless of ratio, so a zero-weight recipient can receive money.
- Failure scenario: `moneyAllocate(100n, [0.3, 0.7], USD)` throws "The number 0.3 cannot be converted to a BigInt". `moneyAllocate(10n, [0,3,3,3], USD)` gives `[1n,3n,3n,3n]`.
- Suggested fix: scale ratios to integers (or validate `Number.isInteger` and throw a clear error), and distribute the remainder only to entries with a ratio > 0, ideally by largest fractional remainder.
- Fix size: S

### 13. [math] `numericMatrix(n)` uses `trace` as the scalar view, so `pow(a, one())` is a^n and `toNumber(fromNumber(5))` is 5n
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/matrix.ts:538-562
- Problem: `fromNumber(k)` is `k·I`, whose trace is `n·k`. `pow` reads its exponent as `round(trace(b))` and `toNumber` returns the trace. `abs` is the identity.
- Failure scenario: with `N = numericMatrix(3)`, `N.pow(diag([2,1,1]), N.one())[0]` gives 8 (expected 2). `N.toNumber(N.fromNumber(5))` gives 15.
- Suggested fix: use `b[0]` (or `trace(b)/n`) as the scalar, and use the same in toNumber. Consider not providing `pow`/`abs`/`signum` for matrices at all.
- Fix size: S

### 14. [math] Interval arithmetic does not round outward, so results can fail to contain the true value; `0 × ∞` turns into the empty interval
- Severity: medium
- Confidence: confirmed (by construction; for example `point(0.1)+point(0.2)` gives `{0.30000000000000004}`, which excludes the exact sum of the two float inputs, 0.30000000000000001665…)
- Location: packages/math/src/types/interval.ts add/sub/mul/div/sqrt/pow (round-to-nearest endpoints); mul (`Math.min(...products)` with `0*Infinity = NaN`)
- Problem: the module and docs/guides/math.md:245 sell it for "verified numerical computing" and say it "correctly propagate[s] bounds". Without directed rounding (nextDown on lo, nextUp on hi) the containment guarantee does not hold. Separately, `mul(entire, point(0))` gives NaN bounds, which means "empty", when the answer should be [0,0].
- Failure scenario: error-bound analysis built on this reports bounds that are too tight. `numericInterval.mul(entire, point(0))` returns the empty interval.
- Suggested fix: widen each computed endpoint by one ulp outward (a `nextDown`/`nextUp` helper via Float64Array/BigInt64Array bit tricks), and special-case `0 × ±∞ = 0`. Alternatively, drop the "verified" claim from the docs.
- Fix size: S-M

### 15. [math] `rationalToUnit` throws in the ESM build (`require` inside an ESM bundle)
- Severity: medium
- Confidence: confirmed (repro'd: ESM throws `Dynamic require of "@typesugar/units" is not supported`; CJS works)
- Location: packages/math/src/bridge/units.ts (`const { Unit } = require("@typesugar/units")`; also `require("../types/rational.js")` in unitToRationalPrecise, which tsup happens to inline)
- Problem: the package is `"type": "module"` and its `module` entry is ESM. tsup's `__require` shim throws for externals.
- Failure scenario: `import { rationalToUnit } from "@typesugar/math"` under Node ESM or any bundler throws when called.
- Suggested fix: use a static `import { Unit } from "@typesugar/units"`. Math already depends on units and re-exports it (src/index.ts:539-608), so there is no real cycle.
- Fix size: S

### 16. [math] `BigDecimal` division silently returns 0 for long divisors; `pow` breaks on negative-scale or non-integer exponents
- Severity: medium
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/bigdecimal.ts:314-337 (numericBigDecimal.div with a fixed 20 extra digits relative to the dividend's unscaled value; pow's `10n ** BigInt(b.scale)`)
- Problem: the quotient precision is fixed at "20 more decimal places than a.scale - b.scale", not 20 significant digits, so a divisor with more than 20 digits yields 0. `pow` with an exponent parsed from "1e1" (scale -1) throws "Exponent must be positive", and a non-integer exponent is silently truncated (2^2.7 gives 4).
- Failure scenario: `numericBigDecimal.div(bigDecimal("1"), bigDecimal("123456789012345678901234567890"))` gives 0. `numericBigDecimal.pow(bigDecimal("2"), bigDecimal("1e1"))` throws.
- Suggested fix: choose the extra scale from the digit counts (`20 + digits(b.unscaled) - digits(a.unscaled)`, min 20). In pow, normalize b first and reject non-integers.
- Fix size: S

### 17. [math] Matrix singularity tests use an absolute 1e-12 threshold, so well-conditioned small-scale matrices are rejected or given det 0
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/matrix.ts:379, 407, 415, 445, 495
- Problem: the threshold is not scale-invariant, and it is applied inconsistently: det uses exact formulas for n ≤ 3 but LU with the threshold for n ≥ 4.
- Failure scenario: `matrixInverse(diag([1e-7, 1e-7]))` throws "Matrix is singular". `det(diag([1e-4,1e-4,1e-4,1e-13]))` gives 0, while the 3×3 analogue gives 1e-21.
- Suggested fix: use a relative tolerance (pivot vs. max-abs element × n × ε), or throw only on an exact 0 pivot.
- Fix size: S

### 18. [math] Matrix element-wise ops never check dimensions at runtime, and `fromRows` always yields `Matrix<number, number>`, so the static check is bypassed
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/matrix.ts:99-113 (R and C are not inferable from `number[][]`), 254-303 (add/sub without a runtime check; matMul has one)
- Failure scenario: `matrixAdd(fromRows([[1,2,3],[4,5,6]]), fromRows([[1,2],[3,4],[5,6]]))` type-checks and returns a 2×3 matrix of element-wise sums of differently shaped data.
- Suggested fix: add the same `rows/cols` RangeError check that matMul has.
- Fix size: S

### 19. [math] Lenient numeric parsing: `bigDecimal("")` is 0, `"0x10"` is 16, `"--5"` is 5, and `"1e"` produces scale NaN; `rat(0.5)` is 0
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/math/src/types/bigdecimal.ts:53-88 (relies on `BigInt(str)`, which accepts "", hex/octal/binary, and a second sign after the stripped one); packages/math/src/types/rational.ts:77-89 (`Math.trunc` on number arguments)
- Problem: malformed input produces a value instead of an error. `rational(1.5, 2)` silently becomes 1/2, and `rationalPow(r, 2.5)` / `numericRational.pow` silently truncate the exponent.
- Suggested fix: validate with `/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i` before parsing. Throw on non-integer number arguments to `rational`/`rat` (point users to `rationalFromNumber`) and on non-integer exponents.
- Fix size: S

### 20. [units] Dimension exponent arithmetic silently saturates at ±5 instead of failing
- Severity: low
- Confidence: high (read: `AddMap["1"]["5"] = P5`, `AddMap["-5"]["-1"] = N5`)
- Location: packages/units/src/types.ts:69-213
- Problem: once finding 2 is fixed, L^5·L would be typed L^5, so it is wrongly compatible with L^5. Overflow should produce `never` or a compile error.
- Suggested fix: map out-of-range sums to `never`, or widen the range.
- Fix size: S

### 21. [units] Unit-alias lookups hit `Object.prototype` keys
- Severity: low
- Confidence: confirmed (repro'd)
- Location: packages/units/src/unit-aliases.ts (plain object literal), src/index.ts:166-172 (UNIT_CONSTRUCTORS[unitStr]), src/macros.ts:87, 125
- Problem: `UNIT_ALIASES["toString"]` resolves to an inherited function.
- Failure scenario: the runtime `units\`5 toString\`` returns the string "[object Undefined]", and `units\`5 hasOwnProperty\`` throws an unrelated TypeError. The macro on `units("5 toString")` emits the meaningless `(5)` with no diagnostic.
- Suggested fix: use `Object.hasOwn(UNIT_ALIASES, key)` or a `Map`/null-prototype object.
- Fix size: S

### 22. [math] `vectorSpaceArray(N).vZero()` returns `[]`, which is not an additive identity
- Severity: low
- Confidence: confirmed (repro'd: `vAdd(vZero(), [1,2])` gives `[]`)
- Location: packages/math/src/typeclasses/index.ts (`vZero: () => []`; vAdd iterates `a.length`)
- Problem: this violates the VectorSpace laws, and `normalize`/`project` return `[]` (a length change) for zero input.
- Suggested fix: make vAdd iterate `max(a.length, b.length)`, treating missing entries as `N.zero()`, or make the instance dimension-parameterised.
- Fix size: S

## 1.0 gaps (math, units, triage)

- PEP-048 status mismatch: the math, units and parser READMEs (and the root README "Frozen" section) say these packages are "excluded from release". PEP-058 Wave 1 superseded that: `.changeset/config.json` has `"ignore": []`, so all three are published at 0.1.1 next to the Keep packages. Update the banners to "published, not maintained".
- The package.json descriptions of every package start with 🧊, the same glyph the READMEs use for the "Frozen" banner, so Keep packages (sql, graph, fusion, mapper, type-system) look frozen in npm listings. Either use a different brand glyph or drop it from the descriptions.
- The root README's showcase ("Tagged Templates", around line 237) leads with `units\`100 km/h\`` "Dimensional analysis" from a Frozen package whose dimensional analysis does not type-check (finding 2) and whose macro never expands (finding 1).
- PEP-048 keep-conditions are still open: mapper #9 and type-system #10 (both OPEN on GitHub, re-triage 2026-12-10). type-system has 0 in-package tests (root red-team tests only). Neither package carries an experimental marker.
- sql is "Keep (Wedge)" on the strength of PEP-043, which is still Draft, and its core monad is a stub (sql finding 1). A credible 1.0 needs either the fix or an "experimental" label.
- math: the conversions module (`*ToFixed/*ToMoney/*ToRational`) has no tests, and findings 5 and 11 live there. No rounding-mode test covers HALF_CEIL/HALF_FLOOR.
- units: no type-level tests (no `@ts-expect-error` / expectTypeOf), and no macro-expansion test; the test suite exercises only the runtime fallback.
- units: stale doc comment on `Unit.to()` (types.ts:379-381) says celsius stores values as-is and absolute conversion does not work. The code now applies the offset (`celsius(100).to(fahrenheit)` gives 212), so absolute conversion works, but a temperature *difference* converted with `.to()` is now wrong.
