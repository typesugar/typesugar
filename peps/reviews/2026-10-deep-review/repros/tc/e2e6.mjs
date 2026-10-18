const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
function t(label, code) {
  const r = transformCode(code, { fileName: "input.ts" });
  console.log("=== " + label + "\n" + r.code.trim().split("\n").slice(-6).join("\n"));
  for (const d of r.diagnostics ?? []) console.log("  diag:", d.severity, d.message.split("\n")[0]);
}
t("derive Eq non-discriminated union", `
interface A { x: number }
interface B { y: string }
/** @derive(Eq) */
export type U = A | B;
`);
t("derive Eq ok sum", `
interface A { kind: "a"; x: number }
interface B { kind: "b"; y: number }
/** @derive(Eq) */
export type U = A | B;
`);
