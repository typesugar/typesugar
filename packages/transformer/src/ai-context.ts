/**
 * AI-assistant context scaffolding (PEP-058 Wave 6).
 *
 * Writes the canonical typesugar context — shipped in this package at
 * `ai/AGENTS.md` — into a consumer's project, so their coding assistant
 * (Claude Code, Cursor, Copilot, Codex, Zed…) knows how typesugar works, what
 * it must not "clean up", and how to debug an expansion.
 *
 * Design:
 *
 * - **AGENTS.md is the one file.** It is the emerging cross-tool convention,
 *   read natively by Cursor, Copilot, Codex and Zed, so per-tool duplicates
 *   (`.cursor/rules/*.mdc`, `.github/copilot-instructions.md`) would be pure
 *   drift surface. Claude Code gets a one-line *pointer* CLAUDE.md instead.
 * - **Marker-delimited and idempotent.** Content lives between
 *   `<!-- typesugar:begin -->` / `<!-- typesugar:end -->`. Re-running `init`
 *   replaces only that block; everything the user wrote around it survives.
 * - **Sourced from the installed package, never inlined here.** The context
 *   ships as a real file in `ai/`, so it updates with the package and cannot
 *   drift from the docs it summarizes.
 */

import * as fs from "fs";
import * as path from "path";

const BEGIN = "<!-- typesugar:begin";
const END = "<!-- typesugar:end -->";

const CLAUDE_POINTER = `# Project instructions

See @AGENTS.md for how this project uses typesugar (compile-time macros) —
setup invariants, macro syntax, and the debugging workflow.
`;

/**
 * Locate this package's shipped `ai/` directory.
 *
 * Same resolution shape as `findTemplatesDir` in create.ts: `dist/../ai`
 * resolves identically for a published npm install and the monorepo checkout,
 * because `ai` is listed in package.json's `files`.
 */
export function findAiDir(): string | undefined {
  const candidate = path.join(__dirname, "..", "ai");
  return fs.existsSync(candidate) ? candidate : undefined;
}

/** The canonical AGENTS.md block, as shipped in this package. */
export function readAgentsBlock(aiDir: string): string {
  return fs.readFileSync(path.join(aiDir, "AGENTS.md"), "utf-8").trim();
}

/**
 * Merge the typesugar block into an existing AGENTS.md body (or create one).
 *
 * Returns the full new file content. Idempotent: an existing typesugar block
 * is replaced in place; a file without one gets the block appended; content
 * outside the markers is never touched.
 */
export function mergeAgentsMd(existing: string | undefined, block: string): string {
  if (!existing || existing.trim() === "") {
    return `# AGENTS.md\n\nInstructions for AI coding assistants working in this repository.\n\n${block}\n`;
  }

  const beginIdx = existing.indexOf(BEGIN);
  const endIdx = existing.indexOf(END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    // Replace the existing block, preserving everything around it.
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + END.length);
    return before + block + after;
  }

  // No block yet — append, leaving the user's content first.
  return `${existing.replace(/\n*$/, "")}\n\n${block}\n`;
}

export interface AiScaffoldResult {
  agentsMd: "created" | "updated" | "unchanged";
  claudePointer: "created" | "exists" | "skipped";
  skill: "installed" | "skipped";
}

/**
 * Write the AI context into `cwd`.
 *
 * @param installSkill install the Claude Code skill into `.claude/skills/`
 *                     (caller decides: e.g. only when `.claude/` exists or
 *                     `--ai` was passed explicitly).
 */
export function scaffoldAiContext(
  cwd: string,
  aiDir: string,
  installSkill: boolean
): AiScaffoldResult {
  const block = readAgentsBlock(aiDir);

  // --- AGENTS.md -----------------------------------------------------------
  const agentsPath = path.join(cwd, "AGENTS.md");
  const existing = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf-8") : undefined;
  const merged = mergeAgentsMd(existing, block);

  let agentsMd: AiScaffoldResult["agentsMd"];
  if (existing === undefined) {
    agentsMd = "created";
  } else if (existing === merged) {
    agentsMd = "unchanged";
  } else {
    agentsMd = "updated";
  }
  if (agentsMd !== "unchanged") fs.writeFileSync(agentsPath, merged);

  // --- CLAUDE.md pointer ---------------------------------------------------
  // Only ever CREATE one. An existing CLAUDE.md is the user's own file and is
  // never edited unprompted — the caller prints a suggestion instead.
  const claudePath = path.join(cwd, "CLAUDE.md");
  let claudePointer: AiScaffoldResult["claudePointer"];
  if (fs.existsSync(claudePath)) {
    claudePointer = "exists";
  } else {
    fs.writeFileSync(claudePath, CLAUDE_POINTER);
    claudePointer = "created";
  }

  // --- Claude Code skill ---------------------------------------------------
  let skill: AiScaffoldResult["skill"] = "skipped";
  if (installSkill) {
    const src = path.join(aiDir, "skills", "typesugar", "SKILL.md");
    if (fs.existsSync(src)) {
      const destDir = path.join(cwd, ".claude", "skills", "typesugar");
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, path.join(destDir, "SKILL.md"));
      skill = "installed";
    }
  }

  return { agentsMd, claudePointer, skill };
}
