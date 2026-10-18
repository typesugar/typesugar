const m = await import("/Users/deapovey/src/personal/typesugar/packages/contracts/dist/macros.js");
const ops = [">", ">=", "<", "<="];
const consts = ["0", "5", "10"];
const vars = ["x", "y"];
const atoms = [];
for (const a of vars) for (const o of ops) for (const k of consts) atoms.push(`${a} ${o} ${k}`);
for (const a of vars) for (const o of ops) for (const b of vars) if (a!==b) atoms.push(`${a} ${o} ${b}`);
for (const o of ops) for (const k of consts) { atoms.push(`x + y ${o} ${k}`); atoms.push(`x - y ${o} ${k}`); }
const evalP = (p, x, y) => Function("x", "y", `return (${p});`)(x, y);
const grid = []; for (let x = -15; x <= 15; x += 0.5) for (let y = -15; y <= 15; y += 0.5) grid.push([x, y]);
const bad = new Map();
let n = 0;
const factAtoms = atoms.filter(a => !a.includes("+") && !a.includes("- y"));
for (const f1 of factAtoms) for (const f2 of factAtoms) for (const g of atoms) {
  const facts = [{ variable: f1[0], predicate: f1 }, { variable: f2[0], predicate: f2 }];
  const r = m.tryProve(g, facts); n++;
  if (!r.proven) continue;
  const cex = grid.find(([x, y]) => evalP(f1, x, y) && evalP(f2, x, y) && !evalP(g, x, y));
  if (cex) { const key = r.reason?.split(":")[0]; if (!bad.has(key)) bad.set(key, []); bad.get(key).push(`${f1} ; ${f2} |- ${g}  cex=${cex}`); }
}
console.log("cases", n);
for (const [k, v] of bad) { console.log("RULE", k, "count", v.length); console.log("   " + v.slice(0, 4).join("\n   ")); }
