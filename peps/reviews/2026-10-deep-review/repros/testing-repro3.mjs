const T = "/Users/deapovey/src/personal/typesugar/packages";
await import(T + "/testing/dist/macro.js");
const m = await import(T + "/transformer/dist/index.js");
const r = m.transformCode(`import { mock } from "@typesugar/testing";\ninterface Svc { get(id: string): number }\nexport const s = mock<Svc>();\n`, { fileName: "/tmp/x.test.ts" });
console.log(r.code.split("\n").slice(0, 8).join("\n"));
console.log("mentions createMockFn import?", /import[^;]*createMockFn/.test(r.code));
console.log("DIAGS", JSON.stringify(r.diagnostics.map(d => d.message.slice(0, 200))));
