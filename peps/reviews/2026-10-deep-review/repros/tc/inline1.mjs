import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
const m = await import("/Users/deapovey/src/personal/typesugar/packages/macros/dist/index.js");
const ctx = { factory: ts.factory, transformContext: ts.nullTransformationContext };
const printer = ts.createPrinter();
function lit(src) {
  const sf = ts.createSourceFile("x.ts", "const inst = " + src, ts.ScriptTarget.Latest, true);
  return sf.statements[0].declarationList.declarations[0].initializer;
}
function args(src) {
  const sf = ts.createSourceFile("y.ts", "f(" + src + ")", ts.ScriptTarget.Latest, true);
  return Array.from(sf.statements[0].expression.arguments);
}
function run(label, instSrc, method, argSrc) {
  const methods = m.extractMethodsFromObjectLiteral(lit(instSrc));
  try {
    const out = m.inlineMethod(ctx, methods.get(method), args(argSrc));
    const sf = ts.createSourceFile("o.ts", "", ts.ScriptTarget.Latest);
    console.log(label, "=>", out ? printer.printNode(ts.EmitHint.Expression, out, sf) : out);
  } catch (e) { console.log(label, "THROW", String(e.message).split("\n")[0]); }
}
run("propname", "{ equals: (x, y) => x.x === y.x && x.y === y.y }", "equals", "p1, p2");
run("propname-nonid", "{ equals: (x, y) => x.x === y.x }", "equals", "a.b, c");
run("dup-effect", "{ equals: (a, b) => a.x === b.x && a.y === b.y }", "equals", "next(), other()");
run("order", "{ combine: (a, b) => b + a }", "combine", "f(), g()");
run("drop", "{ empty: (a) => 0 }", "empty", "sideEffect()");
run("prec", "{ mul: (a, b) => a * b }", "mul", "x + 1, y + 2");
run("shadow-inner", "{ map: (fa, f) => fa.map((x) => f(x)) }", "map", "xs, x => x + 1");
run("shadow-inner2", "{ map: (fa, f) => fa.map((fa) => f(fa)) }", "map", "xs, g");
run("objlit", "{ mk: (x) => ({ x }) }", "mk", "foo");
run("objlit2", "{ mk: (x) => ({ x: x }) }", "mk", "foo");
run("local-capture", "{ f(a, b) { const t = a + 1; return t * b; } }", "f", "q, t");
run("guard-order", "{ f(a) { if (a == null) return 0; const n = a.length; return n; } }", "f", "s");
run("branch-effect", "{ f(a) { if (a) { log(a); return 1; } return 2; } }", "f", "s");
run("this", "{ show(a) { return this.prefix + a; } }", "show", "s");
run("missing-arg", "{ f: (a, b) => a + b }", "f", "s");
