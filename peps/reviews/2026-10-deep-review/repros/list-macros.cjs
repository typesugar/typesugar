const repo = "/Users/deapovey/src/personal/typesugar";
const core = require(repo + "/node_modules/@typesugar/core/dist/index.cjs");
try { require(repo + "/node_modules/@typesugar/macros/dist/index.cjs"); } catch (e) { console.log("macros load err", e.message); }
for (const p of ["std","contracts","fp","units","sql","effect","mapper","validate","type-system","erased","fusion"]) { try { require(repo + "/node_modules/@typesugar/" + p); } catch (e) { console.log(p, "err", e.message.slice(0,100)); } }
const all = core.globalRegistry.getAll();
console.log("total", all.length);
console.log("no module:", all.filter(m => !m.module).map(m => m.kind + ":" + m.name).join(", "));
const by = {}; for (const m of all) { (by[m.name] ??= []).push(m.kind + "@" + m.module + (m.exportName? "/"+m.exportName:"")); }
console.log(Object.entries(by).filter(([k,v]) => new Set(v.map(x=>x.split("@")[0])).size > 1));
console.log(all.map(m=>m.kind+":"+m.name).join(" "));
