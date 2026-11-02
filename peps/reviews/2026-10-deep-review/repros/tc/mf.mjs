import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
const { transformCode } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer-core/dist/index.js");
export function multi(files, entry, label) {
  const opts = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true };
  const host = ts.createCompilerHost(opts);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lv, ...r) => files[f] !== undefined ? ts.createSourceFile(f, files[f], lv, true) : orig(f, lv, ...r);
  host.fileExists = (f) => files[f] !== undefined || ts.sys.fileExists(f);
  host.readFile = (f) => files[f] ?? ts.sys.readFile(f);
  host.directoryExists = (d) => d === "/p" || ts.sys.directoryExists(d);
  const diags = () => 0;
  const program = ts.createProgram(Object.keys(files), opts, host);
  const pre = ts.getPreEmitDiagnostics(program).filter(d => d.code === 2307); if (pre.length) console.log("  HOST RESOLUTION FAIL");
  const r = transformCode(files[entry], { fileName: entry, program });
  console.log("=== " + label + "\n" + r.code.trim());
  for (const d of r.diagnostics ?? []) console.log("  diag:", d.severity, d.message.split("\n")[0]);
  return r;
}
