import ts from "/Users/deapovey/src/personal/typesugar/node_modules/typescript/lib/typescript.js";
const mod = await import("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js");
const factory = mod.default;
const program = ts.createProgram([process.argv[2] + "/src/main.ts"], { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler });
try {
  const f = factory(program, {}, { ts, addDiagnostic() {}, removeDiagnostic() {}, diagnostics: [], library: "typescript" });
  const out = ts.transform(program.getSourceFile(process.argv[2] + "/src/main.ts"), [f]);
  console.log("ok", ts.createPrinter().printFile(out.transformed[0]).slice(0, 120));
} catch (e) { console.log("CRASH:", e.message); }
