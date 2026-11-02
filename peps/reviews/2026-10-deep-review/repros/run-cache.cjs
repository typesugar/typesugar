const path = require("path");
const repo = "/Users/deapovey/src/personal/typesugar";
const ts = require(repo + "/node_modules/typescript");
const { macroTransformerFactory } = require(repo + "/packages/transformer/dist/index.cjs");
const R = process.argv[2];
const files = process.argv.slice(3).map(f => path.join(R, f));
const program = ts.createProgram(files, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, baseUrl: repo, paths: { "typesugar": [repo + "/packages/typesugar/src/index.ts"] } });
const f = macroTransformerFactory(program, { cacheDir: path.join(R, "cache") });
const printer = ts.createPrinter();
for (const file of files) {
  const sf = program.getSourceFile(file);
  const res = ts.transform(sf, [f]);
  const res2 = ts.transform(sf, [f]); for (const d of (res2.diagnostics||[])) console.log("diag", d.messageText.toString().slice(0,80)); console.log(file, "=>", printer.printFile(res.transformed[0]).replace(/\n/g," | "));
}
require(repo + "/packages/transformer/dist/index.cjs").saveExpansionCache();
