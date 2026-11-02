const { transformCode } = await import(process.cwd() + "/../transformer/dist/index.js");
const code = process.argv[2];
const r = transformCode(code, { fileName: process.cwd() + "/../../tests/scratch-input.ts" });
console.log(r.code);
console.log(JSON.stringify((r.diagnostics||[]).map(d=>d.message||d.messageText)));
