/**
 * llms.txt / llms-full.txt generator (PEP-058 Wave 5).
 *
 * Runs from VitePress's `buildEnd` hook, so it writes into the build's
 * `outDir` and flows through the existing Vercel deploy path untouched.
 *
 * - `llms.txt`      — the llmstxt.org index: a short summary plus one link
 *                     line per page, in SIDEBAR ORDER (shared with the site
 *                     itself via `./sidebar.ts`), so an agent can fetch just
 *                     the page it needs.
 * - `llms-full.txt` — every included page's markdown concatenated in the
 *                     same order, for agents that want the whole corpus in
 *                     one request.
 *
 * The error catalog (docs/errors/, PEP-058 Wave 4) is walked directly rather
 * than through the sidebar: the sidebar links only the index, but each of the
 * ~71 per-code pages is exactly the content an agent needs when a user hits
 * that diagnostic.
 *
 * Internal design material (plans/, vision/, design/, rfcs/, ANALYSIS-*,
 * PLAN-*, architecture.md) is EXCLUDED: much of it predates PEP-047/052/053
 * and describes a model the shipped compiler no longer implements. Feeding it
 * to an agent would actively produce wrong code.
 */

import fs from "node:fs";
import path from "node:path";
import type { DefaultTheme } from "vitepress";
import { sidebar } from "./sidebar.js";

const SITE = "https://typesugar.org";

const SUMMARY =
  "typesugar is a compile-time macro system for TypeScript: Scala-3-style " +
  "metaprogramming (typeclasses, derivation, pattern matching, operator " +
  "overloading, compile-time evaluation) that expands to plain, zero-cost " +
  "TypeScript at build time. Source files are valid TypeScript, but they " +
  "must be compiled through a typesugar-aware pipeline (the unplugin for " +
  "bundlers, or ts-patch for tsc) for macros to expand.";

/** Flatten the sidebar tree into ordered leaf links (deduped, site-relative). */
function collectSidebarLinks(items: DefaultTheme.SidebarItem[]): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const walk = (nodes: DefaultTheme.SidebarItem[]): void => {
    for (const node of nodes) {
      if (node.link && !seen.has(node.link)) {
        seen.add(node.link);
        links.push(node.link);
      }
      if (node.items) walk(node.items as DefaultTheme.SidebarItem[]);
    }
  };
  walk(items);
  return links;
}

/** Resolve a site link ("/guides/derive") to its source markdown file. */
function sourceFileFor(srcDir: string, link: string): string | undefined {
  const rel = link.replace(/^\//, "").replace(/\/$/, "");
  const candidates = rel === "" ? ["index.md"] : [`${rel}.md`, `${rel}/index.md`];
  for (const c of candidates) {
    const full = path.join(srcDir, c);
    if (fs.existsSync(full)) return full;
  }
  return undefined;
}

/** Strip YAML frontmatter and Vue/script blocks; return { title, body }. */
function readPage(file: string): { title: string; body: string; description: string } {
  let content = fs.readFileSync(file, "utf-8");

  // Frontmatter — capture title/description/hero if present, then drop the
  // block. The site's landing page is a VitePress `layout: home` page: it has
  // no H1 and no prose, only a `hero:`/`features:` block, so its title and
  // description have to come from there.
  let fmTitle = "";
  let fmDescription = "";
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (fm) {
    const block = fm[1];
    // Top-level keys only (unindented). The home page's `features:` list also
    // contains `- title:` / `- details:` entries, and an indent-tolerant match
    // would pick a feature card's title as the page title.
    const pickTop = (key: string): string => {
      const m = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(block);
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    // Hero keys are nested under `hero:` — allow (and require) indentation.
    const pickHero = (key: string): string => {
      const m = new RegExp(`^[ \\t]+${key}:[ \\t]*(.+)$`, "m").exec(block);
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    fmTitle = pickTop("title") || pickHero("name");
    fmDescription = pickTop("description") || pickHero("tagline");
    content = content.slice(fm[0].length);
  }

  // Vue component machinery — the Playground embeds. Their rendered output is
  // interactive, so there is nothing for a text corpus to keep. HTML comments
  // go too: the error pages carry generator markers (PEP-058 Wave 4) that are
  // pure noise in an LLM corpus.
  content = content
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    .replace(/<style\b[\s\S]*?<\/style>/g, "")
    .replace(/<Playground\b[\s\S]*?(?:\/>|<\/Playground>)/g, "")
    .replace(/<PlaygroundEmbed\b[\s\S]*?(?:\/>|<\/PlaygroundEmbed>)/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\n{3,}/g, "\n\n");

  // Title: frontmatter, else first H1, else the filename.
  const h1 = /^#\s+(.+)$/m.exec(content);
  const title = fmTitle || (h1 ? h1[1].trim() : path.basename(file, ".md"));

  let description = fmDescription;

  // Error-catalog pages lead with a Category/Severity line; the diagnostic's
  // MESSAGE is the useful one-line summary for an agent scanning the index.
  if (!description) {
    const message = /^##\s+Message\s*\n+```[^\n]*\n([\s\S]*?)```/m.exec(content);
    if (message) description = message[1].trim().split("\n")[0];
  }

  // Otherwise: the first prose line after the H1. Fenced code blocks are
  // removed first — a page that opens with an example would otherwise yield
  // an `import ...` line as its summary.
  if (!description) {
    const prose = (h1 ? content.slice(content.indexOf(h1[0]) + h1[0].length) : content).replace(
      /```[\s\S]*?```/g,
      ""
    );
    for (const line of prose.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("<")) continue;
      if (t.startsWith("::") || t.startsWith("|") || t.startsWith(">") || t.startsWith("-"))
        continue;
      description = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*`_]/g, "");
      break;
    }
  }
  if (description.length > 160) description = description.slice(0, 157).trimEnd() + "…";

  return { title, description, body: content.trim() };
}

/** Rewrite site-relative links to absolute, so the corpus stands alone. */
function absolutizeLinks(md: string): string {
  return md.replace(/\]\((\/[^)]*)\)/g, (_m, href: string) => `](${SITE}${href})`);
}

/** Every error-catalog page, in code order (index first). */
function errorPages(srcDir: string): string[] {
  const dir = path.join(srcDir, "errors");
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .sort();
  return ["/errors/", ...files.map((f) => `/errors/${f.replace(/\.md$/, "")}`)];
}

export function generateLlmsTxt(srcDir: string, outDir: string): void {
  const sidebarLinks = collectSidebarLinks(sidebar);

  // The sidebar links /errors/ (the index); expand that one entry into the
  // full per-code catalog, in place, so codes appear where the nav puts them.
  const links: string[] = [];
  for (const link of sidebarLinks) {
    if (link === "/errors/") links.push(...errorPages(srcDir));
    else links.push(link);
  }

  const pages = links
    .map((link) => {
      const file = sourceFileFor(srcDir, link);
      if (!file) return undefined;
      return { link, file, ...readPage(file) };
    })
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  // ---- llms.txt (the index) -------------------------------------------------
  const index: string[] = [];
  index.push("# typesugar");
  index.push("");
  index.push(`> ${SUMMARY}`);
  index.push("");
  index.push(`The full documentation corpus in a single file: ${SITE}/llms-full.txt`);
  index.push("");
  index.push("## Documentation");
  index.push("");
  for (const p of pages) {
    const url = `${SITE}${p.link}`;
    index.push(
      p.description ? `- [${p.title}](${url}): ${p.description}` : `- [${p.title}](${url})`
    );
  }
  index.push("");
  fs.writeFileSync(path.join(outDir, "llms.txt"), index.join("\n"));

  // ---- llms-full.txt (the corpus) ------------------------------------------
  const full: string[] = [];
  full.push("# typesugar — full documentation");
  full.push("");
  full.push(SUMMARY);
  full.push("");
  full.push(`Source: ${SITE}  ·  Generated at build time from the docs sidebar.`);
  full.push("");
  for (const p of pages) {
    full.push("---");
    full.push("");
    full.push(`# ${p.title}`);
    full.push("");
    full.push(`Source: ${SITE}${p.link}`);
    full.push("");
    // Drop the page's own H1 (we just emitted a canonical one).
    const body = p.body.replace(/^#\s+.+$/m, "").trim();
    full.push(absolutizeLinks(body));
    full.push("");
  }
  const fullText = full.join("\n");
  fs.writeFileSync(path.join(outDir, "llms-full.txt"), fullText);

  const kb = Math.round(Buffer.byteLength(fullText) / 1024);
  console.log(
    `[llms] llms.txt: ${pages.length} pages · llms-full.txt: ${kb} KB (${pages.length} pages)`
  );
}
