const path = require("path");
const repo = "/Users/deapovey/src/personal/typesugar";
const ts = require(repo + "/node_modules/typescript");
const { macroTransformerFactory } = require(repo + "/packages/transformer/dist/index.cjs");
const R = process.argv[2];
const files = process.argv.slice(3).map(f => path.join(R, f));
const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, experimentalDecorators: true, baseUrl: repo, paths: { "typesugar": [repo + "/packages/typesugar/src/index.ts"], "@typesugar/fp": [repo + "/packages/fp/dist/index.d.ts"] } });
const f = macroTransformerFactory(program, { cacheDir: false });
for (const file of files) {
  const res = ts.transform(program.getSourceFile(file), [f]);
  try { console.log("=== " + path.basename(file) + "\n" + ts.createPrinter().printFile(res.transformed[0])); } catch (e) { console.log("=== " + path.basename(file) + " PRINT THREW " + e.message.slice(0,200)); }
  for (const d of res.diagnostics || []) console.log("  diag:", ts.flattenDiagnosticMessageText(d.messageText, "\n").slice(0,200));
}
