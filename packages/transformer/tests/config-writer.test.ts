/**
 * Tests for the `typesugar.config.ts` writer used by `typesugar approve-macros`
 * (PEP-055 Phase A).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { writeApprovedMacroPackages } from "../src/config-writer.js";

describe("writeApprovedMacroPackages", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-config-writer-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a fresh typesugar.config.ts when none exists", () => {
    const result = writeApprovedMacroPackages({
      projectRoot: tmpDir,
      existingConfigPath: undefined,
      newPackages: ["my-org-macros"],
    });

    expect(result.kind).toBe("created");
    const written = fs.readFileSync(path.join(tmpDir, "typesugar.config.ts"), "utf-8");
    expect(written).toContain('import { defineConfig } from "@typesugar/core"');
    expect(written).toContain("defineConfig(");
    expect(written).toContain("security:");
    expect(written).toContain('allowedMacroPackages: ["my-org-macros"]');
  });

  it("adds a security field to an existing defineConfig() file with none", () => {
    const configPath = path.join(tmpDir, "typesugar.config.ts");
    fs.writeFileSync(
      configPath,
      `import { defineConfig } from "@typesugar/core";\n\n` +
        `// A comment a human wrote that must survive the patch.\n` +
        `export default defineConfig({\n  debug: true,\n});\n`
    );

    const result = writeApprovedMacroPackages({
      projectRoot: tmpDir,
      existingConfigPath: configPath,
      newPackages: ["my-org-macros"],
    });

    expect(result.kind).toBe("patched");
    const written = fs.readFileSync(configPath, "utf-8");
    expect(written).toContain("// A comment a human wrote that must survive the patch.");
    expect(written).toContain("debug: true");
    expect(written).toContain('allowedMacroPackages: ["my-org-macros"]');
  });

  it("adds allowedMacroPackages to an existing empty security object", () => {
    const configPath = path.join(tmpDir, "typesugar.config.ts");
    fs.writeFileSync(configPath, `export default {\n  debug: true,\n  security: {},\n};\n`);

    const result = writeApprovedMacroPackages({
      projectRoot: tmpDir,
      existingConfigPath: configPath,
      newPackages: ["my-org-macros"],
    });

    expect(result.kind).toBe("patched");
    const written = fs.readFileSync(configPath, "utf-8");
    expect(written).toContain('allowedMacroPackages: ["my-org-macros"]');
  });

  it("appends to an existing allowedMacroPackages array, preserving existing entries", () => {
    const configPath = path.join(tmpDir, "typesugar.config.ts");
    fs.writeFileSync(
      configPath,
      `export default {\n  security: {\n    allowedMacroPackages: ["existing-pkg"],\n  },\n};\n`
    );

    const result = writeApprovedMacroPackages({
      projectRoot: tmpDir,
      existingConfigPath: configPath,
      newPackages: ["new-pkg"],
    });

    expect(result.kind).toBe("patched");
    const written = fs.readFileSync(configPath, "utf-8");
    expect(written).toContain("existing-pkg");
    expect(written).toContain("new-pkg");
  });

  it("dedups against already-present entries and reports unchanged when nothing new", () => {
    const configPath = path.join(tmpDir, "typesugar.config.ts");
    fs.writeFileSync(
      configPath,
      `export default {\n  security: {\n    allowedMacroPackages: ["existing-pkg"],\n  },\n};\n`
    );

    const result = writeApprovedMacroPackages({
      projectRoot: tmpDir,
      existingConfigPath: configPath,
      newPackages: ["existing-pkg"],
    });

    expect(result.kind).toBe("unchanged");
    const written = fs.readFileSync(configPath, "utf-8");
    expect(written.match(/existing-pkg/g)?.length).toBe(1);
  });

  it("supports module.exports = {...} CJS config files", () => {
    const configPath = path.join(tmpDir, "typesugar.config.cjs");
    fs.writeFileSync(configPath, `module.exports = {\n  debug: true,\n};\n`);

    const result = writeApprovedMacroPackages({
      projectRoot: tmpDir,
      existingConfigPath: configPath,
      newPackages: ["my-org-macros"],
    });

    expect(result.kind).toBe("patched");
    const written = fs.readFileSync(configPath, "utf-8");
    expect(written).toContain('allowedMacroPackages: ["my-org-macros"]');
  });

  it("bails with a manual snippet for an unrecognized default-export shape", () => {
    const configPath = path.join(tmpDir, "typesugar.config.ts");
    const original = `export default buildConfig();\n`;
    fs.writeFileSync(configPath, original);

    const result = writeApprovedMacroPackages({
      projectRoot: tmpDir,
      existingConfigPath: configPath,
      newPackages: ["my-org-macros"],
    });

    expect(result.kind).toBe("manual");
    if (result.kind === "manual") {
      expect(result.snippet).toContain("my-org-macros");
    }
    // Nothing was written — the original file is untouched.
    expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
  });

  it("bails with a manual snippet for a non-TS/JS config file (e.g. YAML)", () => {
    const configPath = path.join(tmpDir, ".typesugarrc.yaml");
    const original = "debug: true\n";
    fs.writeFileSync(configPath, original);

    const result = writeApprovedMacroPackages({
      projectRoot: tmpDir,
      existingConfigPath: configPath,
      newPackages: ["my-org-macros"],
    });

    expect(result.kind).toBe("manual");
    expect(fs.readFileSync(configPath, "utf-8")).toBe(original);
  });
});
