import { Unit, meters, seconds, kilograms, Mass, Length, Time } from "./types";
const a: Unit<Mass> = meters(5);            // should error
const b = meters(1).add(seconds(1));         // should error
const c: Unit<Length> = meters(1).mul(meters(1)); // should error (L^2)
const L5 = meters(1).mul(meters(1)).mul(meters(1)).mul(meters(1)).mul(meters(1));
const L6 = L5.mul(meters(1));
const d = L6.add(L5);                         // should error (L^6 vs L^5) -- saturation
export { a, b, c, d };
const sanity: number = "x"; export {sanity};
