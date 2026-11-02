const P = "/Users/deapovey/src/personal/typesugar/packages/eslint-plugin";
const plugin = (await import(P + "/dist/index.js")).default;
for (const name of ["typesugar"]) {
  const proc = plugin.processors[name];
  const src = `type Lift<F, A> = { run: F<A>; again: F<A>; more: F<A> };\nvar x = 1;\nexport { x };\n`;
  const out = proc.preprocess(src, "/tmp/h.ts")[0];
  const tLines = out.split("\n"); const line = tLines.findIndex(l => l.startsWith("var x")) + 1;
  console.log("transformed 'var x' is at line", line);
  const res = proc.postprocess([[{ ruleId: "no-var", line, column: 1, endLine: line, endColumn: 11, message: "x", severity: 2 }]], "/tmp/h.ts");
  console.log("mapped back to:", res.map(m => `${m.line}:${m.column}-${m.endLine}:${m.endColumn}`), "(expected 2:1-2:11)");
}
