const T = await import('/Users/deapovey/src/personal/typesugar/packages/transformer/dist/index.js');
const a = 'import { cfg } from "typesugar";\nconst d = cfg("debug", "DEBUG-BUILD", "PROD-BUILD");\n';
const r = T.transformCode(a, { fileName: '/private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/coreA/__review_e.ts' });
console.log(JSON.stringify(r.code.replace(/\s+/g," ").match(/const d = [^;]*/)?.[0])); T.saveExpansionCache();
