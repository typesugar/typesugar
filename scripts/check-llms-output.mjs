#!/usr/bin/env node
/**
 * Validate the llms.txt / llms-full.txt produced by the docs build
 * (PEP-058 Wave 5). Run after `pnpm docs:build`.
 *
 * Guards the properties an agent consuming these files depends on:
 *  - both files exist and are non-trivial
 *  - llms.txt has no relative links (an agent fetching it has no base URL)
 *  - the error catalog is present (it's the highest-value section for agents)
 *  - internal/superseded design docs are absent (they describe a pre-PEP-047/
 *    052/053 model the compiler no longer implements — feeding them to an
 *    agent produces wrong code)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(repoRoot, "docs", ".vitepress", "dist");

const problems = [];

function read(name) {
  const p = path.join(dist, name);
  if (!fs.existsSync(p)) {
    problems.push(`missing: docs/.vitepress/dist/${name} (did \`pnpm docs:build\` run?)`);
    return null;
  }
  return fs.readFileSync(p, "utf-8");
}

const index = read("llms.txt");
const full = read("llms-full.txt");

if (index) {
  if (index.length < 500) problems.push("llms.txt is suspiciously small");
  // Markdown links must be absolute — `](/foo)` is relative.
  const relative = [...index.matchAll(/\]\((\/[^)]*)\)/g)].map((m) => m[1]);
  if (relative.length > 0) {
    problems.push(`llms.txt has ${relative.length} relative link(s), e.g. ${relative[0]}`);
  }
  if (!/typesugar\.org\/errors\/TS9001/.test(index)) {
    problems.push("llms.txt is missing the error catalog (expected an /errors/TS9001 entry)");
  }
  if (!/llms-full\.txt/.test(index)) {
    problems.push("llms.txt does not link llms-full.txt");
  }
}

if (full) {
  const kb = Math.round(Buffer.byteLength(full) / 1024);
  if (kb < 100) problems.push(`llms-full.txt is only ${kb} KB — expected the full docs corpus`);
  if (kb > 2048) problems.push(`llms-full.txt is ${kb} KB — too large for practical agent use`);

  // Real component markup sits at the start of a line. A `<script lang="ts">`
  // *inside a code span* is legitimate prose (the SvelteKit guide explains
  // where macros run), so match only line-leading tags.
  if (/^\s*<(script|style|Playground|PlaygroundEmbed)\b/m.test(full)) {
    problems.push("llms-full.txt contains Vue component markup (should be stripped)");
  }
  if (/<!--/.test(full)) {
    problems.push("llms-full.txt contains HTML comments (should be stripped)");
  }

  // Each included page emits a `Source: <url>` line, so that — not an
  // incidental link to a page — is what "included as content" means.
  for (const excluded of ["/plans/", "/vision/", "/design/", "/rfcs/"]) {
    if (new RegExp(`^Source: https://typesugar\\.org${excluded}`, "m").test(full)) {
      problems.push(`llms-full.txt includes superseded internal docs as content (${excluded})`);
    }
  }
}

if (problems.length > 0) {
  console.error(`check-llms-output: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `check-llms-output: OK (llms.txt ${Math.round(Buffer.byteLength(index) / 1024)} KB, ` +
    `llms-full.txt ${Math.round(Buffer.byteLength(full) / 1024)} KB)`
);
