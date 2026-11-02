const path='/Users/deapovey/src/personal/typesugar/packages/';
const core=require(path+'core/dist/index.cjs');
const reg=core.globalRegistry; const orig=reg.register.bind(reg);
const seen=new Map(); const out=[];
reg.register=function(m){
  const keys=[m.kind+':'+(m.kind==='labeled-block'?String(m.label):m.name)];
  if(m.exportName&&m.exportName!==m.name) keys.push(m.kind+':'+m.exportName+' (via exportName of '+m.name+')');
  for(const k of keys){const kk=k.split(' ')[0]; const prev=seen.get(kk); if(prev&&prev.m!==m) out.push(`${kk}: ${prev.mod}|${prev.m.name} vs ${m.module}|${m.name}`); else if(!prev) seen.set(kk,{m,mod:m.module});}
  return orig(m);
};
// re-register core's own (already registered before hook) - capture existing
for (const m of reg.getAll()) { const k=m.kind+':'+(m.kind==='labeled-block'?String(m.label):m.name); if(!seen.has(k)) seen.set(k,{m,mod:m.module}); }
const fs=require('fs');
for(const p of fs.readdirSync(path)){ const f=path+p+'/dist/index.cjs'; if(!fs.existsSync(f)||p==='core') continue; try{require(f);}catch(e){out.push('LOADFAIL '+p+': '+String(e.message).split('\n')[0]);} }
try{require(path+"macros/dist/index.cjs");}catch(e){out.push("macros "+e.message)}
console.log(out.join('\n')||'no collisions'); console.log('total', reg.getAll().length);
