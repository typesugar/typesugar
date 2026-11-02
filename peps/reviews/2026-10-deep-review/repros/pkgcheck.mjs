import fs from "fs"; import path from "path";
const root = "/Users/deapovey/src/personal/typesugar/packages";
const pkgs = {};
for (const d of fs.readdirSync(root)) { const p = path.join(root, d, "package.json"); if (fs.existsSync(p)) pkgs[d] = JSON.parse(fs.readFileSync(p, "utf8")); }
const byName = Object.fromEntries(Object.entries(pkgs).map(([d, p]) => [p.name, { d, p }]));
function walk(exp, prefix, out) { if (typeof exp === "string") out.push([prefix, exp]); else if (exp && typeof exp === "object") for (const [k, v] of Object.entries(exp)) walk(v, prefix + "/" + k, out); }
for (const [d, p] of Object.entries(pkgs)) {
  const issues = [];
  const dir = path.join(root, d);
  const targets = []; walk(p.exports ?? {}, "", targets);
  for (const k of ["main", "module", "types", "typings"]) if (p[k]) targets.push([k, p[k]]);
  if (p.bin) for (const [b, f] of Object.entries(typeof p.bin === "string" ? { [p.name]: p.bin } : p.bin)) targets.push(["bin:" + b, f]);
  for (const [k, t] of targets) { if (t.includes("*")) continue; if (!fs.existsSync(path.join(dir, t))) issues.push(`missing ${k} -> ${t}`); }
  // files coverage
  if (p.files && !p.private) for (const [k, t] of targets) { const first = t.replace(/^\.\//, "").split("/")[0]; if (!p.files.some(f => f.replace(/^\.\//, "").split("/")[0] === first || f.replace(/^\.\//,"") === t.replace(/^\.\//,""))) issues.push(`not in files: ${k} -> ${t}`); }
  if (!p.files && !p.private) issues.push("no files field");
  // conditions order & require types
  const visit = (e, key) => { if (!e || typeof e !== "object") return; const ks = Object.keys(e);
    if (ks.includes("types") && ks.indexOf("types") !== 0 && (ks.includes("import")||ks.includes("require"))) issues.push(`types not first in ${key}`);
    if (ks.includes("require") && ks.includes("types") && typeof e.types === "string" && e.types.endsWith(".d.ts") && p.type === "module" && typeof e.require === "string" && e.require.endsWith(".cjs")) issues.push(`require uses ESM types (.d.ts) in ${key}`);
    if (ks.includes("import") && !ks.includes("require") && !ks.includes("default") && !ks.includes("node")) issues.push(`ESM-only (no require/default) in ${key}`);
    for (const k of ks) if (typeof e[k] === "object") visit(e[k], key + "." + k); };
  if (p.exports) for (const [k, v] of Object.entries(p.exports)) visit(v, k);
  const peerTs = p.peerDependencies?.typescript; const depTs = p.dependencies?.typescript;
  if (depTs) issues.push(`typescript in dependencies: ${depTs}`);
  if (!p.private) for (const sect of ["dependencies", "peerDependencies"]) for (const [n, v] of Object.entries(p[sect] ?? {})) { if (byName[n]?.p.private) issues.push(`${sect} on PRIVATE pkg ${n}`); if (String(v).startsWith("workspace:") && sect === "peerDependencies") issues.push(`peer workspace dep ${n}@${v}`); if (sect==="dependencies" && !byName[n] && String(v).startsWith("workspace:")) issues.push(`workspace dep on unknown ${n}`); }
  console.log(`${p.private ? "(private) " : ""}${p.name}@${p.version} type=${p.type} peerTS=${peerTs ?? "-"} sideEffects=${JSON.stringify(p.sideEffects)} files=${JSON.stringify(p.files)}`);
  for (const i of issues) console.log("   - " + i);
}
