import { transformCode } from "/Users/deapovey/src/personal/typesugar/packages/transformer/dist/pipeline.js";
import fs from "node:fs";
const code = fs.readFileSync(process.argv[2], "utf8");
const r = transformCode(code, { fileName: "/Users/deapovey/src/personal/typesugar/packages/std/__review_input.ts" });
console.log(r.code);
for (const d of r.diagnostics ?? []) console.log("DIAG:", d.severity ?? d.category, d.message ?? d.messageText);
