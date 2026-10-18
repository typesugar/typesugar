const path = require("path"); const fs = require("fs");
const R = "/Users/deapovey/src/personal/typesugar/packages";
const ts = require(R + "/transformer/node_modules/typescript");
require(R + "/macros/dist/index.cjs");
const P = require(R + "/transformer/dist/pipeline.cjs");
const files = process.argv.slice(2).map(f => path.resolve(f));
const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true });
const factory = P.macroTransformerFactory(program, { cacheDir: false });
const printer = ts.createPrinter();
for (const f of files) {
  const res = ts.transform(program.getSourceFile(f), [factory]);
  console.log("=== " + path.relative(process.cwd(), f) + "\n" + printer.printFile(res.transformed[0]));
}
