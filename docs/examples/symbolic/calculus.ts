//! Symbolic Calculus
//! Differentiate, integrate, and simplify with operator overloading

import { var_, const_, pow, sin } from "@typesugar/symbolic";
import { diff, integrate, simplify, evaluate, toText, toLatex } from "@typesugar/symbolic";

const t = var_("t");
const x = var_("x");

// 👀 Check JS Output — + and * on expressions rewrite to numericExpr.add/mul!
const position = const_(0.5) * pow(t, const_(2)) + const_(3) * t;
const velocity = simplify(diff(position, "t"));
const acceleration = simplify(diff(velocity, "t"));

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
const poly = pow(x, const_(3)) + const_(-2) * pow(x, const_(2));
console.log("\nLaTeX:", toLatex(simplify(poly)));
console.log("d/dx:", toLatex(simplify(diff(poly, "x"))));

// Try: change the position equation and watch velocity/acceleration adapt
