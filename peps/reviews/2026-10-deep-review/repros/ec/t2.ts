import "@typesugar/contracts/syntax";
import type { Positive, Negative, Byte } from "@typesugar/type-system";

export function a(x: Positive): number {
  requires: { x > 0; }
  return x;
}
export function b(x: Negative): number {
  requires: { ~x > 0; }
  requires: { +x > 0; }
  return x;
}
export function c(x: Byte, y: Byte): number {
  requires: { x + y >= 0; }
  requires: { x % 7 >= 0; }
  requires: { x >= 0 && Number.isFinite(x); }
  requires: { x >> 9 >= 0; }
  return x;
}
