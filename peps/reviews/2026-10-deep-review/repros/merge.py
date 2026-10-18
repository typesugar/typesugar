import re
def sections(path, prefix):
    txt = open(path).read()
    parts = re.split(r'(?m)^(### .*)$', txt)
    out = {}
    for i in range(1, len(parts), 2):
        head = parts[i]; body = parts[i+1]
        m = re.match(r'### (TC\d+|X\d+|\d+)\. (.*)', head)
        key = prefix + m.group(1) if not m.group(1).startswith(("TC","X")) else m.group(1)
        # cut body at next "## " heading
        body = re.split(r'(?m)^## ', body)[0]
        out[key] = (m.group(2), body.rstrip() + "\n")
    return out
S = {}
S.update(sections("partial-core-TC.md", ""))
S.update(sections("partial-core-A.md", "A"))
S.update(sections("partial-core-B.md", "B"))
extra = {
 "TC1": "- Corroborated independently by core-A (its repro scripts are in review/coreA/cache-*.mjs). Further reproduced effects: `fieldNames<Props>()` in two files with different `Props` both return the first file's fields. `cfg(\"debug\", ...)` built once with `TYPESUGAR_CFG_DEBUG=1` keeps emitting the debug branch after a rebuild with `=0`. On a warm cache, `registerExtension(\"string\", shout); s.shout()` is no longer rewritten, because the registration side effect is skipped, so it is a TypeError at runtime. `TransformationPipeline` (packages/transformer/src/pipeline.ts:1040-1044, 1774-1777) never forwards `options.cacheDir`, so `cacheDir: false` still creates `.typesugar-cache` and the collisions still happen (repro'd). `CACHE_VERSION` is a hard-coded \"2\", so upgrading macro packages never invalidates entries. The cache has no eviction and its write is not atomic (cache.ts:116-179).\n",
 "TC3": "- Method side of the same root cause (core-B, high confidence from code): `findTypeRewrite`/`resolveTypeRewriteName` (core/src/type-rewrite-registry.ts:161-233, rewriting.ts:553-652) match the receiver type by bare symbol name. Any unrelated `class Option { contains(v) {...} }` in a program that uses @typesugar/fp gets `opt.contains(\"x\")` rewritten to fp's `contains(opt, \"x\")` with an injected import. Two @opaque types with the same name overwrite each other in `byName`. Fix both together by storing the declaring file/module in the entry and comparing it against the receiver's or callee's declaration.\n",
 "B3": "- Also reproduced end-to-end by the transformer-core reviewer: `export const b = pipe(2, f); // @ts-no-typesugar` is still expanded through `macroTransformerFactory`.\n",
}
order = {
 "critical": ["TC1","TC2","TC3","TC4"],
 "high": ["TC5","TC6","TC7","TC8","TC15","TC9","TC11","TC12","TC10","B1","B4","B2","B3","A2","A3","A4"],
 "medium": ["TC13","TC14","TC17","X1","DIRECTIVE","B5","B6","B7","B11","B8","B12","B13","B9","A5","A6","A7","A8","A9","A10","A11"],
 "low": ["B15","TC18","TC19","B14","B16","B17","B18","B19","B20","B21","A12","A13","A14","A15","A16"],
}
S["DIRECTIVE"] = ("Pending imports and hoisted specialisations are inserted ahead of a `\"use client\"`/`\"use strict\"` directive prologue", """
- Severity: medium
- Confidence: high (code reading; lead from core-B)
- Location: packages/transformer-core/src/transformer.ts:797-811
- Problem: `insertIndex` is the end of the leading run of `ImportDeclaration`s. When the file starts with a directive (an `ExpressionStatement` string literal), the loop breaks at index 0, and `ensureImport` imports and hoisted `const` specialisations are spliced in BEFORE the directive. A directive that is no longer first in the prologue is ignored, which breaks `"use client"` for React Server Components and silently drops `"use strict"`. core's `generateImportFix` (import-suggestions.ts:759-793) has the same problem.
- Failure scenario: a `"use client"` component file that triggers method sugar or opaque erasure (both call `ensureImport`) emits `import { map } from ...; "use client";`, and Next.js treats the component as a server component.
- Suggested fix: skip leading prologue directives (`ts.isPrologueDirective`) before scanning for imports.
- Fix size: S
""")
out = ["# Deep review findings: core (packages/core/src + packages/transformer-core/src)\n",
"Reviewed by 3 agents: transformer-core (lead); core config/registry/cache/safety (core-A); core hygiene/context/diagnostics (core-B). Repro scripts are in /private/tmp/claude-502/-Users-deapovey-src-personal-typesugar/2c1d0d53-b275-4ae9-af0d-cb3583fec3f8/scratchpad/review/ (run-*.cjs and repro-*/ for transformer-core; coreA/ for core-A; hyg*/ast1/opt1/ctx*/e2e1.cjs for core-B). They were run against the built packages/*/dist; the largest e2e run peaked at about 460 MB. No repo files were changed.\n",
"Duplicates were merged: the expansion cache (found by both the lead and core-A), bare `// @ts-no-typesugar` (lead and core-B), and the name-keyed type-rewrite registry (lead for constructors, core-B for methods).\n"]
n = 0
used = set()
for sev, keys in order.items():
    for k in keys:
        title, body = S[k]; used.add(k)
        n += 1
        out.append(f"\n### {n}. {title}\n" + body.lstrip("\n") + extra.get(k, ""))
missing = [k for k in S if k not in used and k not in ("TC16","A1","B10")]
print("unused:", missing)
# 1.0 gaps
def gaps(path):
    t = open(path).read(); m = re.search(r'(?ms)^## 1\.0 gaps.*?\n(.*?)(?=^## |\Z)', t); return m.group(1).strip()
out.append("\n## Cross-scope leads (code outside core/transformer-core)\n")
out.append("""- packages/macros/src/typeclass.ts:3127-3154: see finding 24 (duplicate `import { Eq }`).
- packages/macros/src/comptime.ts:560-600: the vm sandbox exposes host `Object`, so `Object.constructor("return process")()` returns the real `process`. The permission-checked fs/process wrappers can be bypassed, and comptime "permissions" are not a security boundary (core-B, repro'd).
- CLAUDE.md's "exhaustive" parse* exception list is missing about 20 real `ctx.parse*` call sites: contracts/src/macros/laws.ts:153,202; codec/src/macros.ts:282; effect/src/derive/hash.ts:97,136, equal.ts:85,122, schema.ts:228,265; sql/src/derive-typeclasses.ts:300,436; parser/src/macros.ts:96; testing/src/macro.ts:210,359,490,709,948,1224,1327 (core-B).
- packages/transformer/src/macro-loader.ts:37-38, 108-122: package.json lookup uses the transformer's own `createRequire`, not the project root, so third-party macro packages in the project's node_modules may go undiscovered under pnpm (core-A, medium confidence).
- packages/macros/src/specialize.ts:736-754 (`inlineFromNode`): the substitution behind finding 6.
""")
out.append("\n## 1.0 gaps\n")
for p in ["partial-core-TC.md","partial-core-A.md","partial-core-B.md"]:
    out.append(gaps(p) + "\n")
open("findings-core.md","w").write("\n".join(out))
print("total findings", n)
