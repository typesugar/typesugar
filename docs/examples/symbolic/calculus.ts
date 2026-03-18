//! Symbolic Calculus
//! Differentiate, integrate, and simplify with compile-time evaluation

import { var_, const_, add, mul, pow, sin, cos } from "@typesugar/symbolic";
import { diff, integrate, simplify, evaluate, toText, toLatex } from "@typesugar/symbolic";
import { comptime, staticAssert } from "typesugar";

const t = var_("t");
const x = var_("x");

// Kinematics: s(t) = ½t² + 3t → v(t) → a(t)
const position = add(mul(const_(0.5), pow(t, const_(2))), mul(const_(3), t));
const velocity = simplify(diff(position, "t"));
const acceleration = simplify(diff(velocity, "t"));

// 👀 Check JS Output: comptime() becomes an inlined number
const posAt4 = comptime(() => 0.5 * 16 + 12);
staticAssert(0.5 * 16 + 12 === 20);

console.log("s(t) =", toText(simplify(position)));
console.log("v(t) =", toText(velocity));
console.log("a(t) =", toText(acceleration));
console.log("s(4) =", evaluate(position, { t: 4 }));

// Integration: ∫ x² dx = x³/3
const f = pow(x, const_(2));
const F = simplify(integrate(f, "x"));
console.log("\n∫ x² dx =", toText(F));

// Trig derivatives: d/dx sin(x) = cos(x)
const trig = sin(x);
const dtrig = simplify(diff(trig, "x"));
console.log("\nd/dx sin(x) =", toText(dtrig));

// LaTeX rendering
const poly = add(pow(x, const_(3)), mul(const_(-2), pow(x, const_(2))));
console.log("\nLaTeX:", toLatex(simplify(poly)));
console.log("d/dx:", toLatex(simplify(diff(poly, "x"))));

// Try: change the position equation and watch velocity/acceleration adapt
