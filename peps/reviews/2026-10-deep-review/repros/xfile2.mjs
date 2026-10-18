const { createPipeline } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js");
const dir = process.argv[2];
const p = createPipeline(dir + "/tsconfig.json", { transformerConfig: { cacheDir: false } });
for (const f of ["b.ts"]) { const r = p.transform(dir + "/src/" + f); console.log(f, r.code.split("\n").filter(l => l.includes("export const"))); }
