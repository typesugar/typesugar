const core = require("/Users/deapovey/src/personal/typesugar/packages/core/dist/index.cjs");
const ts = require("/Users/deapovey/src/personal/typesugar/node_modules/typescript");
const errs = [];
const ctx = { factory: ts.factory, reportError: (n, m) => errs.push(m) };
const p = (v) => core.printNode(core.jsValueToExpression(ctx, v, ts.factory.createIdentifier("x")));
console.log("NaN ->", p(NaN));
console.log("Inf ->", p(Infinity), " -Inf ->", p(-Infinity), " -0 ->", p(-0));
console.log("Map ->", p(new Map([[1, 2]])), " Date ->", p(new Date(0)), " Set ->", p(new Set([1])));
console.log("proto ->", p(JSON.parse('{"__proto__": {"x": 1}}')));
console.log("errs", errs);
// isSyntheticNode on a synthetic node given a real range
const id = ts.setTextRange(ts.factory.createIdentifier("foo"), { pos: 3, end: 6 });
console.log("isSynthetic(setTextRange'd factory node) =", core.isSyntheticNode(id));
try { id.getText(); } catch (e) { console.log("getText threw:", e.message); }
