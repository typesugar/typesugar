import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/transformer/package.json");
const ts = require("typescript");
const t = await import("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js");
const dir = process.cwd() + "/proj";
const p = new t.TransformationPipeline({ target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true }, [dir + "/a.ts", dir + "/b.ts"], { transformerConfig: { cacheDir: process.cwd() + "/cachedir" } });
for (const f of ["a.ts", "b.ts"]) { const r = p.transform(dir + "/" + f); console.log("==", f, r.code.split("\n").filter(l => l.startsWith("export const s")).join("")); }
