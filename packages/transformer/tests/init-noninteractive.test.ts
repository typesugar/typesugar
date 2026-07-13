/**
 * `typesugar init` non-interactive mode (PEP-058 Wave 10).
 *
 * These drive the REAL CLI as a subprocess with stdin closed, because that is
 * the only way to reproduce the bug they pin: before this, `init` in a
 * pipe/CI/agent context blocked forever on its first prompt — the worst
 * failure mode available, since it is indistinguishable from a slow install.
 *
 * A tool that scaffolds AI-assistant context (Wave 6) must itself be runnable
 * *by* an AI assistant.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

const hasBuild = fs.existsSync(cliPath);

/** Run the CLI with stdin closed — i.e. exactly how CI or an agent runs it. */
function runCli(args: string[], cwd: string): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [cliPath, ...args], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"], // stdin: ignore → not a TTY
      timeout: 60_000,
    });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; signal?: string };
    if (e.signal === "SIGTERM") {
      throw new Error("CLI timed out — it is still blocking on a prompt with no TTY");
    }
    return { status: e.status ?? 1, output: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

describe.skipIf(!hasBuild)("typesugar init — non-interactive", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-init-ni-"));
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", private: true }, null, 2)
    );
    fs.writeFileSync(
      path.join(tmpDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "ES2020" } }, null, 2)
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("without --yes and without a TTY: fails FAST with an actionable message (never hangs)", () => {
    const { status, output } = runCli(["init"], tmpDir);

    expect(status).not.toBe(0);
    expect(output).toContain("not a TTY");
    // It must tell you the way out, not just complain.
    expect(output).toContain("--yes");
  });

  it("rejects an invalid --persona instead of silently guessing", () => {
    const { status, output } = runCli(["init", "--yes", "--persona", "wizard"], tmpDir);

    expect(status).not.toBe(0);
    expect(output).toContain("Invalid --persona");
    expect(output).toContain("app-developer");
  });

  it("--yes --no-ai runs end to end with no TTY and configures the project", () => {
    const { status, output } = runCli(["init", "--yes", "--no-ai"], tmpDir);

    expect(status, `init failed:\n${output}`).toBe(0);

    // The persona question answered itself with the safe default.
    expect(output).toContain("app-developer");

    // And it actually did the work.
    const tsconfig = fs.readFileSync(path.join(tmpDir, "tsconfig.json"), "utf-8");
    expect(tsconfig).toContain("@typesugar/transformer");

    // --no-ai was honored.
    expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(false);
  });

  it("--yes --ai scaffolds the AI context with no TTY", () => {
    const { status, output } = runCli(["init", "--yes", "--ai", "--persona", "end-user"], tmpDir);

    expect(status, `init failed:\n${output}`).toBe(0);
    expect(output).toContain("end-user");

    const agents = path.join(tmpDir, "AGENTS.md");
    expect(fs.existsSync(agents)).toBe(true);
    expect(fs.readFileSync(agents, "utf-8")).toContain("typesugar:begin");
    expect(fs.existsSync(path.join(tmpDir, ".claude", "skills", "typesugar", "SKILL.md"))).toBe(
      true
    );
  });
});

describe.skipIf(!hasBuild)("typesugar create — non-interactive", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-create-ni-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("with no args and no TTY: fails fast telling you which args to pass", () => {
    const { status, output } = runCli(["create"], tmpDir);

    expect(status).not.toBe(0);
    expect(output).toContain("not a TTY");
    expect(output).toContain("app|library|macro-plugin");
  });

  it("with args: scaffolds without prompting", () => {
    const { status, output } = runCli(["create", "app", "demo"], tmpDir);

    expect(status, `create failed:\n${output}`).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "demo", "package.json"))).toBe(true);
  });
});
