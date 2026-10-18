/**
 * Type-level fixture for tests/dimension-types.test.ts (MU-2, MU-20).
 *
 * Every `@ts-expect-error` line MUST be a compile error: if the dimension
 * parameter stops being checked structurally, TypeScript reports the directive
 * as unused (TS2578) and the test fails. Every unmarked line must compile.
 */
import {
  Unit,
  meters,
  seconds,
  kilograms,
  newtons,
  metersPerSecondSquared,
  type Mass,
  type Length,
  type Area,
  type Velocity,
  type Force,
  type Dimensionless,
} from "../../src/types.js";

// --- Must be compile errors ---------------------------------------------------

// @ts-expect-error Length is not Mass
export const a: Unit<Mass> = meters(5);

// @ts-expect-error cannot add Length and Time
export const b = meters(1).add(seconds(1));

// @ts-expect-error Length * Length is Area, not Length
export const c: Unit<Length> = meters(1).mul(meters(1));

// @ts-expect-error Length / Time is Velocity, not Length
export const d: Unit<Length> = meters(1).div(seconds(1));

// @ts-expect-error cannot subtract Mass from Length
export const e = meters(1).sub(kilograms(1));

// @ts-expect-error equals across dimensions
export const f = meters(1).equals(seconds(1));

// @ts-expect-error mass * acceleration is Force, not Mass
export const g: Unit<Mass> = kilograms(2).mul(metersPerSecondSquared(3));

// @ts-expect-error .to() target must have the same dimensions
export const h = meters(1).to(seconds);

// MU-20: exponent overflow must not saturate into a valid exponent.
const L5 = meters(1).mul(meters(1)).mul(meters(1)).mul(meters(1)).mul(meters(1));
const L6 = L5.mul(meters(1));
// @ts-expect-error L^6 overflowed; it must not be compatible with L^5
export const i = L6.add(L5);
const T5inv = seconds(1)
  .mul(seconds(1))
  .mul(seconds(1))
  .mul(seconds(1))
  .mul(seconds(1));
const Tneg6 = meters(1).div(T5inv).div(seconds(1));
const Tneg5 = meters(1).div(T5inv);
// @ts-expect-error L·T^-6 overflowed; it must not be compatible with L·T^-5
export const j = Tneg6.add(Tneg5);

// --- Must compile -------------------------------------------------------------

export const ok1: Unit<Length> = meters(1).add(meters(2));
export const ok2: Unit<Area> = meters(2).mul(meters(3));
export const ok3: Unit<Velocity> = meters(10).div(seconds(2));
export const ok4: Unit<Force> = kilograms(2).mul(metersPerSecondSquared(3));
export const ok5 = newtons(1).add(kilograms(2).mul(metersPerSecondSquared(3)));
export const ok6: Unit<Dimensionless> = meters(4).div(meters(2));
export const ok7: Unit<Length> = meters(10).div(seconds(2)).mul(seconds(2));
export const ok8 = L5.div(meters(1)).add(meters(1).mul(meters(1)).mul(meters(1)).mul(meters(1)));

// The runtime `units` fallback's dimension is statically unknown: it must stay
// assignable to a specific dimension (it was, before MU-2, by accident).
import { units } from "../../src/index.js";
export const ok9: Unit<Length> = units`5 m`;
