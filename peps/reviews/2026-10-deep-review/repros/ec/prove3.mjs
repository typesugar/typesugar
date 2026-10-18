const m = await import("/Users/deapovey/src/personal/typesugar/packages/contracts/dist/macros.js");
const i = await import("/Users/deapovey/src/personal/typesugar/packages/contracts/dist/index.js");
const cases = [
  ["x > y", [{variable:"y", predicate:"y > x"}], "contradicts fact"],
  ["x >= y", [{variable:"y", predicate:"y > x"}], "contradicts fact"],
  ["x > y", [{variable:"x", predicate:"x >= 0"},{variable:"y", predicate:"y >= 0"}], "not implied"],
  ["x - y > 0", [{variable:"x", predicate:"x > 0"},{variable:"y", predicate:"y > 0"}], "not implied"],
];
for (const [g, f, note] of cases) {
  console.log("tryProve", JSON.stringify(g), JSON.stringify(f.map(x=>x.predicate)), "=>", m.tryProve(g, f).proven, m.tryProve(g, f).reason ?? "", "|", note);
  console.log("  linear-only FM:", i.tryLinearProof(g, f).proven);
}
