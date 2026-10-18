const core = require("/Users/deapovey/src/personal/typesugar/packages/core/dist/index.cjs");
const ts = require("/Users/deapovey/src/personal/typesugar/node_modules/typescript");
const code = "const foo = { bar: 1 };\nfoo.bar;\n";
const host = ts.createCompilerHost({ noLib: true });
const orig = host.getSourceFile;
host.getSourceFile = (f, l) => f === "/v/a.ts" ? ts.createSourceFile(f, code, l, true) : undefined;
host.fileExists = (f) => f === "/v/a.ts";
const program = ts.createProgram(["/v/a.ts"], { noLib: true }, host);
const sf = program.getSourceFile("/v/a.ts");
const checker = program.getTypeChecker();
const ctx = new core.MacroContextImpl(program, checker, sf, ts.factory, {}, new core.HygieneContext());
const parsed = ctx.parseExpression("foo.bar");
const synth = ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("foo"), "bar");
for (const [name, n] of [["parseExpression node", parsed], ["factory node", synth]]) {
  for (const [api, fn] of [["getTypeOf", () => checker.typeToString(ctx.getTypeOf(n))], ["getSymbol", () => String(ctx.getSymbol(n)?.name)], ["assertTypeReliable", () => String(ctx.assertTypeReliable(n, "test"))], ["isComptime", () => String(ctx.isComptime(n))]]) {
    try { console.log(name, api, "->", fn()); } catch (e) { console.log(name, api, "THREW", e.message.slice(0, 120)); }
  }
}
console.log("diags:", ctx.getDiagnostics().map(d => d.message));
