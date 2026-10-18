#!/usr/bin/env node
/**
 * Error-catalog page generator (PEP-058 Wave 4).
 *
 * Generates/updates one docs page per diagnostic descriptor in
 * `@typesugar/core`'s DIAGNOSTIC_CATALOG (TS9xxx) and `@typesugar/effect`'s
 * effectDiagnostics (EFFECT0xx), plus the categorized docs/errors/index.md.
 *
 * Each page has two regions:
 *
 *   <!-- generated:begin ... -->   machine-derived facts (title, severity,
 *   ...                            category, message template, explanation)
 *   <!-- generated:end -->         — regenerated verbatim from the catalog
 *
 *   everything below the markers   hand-written Example / How to fix prose —
 *                                  NEVER touched by this script
 *
 * Modes:
 *   node scripts/generate-error-docs.mjs           write/update pages
 *   node scripts/generate-error-docs.mjs --check   fail (exit 1) if any page
 *                                                  is missing or its generated
 *                                                  region is stale (CI gate)
 *
 * Pages are committed (not build-time generated) so they are PR-reviewable,
 * hand-editable below the markers, greppable by agents reading the repo, and
 * flow into llms-full.txt without special-casing the docs build.
 *
 * Requires built packages (pnpm build) — the catalogs are imported from dist.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const errorsDir = path.join(repoRoot, "docs", "errors");

// The generated region is wrapped in prettier-ignore markers: descriptor
// explanations are prose with inline `/** ... */` snippets that prettier's
// markdown formatter would corrupt (escaping ** as emphasis), and the region
// is machine-owned anyway — keeping prettier out makes the generator's
// output byte-stable against `format:check`.
const GEN_BEGIN =
  "<!-- generated:begin — do not edit inside this block; regenerate with `node scripts/generate-error-docs.mjs` -->\n<!-- prettier-ignore-start -->";
const GEN_END = "<!-- prettier-ignore-end -->\n<!-- generated:end -->";

// A new page ships with NO hand-written region: the generated region (message
// + full explanation, which the descriptors carry) already stands on its own,
// and empty `## Example` / `## How to fix` headings would render as bare
// headings with nothing under them. The region is purely additive — write it
// (below the end marker) when a page earns a worked example, and the generator
// will preserve it verbatim from then on.
const HANDWRITTEN_SKELETON = "";

/** Human-readable names for DiagnosticCategory values (core) and effect categories. */
const CATEGORY_LABELS = {
  typeclass: "Typeclass Resolution",
  syntax: "Macro Syntax",
  expansion: "Macro Expansion",
  derive: "Derive",
  import: "Import Resolution",
  comptime: "Comptime",
  config: "Configuration",
  hkt: "Higher-Kinded Types",
  extension: "Extension Methods",
  operator: "Operators",
  "opt-out": "Opt-Out",
  internal: "Internal",
};

/**
 * Catalogued codes the compiler never emits (docs review 2026-10, docs-start
 * #29). Their pages say so at the top, and the index marks them, so a reader
 * whose build fails with a different code isn't sent chasing a page that
 * describes a check typesugar doesn't perform.
 *
 * This is the single source list. `checkReservedList` re-derives it from the
 * source tree on every run (both modes) and fails if the two disagree, so it
 * can't silently drift: emit one of these codes and the generator tells you
 * to remove it from here; stop emitting a code and it tells you to add it.
 */
const RESERVED_CODES = new Set([
  "TS9002",
  "TS9003",
  "TS9004",
  "TS9006",
  "TS9007",
  "TS9052",
  "TS9060",
  "TS9061",
  "TS9062",
  "TS9063",
  "TS9102",
  "TS9105",
  "TS9201",
  "TS9202",
  "TS9204",
  "TS9207",
  "TS9208",
  "TS9210",
  "TS9211",
  "TS9214",
  "TS9215",
  "TS9216",
  "TS9218",
  "TS9220",
  "TS9301",
  "TS9401",
  "TS9501",
  "TS9502",
  "TS9701",
  "TS9702",
  "TS9703",
  "TS9800",
  "TS9801",
  "TS9802",
  "TS9803",
  "EFFECT002",
  "EFFECT003",
  "EFFECT010",
  "EFFECT011",
  "EFFECT021",
  "EFFECT030",
  "EFFECT040",
]);

/**
 * Files that only DECLARE or re-export descriptors; a code mentioned only
 * there is not emitted.
 */
const CATALOG_FILES = new Set([
  "packages/core/src/diagnostics.ts",
  "packages/effect/src/diagnostics.ts",
  "packages/effect/src/index.ts",
]);

/** Non-test `.ts` sources under packages/<pkg>/src, as repo-relative paths. */
function listSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (["node_modules", "dist", "__tests__", "tests", "test"].includes(ent.name)) continue;
        walk(full);
      } else if (/\.tsx?$/.test(ent.name) && !/\.(test|spec)\.tsx?$/.test(ent.name)) {
        out.push(path.relative(repoRoot, full).split(path.sep).join("/"));
      }
    }
  };
  const pkgsDir = path.join(repoRoot, "packages");
  for (const pkg of fs.readdirSync(pkgsDir)) {
    const src = path.join(pkgsDir, pkg, "src");
    if (fs.existsSync(src)) walk(src);
  }
  return out;
}

/**
 * Which catalogued ids are referenced by any source file outside the
 * catalogue itself. A `TS9xxx` code counts when its identifier (`TS9002`)
 * or bare number (`9002`) appears; there is no `TS${n}`-style computed
 * lookup of descriptors in the source tree (getDiagnosticDescriptor is not
 * called with computed codes), so a textual scan is complete.
 */
function referencedIds(ids) {
  const texts = listSourceFiles()
    .filter((f) => !CATALOG_FILES.has(f))
    .map((f) => fs.readFileSync(path.join(repoRoot, f), "utf-8"));
  const referenced = new Set();
  for (const id of ids) {
    const num = id.startsWith("TS") ? id.slice(2) : null;
    const re = num ? new RegExp(`\\b(?:TS)?${num}\\b`) : new RegExp(`\\b${id}\\b`);
    if (texts.some((t) => re.test(t))) referenced.add(id);
  }
  return referenced;
}

/** Problems where RESERVED_CODES disagrees with the source tree. */
function checkReservedList(entries) {
  const ids = entries.map((e) => e.id);
  const referenced = referencedIds(ids);
  const problems = [];
  for (const id of ids) {
    if (RESERVED_CODES.has(id) && referenced.has(id)) {
      problems.push(
        `${id} is now referenced outside the catalogue: remove it from RESERVED_CODES in scripts/generate-error-docs.mjs and regenerate`
      );
    } else if (!RESERVED_CODES.has(id) && !referenced.has(id)) {
      problems.push(
        `${id} is never referenced outside the catalogue: add it to RESERVED_CODES in scripts/generate-error-docs.mjs and regenerate`
      );
    }
  }
  for (const id of RESERVED_CODES) {
    if (!ids.includes(id)) problems.push(`RESERVED_CODES lists ${id}, which is not in any catalog`);
  }
  return problems;
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category;
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Escape `<` / `>` that appear in PROSE, leaving fenced blocks and code spans
 * alone.
 *
 * VitePress compiles each markdown page as a Vue template, so a bare
 * `Effect<A, never, never>` or `Functor<Option>` in an explanation is parsed
 * as an unclosed HTML element and hard-fails the docs build. Inside code
 * fences and code spans the markdown renderer emits escaped entities before
 * Vue ever sees them, so those regions must be left byte-exact — escaping
 * there would surface literal `&lt;` in the rendered code.
 */
function escapeAnglesOutsideCode(text) {
  // Alternate between code regions (fenced blocks, then inline spans) and
  // prose; only prose gets escaped.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) =>
      // Odd indices are the captured code regions — pass through untouched.
      i % 2 === 1 ? part : part.replace(/</g, "&lt;").replace(/>/g, "&gt;")
    )
    .join("");
}

/** Render the generated region for one descriptor. */
function renderGenerated(id, d) {
  const lines = [];
  lines.push(GEN_BEGIN);
  lines.push("");
  lines.push(`# ${id}`);
  lines.push("");
  if (RESERVED_CODES.has(id)) {
    lines.push(
      "> **Reserved: not currently emitted by the compiler.** This code is catalogued, but no"
    );
    lines.push(
      "> typesugar check reports it yet. If your build fails, look up the code it actually prints."
    );
    lines.push("");
  }
  lines.push(`**Category:** ${categoryLabel(d.category)} · **Severity:** ${titleCase(d.severity)}`);
  lines.push("");
  lines.push("## Message");
  lines.push("");
  lines.push("```");
  lines.push(d.messageTemplate);
  lines.push("```");
  lines.push("");
  lines.push("## Explanation");
  lines.push("");
  lines.push(escapeAnglesOutsideCode(d.explanation.trim()));
  lines.push("");
  lines.push(GEN_END);
  return lines.join("\n");
}

/** Split an existing page into { generated, handwritten } (either may be null). */
function splitPage(content) {
  // Split on the OUTER markers only — stable across generator-format changes
  // (e.g. the inner prettier-ignore wrapper) so an old-format page migrates
  // cleanly instead of having its stale generated region demoted to
  // hand-written content.
  const endMarker = "<!-- generated:end -->";
  const beginIdx = content.indexOf("<!-- generated:begin");
  const endIdx = content.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1) {
    return { generated: null, handwritten: content };
  }
  const generated = content.slice(beginIdx, endIdx + endMarker.length);
  const handwritten = content.slice(endIdx + endMarker.length).replace(/^\n+/, "");
  return { generated, handwritten };
}

/**
 * Wrap `text` in a markdown code span that survives backticks inside it.
 * Several message templates are themselves backtick-quoted (e.g.
 * "No instance found for `{typeclass}<{type}>`"), which would terminate a
 * single-backtick span early and render as broken markup. Per CommonMark, a
 * span delimited by N backticks can contain any run shorter than N; a leading
 * or trailing backtick additionally needs one space of padding.
 */
function codeSpan(text) {
  const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longestRun + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function renderIndex(entries) {
  const byCategory = new Map();
  for (const e of entries) {
    const label = categoryLabel(e.descriptor.category);
    if (!byCategory.has(label)) byCategory.set(label, []);
    byCategory.get(label).push(e);
  }

  const lines = [];
  lines.push(GEN_BEGIN);
  lines.push("");
  lines.push("# Error Reference");
  lines.push("");
  lines.push("Every diagnostic the typesugar compiler can emit, generated from the");
  lines.push("catalogs in `packages/core/src/diagnostics.ts` (TS9xxx) and");
  lines.push("`packages/effect/src/diagnostics.ts` (EFFECT0xx).");
  lines.push("");
  lines.push("Codes marked *(reserved)* are catalogued but not currently emitted by the");
  lines.push("compiler.");
  lines.push("");
  for (const [label, group] of byCategory) {
    lines.push(`## ${label}`);
    lines.push("");
    lines.push("| Code | Severity | Message |");
    lines.push("| --- | --- | --- |");
    for (const e of group) {
      const msg = e.descriptor.messageTemplate.replace(/\|/g, "\\|").replace(/\n.*/s, "");
      lines.push(
        `| [${e.id}](./${e.id}.md)${RESERVED_CODES.has(e.id) ? " *(reserved)*" : ""} | ${titleCase(e.descriptor.severity)} | ${codeSpan(msg)} |`
      );
    }
    lines.push("");
  }
  lines.push(GEN_END);
  lines.push("");
  return lines.join("\n");
}

async function loadCatalogs() {
  const core = await import(path.join(repoRoot, "packages", "core", "dist", "index.js"));
  const effect = await import(path.join(repoRoot, "packages", "effect", "dist", "index.js"));

  const entries = [];
  for (const [code, descriptor] of core.DIAGNOSTIC_CATALOG) {
    entries.push({ id: `TS${code}`, descriptor });
  }
  for (const [id, descriptor] of Object.entries(effect.effectDiagnostics)) {
    entries.push({ id, descriptor });
  }
  return entries;
}

async function main() {
  const checkMode = process.argv.includes("--check");
  const entries = await loadCatalogs();
  const problems = checkReservedList(entries);
  let written = 0;

  fs.mkdirSync(errorsDir, { recursive: true });

  for (const { id, descriptor } of entries) {
    const pagePath = path.join(errorsDir, `${id}.md`);
    const generated = renderGenerated(id, descriptor);

    if (!fs.existsSync(pagePath)) {
      if (checkMode) {
        problems.push(`missing page: docs/errors/${id}.md`);
        continue;
      }
      fs.writeFileSync(pagePath, generated + "\n" + HANDWRITTEN_SKELETON);
      written++;
      continue;
    }

    const content = fs.readFileSync(pagePath, "utf-8");
    const { generated: existing, handwritten } = splitPage(content);

    if (existing === generated) continue;

    if (checkMode) {
      problems.push(
        existing === null
          ? `no generated region: docs/errors/${id}.md`
          : `stale generated region: docs/errors/${id}.md`
      );
      continue;
    }

    const preserved =
      handwritten && handwritten.trim().length > 0
        ? handwritten
        : HANDWRITTEN_SKELETON.replace(/^\n/, "");
    // A page with no hand-written region ends right after the generated
    // one (as a freshly created page does), not with stray blank lines.
    fs.writeFileSync(
      pagePath,
      preserved.trim().length > 0
        ? generated + "\n\n" + preserved.replace(/\n*$/, "\n")
        : generated + "\n"
    );
    written++;
  }

  // Index page (fully generated — the whole file is the generated region).
  const indexPath = path.join(errorsDir, "index.md");
  const index = renderIndex(entries);
  if (checkMode) {
    const current = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf-8") : "";
    if (current !== index) problems.push("stale: docs/errors/index.md");
  } else if (!fs.existsSync(indexPath) || fs.readFileSync(indexPath, "utf-8") !== index) {
    fs.writeFileSync(indexPath, index);
    written++;
  }

  // Orphan check: pages for codes no longer in any catalog.
  const known = new Set(entries.map((e) => `${e.id}.md`));
  for (const f of fs.readdirSync(errorsDir)) {
    if (f === "index.md" || !f.endsWith(".md")) continue;
    if (!known.has(f)) problems.push(`orphaned page (code not in any catalog): docs/errors/${f}`);
  }

  if (problems.length > 0) {
    console.error(
      `generate-error-docs${checkMode ? " --check" : ""}: ${problems.length} problem(s):`
    );
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  console.log(
    checkMode
      ? `generate-error-docs --check: ${entries.length} codes, all pages current.`
      : `generate-error-docs: ${entries.length} codes, ${written} file(s) written.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
