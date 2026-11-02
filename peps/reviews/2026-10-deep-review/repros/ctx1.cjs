const core = require("/Users/deapovey/src/personal/typesugar/packages/core/dist/index.cjs");
const ts = require("/Users/deapovey/src/personal/typesugar/node_modules/typescript");
const sf = ts.createSourceFile("a.ts", "function f(_x: number) { return _x }", ts.ScriptTarget.Latest, true);
const h = new core.HygieneContext();
const ctx = new core.MacroContextImpl({}, {}, sf, ts.factory, {}, h);
const p = ts.createPrinter();
const show = (n) => p.printNode(ts.EmitHint.Unspecified, n, sf);
// parseExpression comma / trailing statement truncation
console.log("parseExpression('a, b') ->", show(ctx.parseExpression("a, b")));
console.log("parseExpression('x; sideEffect()') ->", show(ctx.parseExpression("x; sideEffect()")));
// parseStatements accepts broken code silently
try { const st = ctx.parseStatements("const x = ;\nif (y {"); console.log("parseStatements(broken) ->", JSON.stringify(st.map(show).join(" "))); } catch (e) { console.log("parseStatements threw", e.message); }
// generateUniqueName inside one scope
const names = h.withScope(() => [ctx.generateUniqueName("tmp").text, ctx.generateUniqueName("tmp").text]);
console.log("generateUniqueName x2 in one scope:", names);
// outside-scope counters collide between ctx and hygiene
console.log("ctx outside scope:", ctx.generateUniqueName("v").text, " hygiene outside scope:", h.mangleName("v"));
// tryShortName ignores nested params
console.log("tryShortName('_x') with nested param _x:", ctx.tryShortName("_x").text);
// evaluate NaN truthiness
const ev = (src) => { const s = ts.createSourceFile("e.ts", "(" + src + ")", ts.ScriptTarget.Latest, true); return ctx.evaluate(s.statements[0].expression); };
console.log("evaluate(!(0/0)) ->", JSON.stringify(ev("!(0/0)")), " JS:", !(0/0));
console.log("evaluate(0x10) ->", JSON.stringify(ev("0x10")), " 1_000 ->", JSON.stringify(ev("1_000")));
try { console.log("comptimeValueToExpression(-1):", show(ctx.comptimeValueToExpression({kind:"number", value:-1}))); } catch(e) { console.log("comptimeValueToExpression(-1) threw:", e.message); }
console.log("comptimeValueToExpression(NaN):", show(ctx.comptimeValueToExpression({kind:"number", value:NaN})));
