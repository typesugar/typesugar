const path = "/Users/deapovey/src/personal/typesugar/packages/";
require(path + "type-system/dist/macros.cjs");
require(path + "parser/dist/macros.cjs");
const { transformCode } = require(path + "transformer/dist/index.cjs");
const cases = {
  refineForeign: `import { refine } from "./somelib";\nexport const S = refine(a, "Name", (v: string) => v.length > 0);`,
  refineUndeclared: `export const S = refine(schema, check);`,
  packExists: `import { packExists } from "@typesugar/type-system";\nlet n = 0;\nexport const p = packExists({ v: n++ });`,
  maxForeign: `import type { Max } from "./somelib";\nexport type M = Max<[1,2,3]>;`,
  addHex: `import type { Add } from "@typesugar/type-system";\nexport type A = Add<0x10, 1_000>;`,
  grammar: `import { grammar } from "@typesugar/parser";\nexport const g = grammar\`a = "x" \${y}\`;`,
};
for (const [k, code] of Object.entries(cases)) {
  try {
    const r = transformCode(code, { fileName: path + "type-system/__probe_" + k + ".ts" });
    console.log("== " + k + "\n" + r.code.trim() + "\n diags: " + JSON.stringify((r.diagnostics||[]).map(d => d.message)));
  } catch (e) { console.log("== " + k + " THROW " + e.message.slice(0, 200)); }
}
console.log("rss MB", Math.round(process.memoryUsage().rss/1e6));
