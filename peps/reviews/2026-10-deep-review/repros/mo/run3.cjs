const path = require("path"); const fs = require("fs");
const R = "/Users/deapovey/src/personal/typesugar/packages";
const ts = require(R + "/transformer/node_modules/typescript");
require(R + "/macros/dist/index.cjs");
const P = require(R + "/transformer/dist/pipeline.cjs");
const files = process.argv.slice(2).map(f => path.resolve(f));
const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, noEmit: false });
const factory = P.macroTransformerFactory(program, { cacheDir: path.resolve("cachedir") });
const printer = ts.createPrinter();
for (const f of files) {
  const sf = program.getSourceFile(f);
  const res = ts.transform(sf, [factory]);
  console.log(path.relative(process.cwd(), f), "=>", printer.printFile(res.transformed[0]).split("\n").filter(l => l.includes("const ") || l.includes("void")).join(""));
}
P.saveExpansionCache();
