//! Pattern Matching
//! Expressive match expressions for TypeScript

import { match, when, otherwise } from "@typesugar/std";

// Match on discriminated unions
type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; width: number; height: number }
  | { kind: "triangle"; base: number; height: number };

function area(shape: Shape): number {
  return match(shape, [
    when((s: Shape) => s.kind === "circle", (s: any) => Math.PI * s.radius ** 2),
    when((s: Shape) => s.kind === "rect", (s: any) => s.width * s.height),
    when((s: Shape) => s.kind === "triangle", (s: any) => 0.5 * s.base * s.height),
    otherwise(() => 0),
  ]);
}

const shapes: Shape[] = [
  { kind: "circle", radius: 5 },
  { kind: "rect", width: 4, height: 6 },
  { kind: "triangle", base: 3, height: 8 },
];

for (const s of shapes) {
  console.log(`${s.kind}: area = ${area(s).toFixed(2)}`);
}

// Match on literal values
function httpStatus(code: number): string {
  return match(code, {
    200: "OK",
    201: "Created",
    301: "Moved Permanently",
    400: "Bad Request",
    404: "Not Found",
    500: "Internal Server Error",
    _: `Unknown (${code})`,
  });
}

console.log("\nHTTP status codes:");
for (const code of [200, 201, 404, 418, 500]) {
  console.log(`  ${code}: ${httpStatus(code)}`);
}
