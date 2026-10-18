/**
 * `typesugar approve-macros` must never overwrite a config it failed to load,
 * and must read the config of the project it is pointed at, not of the cwd
 * (deep review 2026-10, core findings #20 and #35).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";
import { config } from "@typesugar/core";
import { resetLoadedPackages, __setRequireForTesting } from "../src/macro-loader.js";
import { runApproveMacros } from "../src/approve-macros.js";
import { writeApprovedMacroPackages } from "../src/config-writer.js";

let tmpDir: string;
let projectDir: string;
let otherCwd: string;
let originalCwd: string;
let originalExitCode: typeof process.exitCode;

beforeEach(() => {
  tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-approve-safety-")));
  fs.mkdirSync(path.join(tmpDir, ".git"));
  projectDir = path.join(tmpDir, "packages", "app");
  otherCwd = path.join(tmpDir, "elsewhere");
  fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
  fs.mkdirSync(otherCwd, { recursive: true });

  const pkgDir = path.join(projectDir, "node_modules", "unscoped-macro-pkg");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "unscoped-macro-pkg", version: "1.0.0", typesugar: { macros: "./m" } })
  );
  fs.writeFileSync(path.join(pkgDir, "m.js"), "module.exports.__typesugar_macros__ = [];");
  fs.writeFileSync(
    path.join(projectDir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2020", skipLibCheck: true }, include: ["src"] })
  );
  fs.writeFileSync(path.join(projectDir, "src", "index.ts"), `import "unscoped-macro-pkg";\n`);
  fs.writeFileSync(path.join(projectDir, "entry.js"), "");

  __setRequireForTesting(createRequire(path.join(projectDir, "entry.js")));
  resetLoadedPackages();
  config.reset();
  originalCwd = process.cwd();
  originalExitCode = process.exitCode;
});

afterEach(() => {
  process.chdir(originalCwd);
  process.exitCode = originalExitCode;
  __setRequireForTesting(undefined);
  resetLoadedPackages();
  config.reset();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("approve-macros config safety", () => {
  it("#20: refuses to touch a config file that fails to load, and says why", async () => {
    const configPath = path.join(projectDir, "typesugar.config.ts");
    const original = `// my hand-written config\nthrow new Error("boom");\nexport default { debug: true };\n`;
    fs.writeFileSync(configPath, original);
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m) => void errors.push(String(m)));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    process.chdir(projectDir);
    await runApproveMacros({ project: "tsconfig.json", yes: true, verbose: false });

    expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain(configPath);
    expect(errors.join("\n")).toContain("boom");
  });

  it("#35: run from another cwd with -p, it patches the project's existing config", async () => {
    const configPath = path.join(projectDir, "typesugar.config.ts");
    const original =
      `// keep this comment\n` +
      `export default {\n  debug: false,\n  security: { allowedMacroPackages: ["already-approved"] },\n};\n`;
    fs.writeFileSync(configPath, original);
    vi.spyOn(console, "log").mockImplementation(() => {});

    process.chdir(otherCwd);
    await runApproveMacros({
      project: path.join(projectDir, "tsconfig.json"),
      yes: true,
      verbose: false,
    });

    const after = fs.readFileSync(configPath, "utf-8");
    expect(after).toContain("// keep this comment");
    expect(after).toContain("debug: false");
    expect(after).toContain('"unscoped-macro-pkg"');
    expect(fs.existsSync(path.join(otherCwd, "typesugar.config.ts"))).toBe(false);
  });

  it("#20: the writer refuses to create a file over an existing config it was not told about", () => {
    const configPath = path.join(projectDir, "typesugar.config.ts");
    fs.writeFileSync(configPath, "// existing\nexport default {};\n");
    const result = writeApprovedMacroPackages({
      projectRoot: projectDir,
      existingConfigPath: undefined,
      newPackages: ["x-macros"],
    });
    expect(result.kind).toBe("refused");
    expect(fs.readFileSync(configPath, "utf-8")).toBe("// existing\nexport default {};\n");
  });
});
