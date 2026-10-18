const m = await import('/Users/deapovey/src/personal/typesugar/packages/math/dist/index.js');
const u = m.meters(5);
for (const f of ['rationalToUnit','unitToRationalPrecise']) {
  try { console.log('ESM', f, f==='rationalToUnit'? m.rationalToUnit(m.rational(1n,2n),'m') : m.unitToRationalPrecise(u)); } catch(e){ console.log('ESM', f, 'throws:', e.message); }
}
const c = (await import('node:module')).createRequire(import.meta.url)('/Users/deapovey/src/personal/typesugar/packages/math/dist/index.cjs');
try { console.log('CJS precise', c.unitToRationalPrecise(c.meters(5))); } catch(e){ console.log('CJS unitToRationalPrecise throws:', e.message.split('\n')[0]); }
try { console.log('CJS rationalToUnit', c.rationalToUnit(c.rational(1n,2n),'m').value); } catch(e){ console.log('CJS rationalToUnit throws:', e.message.split('\n')[0]); }
const V=m.vectorSpaceArray({add:(a,b)=>a+b,mul:(a,b)=>a*b});
console.log('vAdd(vZero(), [1,2]) =', V.vAdd(V.vZero(), [1,2]));
