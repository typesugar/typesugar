// usage: node run.cjs file.ts
const path = require("path");
const fs = require("fs");
const R = "/Users/deapovey/src/personal/typesugar/packages";
require(R + "/macros/dist/index.cjs");
const { transformCode } = require(R + "/transformer/dist/pipeline.cjs");
const f = process.argv[2];
const code = fs.readFileSync(f, "utf8");
const r = transformCode(code, { fileName: path.resolve(f) });
console.log(r.code);
for (const d of r.diagnostics) console.log("DIAG", d.severity, d.message);
