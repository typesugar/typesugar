import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
import { multi } from "./mf.mjs";
const r = multi({ "/p/a.ts": `import { summon } from "@typesugar/typeclass";
interface Eq<A> { equals(a: A, b: A): boolean }
interface Point { x: number; y: number }
export const e = summon<Eq<Point>>();
export const r = e.equals({x:1,y:2},{x:1,y:2});` }, "/p/a.ts", "summon derive primitive fields");
const js = ts.transpileModule(r.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
try { const m = { exports: {} }; new Function("module","exports","require", js)(m, m.exports, (s) => ({})); console.log("RUN OK", JSON.stringify(m.exports)); } catch (e) { console.log("RUN THROW:", e.message); }
