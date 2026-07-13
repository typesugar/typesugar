/**
 * Tests for AI-assistant context scaffolding (PEP-058 Wave 6).
 *
 * The load-bearing property is IDEMPOTENT MERGE: `typesugar init` may run many
 * times over a project whose AGENTS.md the user has since edited, and it must
 * refresh only its own marked block while leaving everything else untouched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mergeAgentsMd, scaffoldAiContext, findAiDir, readAgentsBlock } from "../src/ai-context.js";

const BLOCK = `<!-- typesugar:begin (generated) -->

## typesugar

Block content v1.

<!-- typesugar:end -->`;

const BLOCK_V2 = `<!-- typesugar:begin (generated) -->

## typesugar

Block content v2 — updated.

<!-- typesugar:end -->`;

describe("mergeAgentsMd", () => {
  it("creates a full file when none exists", () => {
    const result = mergeAgentsMd(undefined, BLOCK);
    expect(result).toContain("# AGENTS.md");
    expect(result).toContain("Block content v1.");
    expect(result).toContain("<!-- typesugar:begin");
  });

  it("appends the block to an existing file, preserving the user's content", () => {
    const existing = "# AGENTS.md\n\nUse tabs, not spaces. Run `npm test` before pushing.\n";
    const result = mergeAgentsMd(existing, BLOCK);

    expect(result).toContain("Use tabs, not spaces.");
    expect(result).toContain("Block content v1.");
    // User content comes first; the block is appended.
    expect(result.indexOf("Use tabs")).toBeLessThan(result.indexOf("Block content"));
  });

  it("replaces an existing block IN PLACE, preserving content on both sides", () => {
    const existing = `# AGENTS.md

Rule one: use tabs.

${BLOCK}

Rule two: never force-push.
`;
    const result = mergeAgentsMd(existing, BLOCK_V2);

    expect(result).toContain("Block content v2 — updated.");
    expect(result).not.toContain("Block content v1.");
    // Both surrounding rules survive, in order.
    expect(result).toContain("Rule one: use tabs.");
    expect(result).toContain("Rule two: never force-push.");
    expect(result.indexOf("Rule one")).toBeLessThan(result.indexOf("Block content v2"));
    expect(result.indexOf("Block content v2")).toBeLessThan(result.indexOf("Rule two"));
  });

  it("is idempotent — merging the same block twice changes nothing", () => {
    const once = mergeAgentsMd("# AGENTS.md\n\nMy rules.\n", BLOCK);
    const twice = mergeAgentsMd(once, BLOCK);
    expect(twice).toBe(once);
    // And exactly one block, not two.
    expect(twice.match(/typesugar:begin/g)?.length).toBe(1);
  });
});

describe("scaffoldAiContext", () => {
  let tmpDir: string;
  let aiDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-ai-"));
    // A stand-in for the package's shipped ai/ dir.
    aiDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-aisrc-"));
    fs.writeFileSync(path.join(aiDir, "AGENTS.md"), BLOCK);
    fs.mkdirSync(path.join(aiDir, "skills", "typesugar"), { recursive: true });
    fs.writeFileSync(
      path.join(aiDir, "skills", "typesugar", "SKILL.md"),
      "---\nname: typesugar\ndescription: test\n---\n\nbody\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(aiDir, { recursive: true, force: true });
  });

  it("creates AGENTS.md and a CLAUDE.md pointer in a fresh project", () => {
    const result = scaffoldAiContext(tmpDir, aiDir, false);

    expect(result.agentsMd).toBe("created");
    expect(result.claudePointer).toBe("created");
    expect(fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8")).toContain("Block content v1.");
    expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8")).toContain("@AGENTS.md");
  });

  it("NEVER overwrites an existing CLAUDE.md", () => {
    const claudePath = path.join(tmpDir, "CLAUDE.md");
    const original = "# My own Claude instructions\n\nDo not touch this.\n";
    fs.writeFileSync(claudePath, original);

    const result = scaffoldAiContext(tmpDir, aiDir, false);

    expect(result.claudePointer).toBe("exists");
    expect(fs.readFileSync(claudePath, "utf-8")).toBe(original);
  });

  it("installs the Claude Code skill when asked", () => {
    const result = scaffoldAiContext(tmpDir, aiDir, true);

    expect(result.skill).toBe("installed");
    const skillPath = path.join(tmpDir, ".claude", "skills", "typesugar", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.readFileSync(skillPath, "utf-8")).toContain("name: typesugar");
  });

  it("reports 'unchanged' on a second identical run (idempotent)", () => {
    scaffoldAiContext(tmpDir, aiDir, false);
    const second = scaffoldAiContext(tmpDir, aiDir, false);

    expect(second.agentsMd).toBe("unchanged");
    expect(second.claudePointer).toBe("exists");
  });
});

describe("the SHIPPED ai/ assets", () => {
  it("resolve from the package and carry the real context", () => {
    const dir = findAiDir();
    expect(dir, "packages/transformer/ai must resolve").toBeDefined();

    const block = readAgentsBlock(dir!);
    // The markers are what makes the merge idempotent — without them, re-running
    // init would append a duplicate block every time.
    expect(block.startsWith("<!-- typesugar:begin")).toBe(true);
    expect(block.trimEnd().endsWith("<!-- typesugar:end -->")).toBe(true);

    // Load-bearing facts an agent must not get wrong.
    expect(block).toContain("typesugar check");
    expect(block).toContain("typesugar expand");
    expect(block).toContain("typesugar doctor");
    expect(block).toContain("llms.txt");
    expect(block).toContain("typesugar.org/errors/");
  });

  it("ships a Claude Code skill with valid frontmatter", () => {
    const dir = findAiDir()!;
    const skill = fs.readFileSync(path.join(dir, "skills", "typesugar", "SKILL.md"), "utf-8");

    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toMatch(/^name:\s*typesugar$/m);
    // The description is what makes the skill fire — it must name the triggers.
    expect(skill).toMatch(/^description:/m);
    expect(skill).toMatch(/TS9xxx|didn't expand/);
  });
});
