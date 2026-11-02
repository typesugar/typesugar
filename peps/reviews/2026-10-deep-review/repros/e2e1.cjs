const { transformCode } = require("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/pipeline.cjs");
const fileName = "/Users/deapovey/src/personal/typesugar/tests/__virtual_review_e2e.ts";
const cases = {
  optionShadow: `import { Some, type Option } from "@typesugar/fp";
export function f(map: Map<string, number>, o: Option<number>) {
  return o.map((n) => n + map.size);
}`,
  matchShadow: `import { match } from "@typesugar/std";
export function g(x: number, _x: string) {
  return match(x).case(1).then(_x).else("other");
}`,
  inlineOptOut: `import "@typesugar/std";
export const v = (42).clamp(0, 100); // @ts-no-typesugar
`,
};
for (const [name, code] of Object.entries(cases)) {
  try {
    const r = transformCode(code, { fileName, cacheDir: false });
    console.log("=====", name, "changed:", r.changed);
    console.log(r.code);
    if (r.diagnostics?.length) console.log("diags:", r.diagnostics.map(d => d.message).join(" | "));
  } catch (e) { console.log("=====", name, "THREW", e.message); }
}
