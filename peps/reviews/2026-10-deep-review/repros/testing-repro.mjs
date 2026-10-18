const T = "/Users/deapovey/src/personal/typesugar/packages";
await import(T + "/testing/dist/macro.js");
const m = await import(T + "/transformer/dist/index.js");
const run = (label, src) => { const r = m.transformCode(src, { fileName: "/tmp/x.test.ts" }); console.log("=== " + label + "\n" + r.code + "\nDIAGS: " + JSON.stringify(r.diagnostics.map(d => d.message.slice(0, 160)))); };
run("two arbitrary", `import { derive } from "typesugar";\nimport { Arbitrary } from "@typesugar/testing";\n@derive(Arbitrary)\ninterface A { x: number }\n@derive(Arbitrary)\ninterface B { y: string }\n`);
run("testCases+assert", `import { testCases, assert } from "@typesugar/testing";\n@testCases([{ a: 1 }, { a: 2 }])\nfunction t(a: number) {\n  assert(a === 1);\n}\n`);
run("assert side effects", `import { assert } from "@typesugar/testing";\nlet n = 0;\nassert(n++ === 5);\n`);
