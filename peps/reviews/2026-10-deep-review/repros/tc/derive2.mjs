import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
function t(label, code) {
  const r = transformCode(code, { fileName: "input.ts" });
  const lines = r.code.split("\n").filter(l => /_\w+Eq =|_\w+Show =|export const \w+ = |namespace|Eq =|Show =/.test(l));
  console.log("=== " + label + "\n" + lines.join("\n"));
  for (const d of r.diagnostics ?? []) console.log("  diag:", d.severity, d.message.split("\n")[0]);
  const js = ts.transpileModule(r.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  try { const m = { exports: {} }; new Function("module","exports","require", js)(m, m.exports, (s) => require(s === "@typesugar/macros" ? "/Users/deapovey/src/personal/typesugar/packages/macros/dist/index.cjs" : s)); console.log("  RUN OK:", JSON.stringify(m.exports)); }
  catch (e) { console.log("  RUN THROW:", e.message); }
}
t("array field", `
/** @derive(Eq) */
export interface T { tags: string[] }
export const r = T.Eq.equals({ tags: ["a"] }, { tags: ["a"] });
`);
t("optional field", `
/** @derive(Eq) */
export interface T { name?: string; n: number }
export const r = T.Eq.equals({ n: 1 }, { n: 1 });
`);
t("quoted field", `
/** @derive(Eq) */
export interface T { "content-type": string; n: number }
export const r = T.Eq.equals({ "content-type": "a", n: 1 }, { "content-type": "b", n: 1 });
`);
t("sum with non-derived variants", `
interface A { kind: "a"; x: number }
interface B { kind: "b"; y: number }
/** @derive(Eq) */
export type U = A | B;
export const r = U.Eq.equals({ kind: "a", x: 1 }, { kind: "a", x: 1 });
`);
t("nested user type field", `
/** @derive(Eq) */
export interface P { x: number }
/** @derive(Eq) */
export interface L { a: P; b: P }
export const r = L.Eq.equals({ a: {x:1}, b: {x:2} }, { a: {x:1}, b: {x:3} });
`);
