import ts from "/Users/deapovey/src/personal/typesugar/node_modules/typescript/lib/typescript.js";
const { macroTransformerFactory } = await import("/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js");
const dir = process.argv[2];
const cfg = ts.getParsedCommandLineOfConfigFile(dir + "/tsconfig.json", {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic(){} });
const program = ts.createProgram(cfg.fileNames, cfg.options);
const f = macroTransformerFactory(program, {});
const r = program.emit(undefined, () => {}, undefined, false, { before: [f] });
console.log("emit diags:", r.diagnostics.length, r.diagnostics.map(d => d.messageText).slice(0,2));
