const c = await import("/Users/deapovey/src/personal/typesugar/packages/contracts/dist/macros.js");
const cases = [
  ["0 < x", [{variable:"x", predicate:"x < 0 && Number.isFinite(x)"}], "x Negative: 0 < x is ALWAYS FALSE"],
  ["0 < x", [{variable:"x", predicate:"x > 0 && Number.isFinite(x)"}], "x Positive: 0 < x is always true"],
  ["300 < x", [{variable:"x", predicate:"x >= 0 && x <= 255"}], "x Byte: 300 < x ALWAYS FALSE"],
  ["x >= 0", [{variable:"x", predicate:"x * x > 0"}], "custom NonZeroSq: x >= 0 not implied"],
  ["x >= 0", [{variable:"x", predicate:"x > 0 || x === -1"}], "custom disjunction"],
  ["x > y", [{variable:"x", predicate:"x > 0"},{variable:"y", predicate:"y.length < 0"}], "substring"],
  ["x + y > 0", [{variable:"x", predicate:"x >= 0"},{variable:"y", predicate:"y >= 0"}], "x+y>0 from two >=0 (false at 0,0)"],
];
for (const [g, f, note] of cases) {
  const r = c.tryProve(g, f);
  console.log(JSON.stringify(g), "=>", r.proven, r.method ?? "", "|", note, "|", r.reason ?? "");
}
