import { createRequire } from "module";
const req = createRequire("/Users/deapovey/src/personal/typesugar/packages/fusion/package.json");
const ts = req("typescript");
const m = await import("/Users/deapovey/src/personal/typesugar/packages/fusion/dist/macros.js");
const lazyMod = await import("/Users/deapovey/src/personal/typesugar/packages/fusion/dist/index.js");
function expand(src){
  const sf = ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true);
  const call = sf.statements[0].expression;
  const out = m.fusedMacro.expand({factory: ts.factory, sourceFile: sf}, call, call.arguments);
  const p = ts.createPrinter();
  return p.printNode(ts.EmitHint.Unspecified, out, sf);
}
const cases = [
 ["fused(arr.map((x, i) => x * i).reduce((a, b) => a + b, 0))", "arr.map((x, i) => x * i).reduce((a, b) => a + b, 0)"],
 ["fused(arr.map(parseInt).toArray())", "arr.map(parseInt)"],
 ["fused(arr.find(x => x > 100))", "arr.find(x => x > 100)"],
 ["fused(arr.map(x=>x).toArray())", "null"],
 ["fused(lazy(arr).map(x => x * 2).toArray())", "lazy(arr).map(x => x * 2).toArray()"],
 ["fused(gen().map(x => { log.push(x); return x; }).take(2).toArray())", "null"],
 ["fused(arr.reduce((a, b, i) => a + b * i, 0))", "arr.reduce((a, b, i) => a + b * i, 0)"],
];
for (const [f, u] of cases) {
  const code = expand(f);
  console.log("SRC:", f, "\nOUT:", code.replace(/\s+/g," "));
  const log = [];
  const env = (body) => new Function("arr","lazy","gen","log", "return " + body)(["1","2","3"].map(Number), lazyMod.lazy, function*(){ let i=0; while(true){ log.push("pull"+i); yield i++; } }, log);
  let a, b;
  try { a = env(code); } catch (e) { a = "THROW " + e.message; }
  const fl = log.splice(0);
  try { b = u === "null" ? "(n/a)" : env(u); } catch (e) { b = "THROW " + e.message; }
  console.log("fused =", JSON.stringify(a), fl.length? "log="+JSON.stringify(fl):"", " unfused =", JSON.stringify(b), "\n");
}
