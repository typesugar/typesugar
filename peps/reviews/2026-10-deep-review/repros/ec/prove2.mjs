const m = await import("/Users/deapovey/src/personal/typesugar/packages/contracts/dist/macros.js"); const i = await import("/Users/deapovey/src/personal/typesugar/packages/contracts/dist/index.js"); const c = {...i, ...m};
const cases = [
  ["0.5 < x", [{variable:"x", predicate:"x < 0 && Number.isFinite(x)"}], "x Negative: ALWAYS FALSE"],
  ["-1 < x", [{variable:"x", predicate:"x < 0 && Number.isFinite(x)"}], "x Negative: -1<x not implied (x=-5)"],
  ["300.5 < x", [{variable:"x", predicate:"x >= 0 && x <= 255"}], "x Byte: ALWAYS FALSE"],
  ["-1 > x", [{variable:"x", predicate:"x >= 0 && x <= 255"}], "x Byte: ALWAYS FALSE"],
  ["0 > 1", [{variable:"x", predicate:"x >= 0"}], "constant false"],
  ["x > 0", [{variable:"x", predicate:"x >= 0"}], "x NonNeg: x>0 not implied"],
  ["x >= 0", [{variable:"s", predicate:"s.length > 0"}], "unrelated var"],
];
for (const [g, f, note] of cases) {
  for (const fn of ["tryProve", "tryLinearArithmetic", "tryAlgebraicProof"]) {
    const r = c[fn](g, f);
    console.log(fn.padEnd(20), JSON.stringify(g), "=>", r.proven, r.method ?? "", "|", note, "|", r.reason ?? "");
  }
}
