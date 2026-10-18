import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
import { multi } from "./mf.mjs";
const r = multi({ "/p/o.ts": `/** @derive(Eq) */\nexport interface TO { name?: string; n: number }\nexport const r = TO.Eq.equals({ n: 1 }, { n: 1 });` }, "/p/o.ts", "opt");
const js = ts.transpileModule(r.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
try { const m = { exports: {} }; new Function("module","exports","require", js)(m, m.exports, (s) => require("/Users/deapovey/src/personal/typesugar/packages/macros/dist/index.cjs")); console.log("RUN OK", JSON.stringify(m.exports)); } catch (e) { console.log("RUN THROW:", e.message); }
