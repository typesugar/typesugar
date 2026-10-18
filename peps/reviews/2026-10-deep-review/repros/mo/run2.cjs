const path = require("path"); const fs = require("fs");
const R = "/Users/deapovey/src/personal/typesugar/packages";
require(R + "/macros/dist/index.cjs");
const { transformCode } = require(R + "/transformer/dist/pipeline.cjs");
for (const f of process.argv.slice(2)) {
  const r = transformCode(fs.readFileSync(f, "utf8"), { fileName: path.resolve(f) });
  console.log(f, "=>", r.code.split("\n").filter(l=>l.includes("const s")).join(""));
  for (const d of r.diagnostics) console.log("  DIAG", d.message.slice(0,200));
}
