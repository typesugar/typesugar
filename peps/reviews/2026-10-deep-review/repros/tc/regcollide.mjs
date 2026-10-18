import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
const files = {
 "/p/a.ts": `interface Eq<A> { equals(a: A, b: A): boolean }
function helperA(a: number, b: number) { return Math.abs(a - b) < 0.01; }
/** @impl Eq<number> */
const eqApprox: Eq<number> = { equals: (a, b) => helperA(a, b) };
export const r = eqApprox.equals(1, 1.001);`,
 "/p/b.ts": `interface Eq<A> { equals(a: A, b: A): boolean }
const eqApprox = { equals: (a: number, b: number) => a === b, label: "strict" };
export function f(x: number, y: number) { return eqApprox.equals(x, y); }`,
};
const opts = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true };
const host = ts.createCompilerHost(opts);
const orig = host.getSourceFile.bind(host);
host.getSourceFile = (f, lv, ...r) => files[f] !== undefined ? ts.createSourceFile(f, files[f], lv, true) : orig(f, lv, ...r);
host.fileExists = (f) => files[f] !== undefined || ts.sys.fileExists(f);
host.readFile = (f) => files[f] ?? ts.sys.readFile(f);
host.directoryExists = (d) => d === "/p" || ts.sys.directoryExists(d);
const program = ts.createProgram(Object.keys(files), opts, host);
for (const f of ["/p/a.ts", "/p/b.ts"]) { const r = transformCode(files[f], { fileName: f, program }); console.log("==", f, "\n" + r.code.split("\n").filter(l => /export/.test(l)).join("\n")); }
