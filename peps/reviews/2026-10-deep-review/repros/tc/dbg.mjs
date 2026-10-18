import { createRequire } from "module";
const require = createRequire("/Users/deapovey/src/personal/typesugar/packages/macros/package.json");
const ts = require("typescript");
const m = await import("/Users/deapovey/src/personal/typesugar/packages/macros/dist/index.js");
const files = { "/p/tc.ts": `export interface Show<A> { show(a: A): string }
export interface Point { x: number }`,
 "/p/inst.ts": `import type { Show, Point } from "./tc";
/** @impl Show<Point> */
export const showPoint: Show<Point> = { show: (p) => "P" };
export const other = 1;`,
 "/p/a.ts": `import type { Show, Point } from "./tc";
import { other } from "./inst";
declare const p: Point;
export const o = other;` };
const opts = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true };
const host = ts.createCompilerHost(opts);
const orig = host.getSourceFile.bind(host);
host.getSourceFile = (f, lv, ...r) => files[f] !== undefined ? ts.createSourceFile(f, files[f], lv, true) : orig(f, lv, ...r);
host.fileExists = (f) => files[f] !== undefined || ts.sys.fileExists(f);
host.readFile = (f) => files[f] ?? ts.sys.readFile(f);
const program = ts.createProgram(Object.keys(files), opts, host);
const checker = program.getTypeChecker();
const sf = program.getSourceFile("/p/a.ts");
const imp = sf.statements[1];
const sym = checker.getSymbolAtLocation(imp.moduleSpecifier);
console.log("module sym", !!sym, sym?.declarations?.map(d=>d.fileName));
const inst = program.getSourceFile("/p/inst.ts");
const msym = checker.getSymbolAtLocation(inst);
console.log("msym", !!msym);
const scanned = m.instanceScanner.scanModule(checker, msym, "/p/inst.ts", program);
console.log(scanned.map(s => [s.typeclassName, s.forTypeString, !!s.forType, s.exportName]));
const pDecl = sf.statements[2].declarationList.declarations[0];
const pType = checker.getTypeAtLocation(pDecl.name);
const ctx = { typeChecker: checker, program, sourceFile: sf };
console.log("resolve:", JSON.stringify(m.resolveInstance(ctx, "Show", pType), (k,v)=> k==="forType"?undefined:v));
console.log(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).slice(0,5));
console.log("after check sym:", !!checker.getSymbolAtLocation(imp.moduleSpecifier));
console.log("resolve2:", JSON.stringify(m.resolveInstance(ctx, "Show", pType), (k,v)=> k==="forType"?undefined:v));
