import fs from "fs";
const { createPipeline } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js");
const dir = process.argv[2];
const p = createPipeline(dir + "/tsconfig.json", {});
const f = dir + "/src/hkt.ts";
const r = p.transform(f);
const orig = fs.readFileSync(f, "utf8");
for (const d of r.diagnostics) console.log(d.severity, d.start, JSON.stringify(orig.slice(d.start, d.start + 20)), "expected start", orig.indexOf("comptime("));
