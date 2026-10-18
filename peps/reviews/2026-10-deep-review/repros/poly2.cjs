const m=require('/Users/deapovey/src/personal/typesugar/packages/math/dist/index.cjs');
const N={add:(a,b)=>a+b,sub:(a,b)=>a-b,mul:(a,b)=>a*b,div:(a,b)=>a/b,pow:(a,b)=>a**b,negate:a=>-a,abs:Math.abs,signum:Math.sign,fromNumber:n=>n,toNumber:a=>a,zero:()=>0,one:()=>1};
const F={div:(a,b)=>a/b,recip:a=>1/a,fromRational:(n,d)=>n/d};
// find a lead pair where (l/b)*b !== l
let found=null;
for (let l=0.1;l<3&&!found;l+=0.1) for (let b=0.1;b<3;b+=0.1) if ((l/b)*b!==l){found=[l,b];break;}
console.log('pair',found);
const [l,b]=found;
console.log('start');
const r=m.divPoly(m.polynomial([1,l]), m.polynomial([1,b]), N, F);
console.log('ok', JSON.stringify(r));
