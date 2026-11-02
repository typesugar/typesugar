const T = await import('/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js');
const a = `import { typeclass, instance } from "typesugar";
@typeclass
interface Showy<A> { showy(a: A): string; }
@instance
const S1: Showy<number> = { showy: (n) => "a" + n };
@instance
const S2: Showy<number> = { showy: (n) => "b" + n };
`;
const r = T.transformCode(a, { fileName: '/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/coreA/__review_f.ts', cacheDir: false });
console.log(r.code.slice(0,900)); console.log("diagnostics:", JSON.stringify(r.diagnostics.map(d=>[d.severity, d.code, d.message])));
