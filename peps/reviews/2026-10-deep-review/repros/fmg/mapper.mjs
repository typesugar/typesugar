import { createRequire } from "module";
const req = createRequire("/Users/deapovey/src/personal/typesugar/packages/mapper/package.json");
const ts = req("typescript");
const core = await import("/Users/deapovey/src/personal/typesugar/packages/core/dist/index.js");
const m = await import("/Users/deapovey/src/personal/typesugar/packages/mapper/dist/macros.js");
const options = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, strict: true, noLib: false };
const host = ts.createCompilerHost(options);
function run(macro, source) {
  const full = "export declare function transformInto<From, To>(source: From, config?: any): To;\nexport declare function transformArrayInto<From, To>(items: From[], config?: any): To[];\n" + source;
  const sf = ts.createSourceFile("test.ts", full, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const program = ts.createProgram(["test.ts"], options, { ...host, getSourceFile: (n) => n === "test.ts" ? sf : host.getSourceFile(n, ts.ScriptTarget.Latest) });
  const diags = [];
  const tctx = { factory: ts.factory, getCompilerOptions: () => options, startLexicalEnvironment(){}, suspendLexicalEnvironment(){}, resumeLexicalEnvironment(){}, endLexicalEnvironment: () => undefined, hoistFunctionDeclaration(){}, hoistVariableDeclaration(){}, requestEmitHelper(){}, readEmitHelpers: () => undefined, enableSubstitution(){}, enableEmitNotification(){}, isSubstitutionEnabled: () => false, isEmitNotificationEnabled: () => false, onSubstituteNode: (_h, n) => n, onEmitNode: (h, n, cb) => cb(h, n), addDiagnostic: (d) => diags.push(d) };
  const ctx = core.createMacroContext(program, sf, tctx);
  const origErr = ctx.reportError?.bind(ctx);
  ctx.reportError = (n, msg) => { diags.push(msg); };
  let call;
  ts.forEachChild(sf, function visit(node) { if (!call && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^transform/.test(node.expression.text)) call = node; else ts.forEachChild(node, visit); });
  const res = macro.expand(ctx, call, call.arguments);
  const out = ts.createPrinter().printNode(ts.EmitHint.Unspecified, res, sf);
  console.log("---\n" + out.replace(/\s+/g, " "), "\n  diags:", JSON.stringify(diags.map(d => typeof d === "string" ? d : ts.flattenDiagnosticMessageText(d.messageText, " "))));
}
const T = m.transformIntoMacro, A = m.transformArrayIntoMacro;
const cases = process.argv.slice(2);
// 1 type mismatch
run(T, `interface S { id: string } interface D { id: number } declare const s: S; const d = transformInto<S, D>(s);`);
// 2 config via variable: rename silently ignored
run(T, `interface S { name: string; fullName: string } interface D { name: string } declare const s: S; const cfg = { rename: { name: "fullName" } } as const; const d = transformInto<S, D>(s, cfg);`);
// 3 method-syntax compute ignored
run(T, `interface S { first: string; label: string } interface D { label: string } declare const s: S; const d = transformInto<S, D>(s, { compute: { label(x: S) { return x.first.toUpperCase(); } } });`);
// 4 await source
run(T, `interface S { a: number } interface D { a: number } declare function get(): Promise<S>; async function f() { return transformInto<S, D>(await get()); }`);
// 5 optional target field
run(T, `interface S { a: number } interface D { a: number; b?: string } declare const s: S; const d = transformInto<S, D>(s);`);
// 6 optional nested source
run(T, `interface SA { city: string } interface TA { location: string } interface S { address?: SA } interface D { address?: TA } declare const s: S; const d = transformInto<S, D>(s, { nested: { address: { rename: { location: "city" } } } });`);
// 7 renamePaths depth 3
run(T, `interface S { a: { b: { c: number; x: number } } } interface D { a: { b: { c: number } } } declare const s: S; const d = transformInto<S, D>(s, { renamePaths: { "a.b.c": "a.b.x" } });`);
// 8 renamePaths nested target field missing from source
run(T, `interface S { address: { city: string } ; zipcode: string } interface D { address: { location: string; zip: string } } declare const s: S; const d = transformInto<S, D>(s, { renamePaths: { "address.location": "address.city" } });`);
// 9 no type args, untyped context
run(T, `interface S { a: number } declare const s: S; const d = transformInto(s);`);
// 10 rename with 'as const' value
run(T, `interface S { name: string; fullName: string } interface D { name: string } declare const s: S; const d = transformInto<S, D>(s, { rename: { name: "fullName" as const } });`);
// 11 class target with method
run(T, `interface S { a: number } class D { a!: number; m() { return 1; } } declare const s: S; const d = transformInto<S, D>(s);`);
// 12 array: optional source elem field
run(A, `interface S { a?: number } interface D { a: number } declare const s: S[]; const d = transformArrayInto<S, D>(s);`);
