import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
const r = transformCode(`
/** @derive(Semigroup) */
export interface Point { x: number; y: string }
export const c = Point.Semigroup.combine({x:1,y:"a"},{x:2,y:"b"});
`, { fileName: "input.ts" });
console.log(r.code);
const js = ts.transpileModule(r.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const before = Object.keys(require.cache).length;
try { const m = { exports: {} }; new Function("module","exports","require", js)(m, m.exports, (s) => require(s === "@typesugar/macros" ? "/Users/deapovey/src/personal/typesugar/packages/macros/dist/index.cjs" : s)); console.log("RUN OK", JSON.stringify(m.exports)); }
catch (e) { console.log("RUN THROW:", e.message); }
console.log("typescript loaded at runtime:", Object.keys(require.cache).some(k => k.includes("/typescript/lib/typescript.js")));
