const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
for (const [label, iface] of [["array","interface T1 { tags: string[] }"],["optional","interface T2 { name?: string; n: number }"],["quoted",'interface T3 { "content-type": string; n: number }'],["nested","interface P4 { x: number }\ninterface T4 { a: P4 }"]]) {
  const name = iface.match(/interface (T\d)/)[1];
  const r = transformCode(`import { summon } from "@typesugar/typeclass";\ninterface Eq<A> { equals(a: A, b: A): boolean }\n${iface}\nexport const e = summon<Eq<${name}>>();`, { fileName: "input.ts" });
  console.log("=== " + label, r.code.split("\n").filter(l=>l.startsWith("export const e")).join(""));
  for (const d of r.diagnostics ?? []) console.log("  diag:", d.message.replace(/\n/g," | ").slice(0,400));
}
