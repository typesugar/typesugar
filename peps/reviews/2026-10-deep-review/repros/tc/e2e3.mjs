import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
function t(label, code) {
  const r = transformCode(code, { fileName: "input.ts" });
  console.log("=== " + label + "\n" + r.code.trim());
  for (const d of r.diagnostics ?? []) console.log("  diag:", d.severity, d.message);
  const js = ts.transpileModule(r.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  try { const m = { exports: {} }; new Function("module","exports","require", js)(m, m.exports, () => ({})); console.log("  RUN OK:", JSON.stringify(m.exports)); }
  catch (e) { console.log("  RUN THROW:", e.message); }
}
t("extend exported", `
import { extend } from "@typesugar/typeclass";
/** @typeclass */
export interface Greet<A> { greet(a: A): string; }
/** @impl("Greet<number>") */
const greetNumber = { greet: (n: number) => \`hello \${n}\` };
const n: number = 3;
export const r = extend(n).greet();
`);
t("extend literal type", `
import { extend } from "@typesugar/typeclass";
/** @typeclass */
export interface Greet<A> { greet(a: A): string; }
const n = "hi" as const;
export const r = extend(n).greet();
`);
