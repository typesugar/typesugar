const T = "/Users/deapovey/src/personal/typesugar/packages";
await import(T + "/testing/dist/macro.js");
const m = await import(T + "/transformer/dist/index.js");
const r = m.transformCode(`import { assertType } from "@typesugar/testing";\ntype Ev = { kind: "click" };\ndeclare const v: unknown;\nassertType<Ev & { tag: "x" }>(v);\nassertType<number>(5);\n`, { fileName: "/tmp/x.test.ts" });
console.log(r.code.split("\n").filter(l => /assertion failed for/.test(l)).join("\n"));
console.log("DIAGS", JSON.stringify(r.diagnostics.map(d => d.message.slice(0, 200))));
const ts = (await import("typescript")).default;
const out = ts.transpileModule(r.code, { reportDiagnostics: true, compilerOptions: {} });
console.log("transpile diags:", out.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")));
