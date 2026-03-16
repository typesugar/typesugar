//! Symbolic Calculus
//! Differentiate, integrate, simplify, and evaluate expressions

import { var_, const_, add, mul, pow, div, sin, cos } from "@typesugar/symbolic";
import { diff, simplify, evaluate, toText, toLatex } from "@typesugar/symbolic";

const x = var_("x");
const t = var_("t");

// Kinematics: position → velocity → acceleration
const position = add(mul(const_(0.5), mul(t, t)), mul(const_(3), t));
const velocity = diff(position, "t");
const acceleration = diff(velocity, "t");

console.log("s(t) =", toText(simplify(position)));
console.log("v(t) =", toText(simplify(velocity)));
console.log("a(t) =", toText(simplify(acceleration)));
console.log("s(4) =", evaluate(position, { t: 4 }));
console.log("v(4) =", evaluate(velocity, { t: 4 }));

// Derivatives of trig functions
const f = sin(x);
const f_prime = diff(f, "x");
const f_double = diff(f_prime, "x");
console.log("\nf(x)   =", toText(f));
console.log("f'(x)  =", toText(simplify(f_prime)));
console.log("f''(x) =", toText(simplify(f_double)));

// Polynomial + LaTeX rendering
const poly = add(pow(x, const_(3)), add(mul(const_(-2), pow(x, const_(2))), x));
console.log("\nPolynomial:", toText(simplify(poly)));
console.log("LaTeX:", toLatex(simplify(poly)));
console.log("d/dx:", toText(simplify(diff(poly, "x"))));
