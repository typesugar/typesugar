const T = await import('/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js');
const srcA = 'import { fieldNames } from "typesugar";\ninterface Props { title: string; count: number }\nexport const f = fieldNames<Props>();\n';
const srcB = 'import { fieldNames } from "typesugar";\ninterface Props { userId: string }\nexport const f = fieldNames<Props>();\n';
for (const [d, s] of [['b', srcB]]) {
  const r = T.transformCode(s, { cacheDir: false, fileName: '/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/coreA/x/' + d + '/__g.ts' });
  console.log(d, JSON.stringify(r.code.replace(/\s+/g," ").match(/const f = [^;]*/)?.[0]));
  T.saveExpansionCache();
}
