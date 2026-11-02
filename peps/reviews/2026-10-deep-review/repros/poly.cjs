const m=require('/Users/deapovey/src/personal/typesugar/packages/math/dist/index.cjs');
const R=m.rational, N=m.numericRational, F=m.fractionalRational;
const p=m.polynomial([R(1n),R(2n),R(1n)]);
const z=m.subPoly(p,p,N);
console.log('p-p isZero?', m.isZeroPoly(z), 'degree', m.degree(z));
const start=Date.now();
// (x^2+2x+1) / (x+1) with rational coefficients
const b=m.polynomial([R(1n),R(1n)]);
setTimeout(()=>{},0);
try { const [q,r]=m.divPoly(p,b,N,F); console.log('div ok', q, r); } catch(e){ console.log('div threw', e.message); }
