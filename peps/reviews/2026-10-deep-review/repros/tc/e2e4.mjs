import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
function t(label, code) {
  const r = transformCode(code, { fileName: "input.ts" });
  console.log("=== " + label + "\n" + r.code.trim());
  for (const d of r.diagnostics ?? []) console.log("  diag:", d.severity, d.message.split("\n")[0]);
  const js = ts.transpileModule(r.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  try { const m = { exports: {} }; new Function("module","exports","require", js)(m, m.exports, () => ({})); console.log("  RUN OK:", JSON.stringify(m.exports)); }
  catch (e) { console.log("  RUN THROW:", e.message); }
}
t("plain store object", `
interface Store<S> { state: S; get(): S }
const store: Store<number> = { state: 1, get() { return this.state; } };
export const v = store.get();
`);
t("plain config object propname", `
interface Rect { w: number; h: number }
interface Geometry<T> { area(w: T): number }
const geo: Geometry<Rect> = { area: (w) => w.w * w.h };
export const a = geo.area({ w: 2, h: 3 });
`);
