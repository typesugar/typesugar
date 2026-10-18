const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
function t(label, code) {
  const r = transformCode(code, { fileName: "input.ts" });
  console.log("=== " + label + "\n" + r.code.trim());
  for (const d of r.diagnostics ?? []) console.log("  diag:", d.severity, d.message.split("\n")[0]);
}
t("derive Eq", `
/** @derive(Eq) */
export interface Point { x: number; y: string }
`);
t("derive Semigroup", `
/** @derive(Semigroup) */
export interface Point { x: number; y: string }
`);
t("derive Eq sum partial", `
interface A { kind: "a"; x: number }
interface B { kind: string; y: number }
/** @derive(Eq) */
export type U = A | B;
`);
