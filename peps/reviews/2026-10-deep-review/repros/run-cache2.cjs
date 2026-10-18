const path = require("path");
const repo = "/Users/deapovey/src/personal/typesugar";
const ts = require(repo + "/node_modules/typescript");
const T = require(repo + "/packages/transformer/dist/index.cjs");
const R = process.argv[2];
const files = process.argv.slice(3).map(f => path.join(R, f));
const program = ts.createProgram(files, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, baseUrl: repo, paths: { "typesugar": [repo + "/packages/typesugar/src/index.ts"] } });
const f = T.macroTransformerFactory(program, { cacheDir: path.join(R, "cache") });
for (const file of files) {
  const res = ts.transform(program.getSourceFile(file), [f]);
  console.log(path.basename(file), "diags:", (res.diagnostics||[]).map(d => ts.flattenDiagnosticMessageText(d.messageText, " ").slice(0,70)));
}
T.saveExpansionCache();
console.log(T.getExpansionCacheStats ? T.getExpansionCacheStats() : "");
