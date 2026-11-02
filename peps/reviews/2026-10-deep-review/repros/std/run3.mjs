import { TransformationPipeline } from "/Users/deapovey/src/personal/typesugar/packages/transformer/dist/pipeline.js";
import ts from "/Users/deapovey/src/personal/typesugar/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/typescript.js";
import fs from "node:fs";
const fileName = "/Users/deapovey/src/personal/typesugar/packages/strings/__review_input.ts";
const code = fs.readFileSync(process.argv[2], "utf8");
const p = new TransformationPipeline({ target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true }, [fileName], {
  readFile: (f) => f === fileName ? code : ts.sys.readFile(f),
  fileExists: (f) => f === fileName || ts.sys.fileExists(f),
});
const r = p.transform(fileName);
console.log(r.code);
for (const d of r.diagnostics ?? []) console.log("DIAG:", d.severity ?? d.category, d.message ?? d.messageText);
if (process.argv[3]) { const js = ts.transpileModule(r.code, { compilerOptions: { target: 99, module: 99 } }).outputText; fs.writeFileSync(process.argv[3], js); }
