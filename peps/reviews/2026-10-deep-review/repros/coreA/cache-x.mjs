const T = await import('/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js');
const src = 'import { includeJson } from "typesugar";\nconst d = includeJson("./data.json");\n';
for (const d of ['a','b']) {
  const r = T.transformCode(src, { fileName: '/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/coreA/x/' + d + '/__f.ts' });
  console.log(d + '/__f.ts ->', JSON.stringify(r.code.replace(/\s+/g," ").match(/const d = [^;]*/)?.[0]));
  T.saveExpansionCache();
}
