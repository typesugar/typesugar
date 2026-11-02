const path = require("path");
const repo = "/Users/deapovey/src/personal/typesugar";
const ts = require(repo + "/node_modules/typescript");
const core = require(repo + "/node_modules/@typesugar/core/dist/index.cjs");
const { macroTransformerFactory } = require(repo + "/packages/transformer/dist/index.cjs");
const R = process.argv[2];
let calls = 0;
core.globalRegistry.register(core.defineAttributeMacro({ name: "boom", module: undefined, validTargets: ["class"], expand(ctx, dec, target) { calls++; throw new Error("kaboom"); } }));
const files = [path.join(R, "main.ts")];
const program = ts.createProgram(files, { experimentalDecorators: true, target: ts.ScriptTarget.ES2022 });
const f = macroTransformerFactory(program, { cacheDir: false });
const sf = program.getSourceFile(files[0]);
const t0 = Date.now();
try { const res = ts.transform(sf, [f]); const out = ts.createPrinter().printFile(res.transformed[0]); console.log("out length", out.length, "lines", out.split("\n").length); console.log(out.slice(0, 600)); console.log("diags", res.diagnostics?.length);} catch (e) { console.log("THREW", String(e).slice(0,300)); }
console.log("expand calls", calls, "ms", Date.now()-t0);
