const { createPipeline } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js");
const dir = process.argv[2];
const p = createPipeline(dir + "/tsconfig.json", {});
for (const f of ["a.ts", "b.ts"]) { const r = p.transform(dir + "/src/" + f); console.log(f, r.code.split("\n").filter(l => l.includes("export const"))); }
