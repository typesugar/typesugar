const m = await import("/Users/deapovey/src/personal/typesugar/packages/contracts/dist/macros.js");
const ops = [">", ">=", "<", "<="];
const facts1 = ["x > 0 && Number.isFinite(x)", "x >= 0 && Number.isFinite(x)", "x < 0 && Number.isFinite(x)", "x >= 0 && x <= 255", "x >= 1 && x <= 65535", "x >= 0 && x <= 100"];
const goals = []; for (const o of ops) for (const k of ["0.5", "1.5", "-0.5", "300.5", "100.5", "-1", "0", "1"]) { goals.push(`${k} ${o} x`); goals.push(`x ${o} ${k}`); }
let bad = 0;
for (const f of facts1) for (const g of goals) {
  const r = m.tryProve(g, [{ variable: "x", predicate: f }]);
  if (!r.proven) continue;
  let cex;
  for (let x = -400; x <= 70000; x += 0.25) { if (Function("x", `return (${f})`)(x) && !Function("x", `return (${g})`)(x)) { cex = x; break; } }
  if (cex !== undefined) { bad++; console.log(`UNSOUND  ${f}  |-  ${g}   cex x=${cex}   (${r.reason})`); }
}
console.log("unsound:", bad);
