/**
 * `typesugar doctor`'s TypeScript check must agree with the supported range
 * (PEP-060 item 1: >=5.9.0 <7.0.0). It used to warn only below 5.0 and suggest
 * `typescript@latest`, which installs TypeScript 7, the one major typesugar
 * refuses to run on.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { checkTypeScript } from "../src/doctor.js";

function writeProject(dir: string, declared: string, installed?: string): void {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "p", devDependencies: { typescript: declared } })
  );
  if (installed) {
    const tsDir = path.join(dir, "node_modules", "typescript");
    fs.mkdirSync(tsDir, { recursive: true });
    fs.writeFileSync(
      path.join(tsDir, "package.json"),
      JSON.stringify({ name: "typescript", version: installed })
    );
  }
}

describe("checkTypeScript", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-doctor-ts-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes for an installed 6.x", () => {
    writeProject(tmpDir, "^6.0.0", "6.0.3");
    expect(checkTypeScript(tmpDir).status).toBe("pass");
  });

  it("fails for an installed TypeScript 7, and never suggests typescript@latest", () => {
    writeProject(tmpDir, "latest", "7.0.2");
    const r = checkTypeScript(tmpDir);
    expect(r.status).toBe("fail");
    expect(r.message).toContain("7.0.2");
    expect(r.fix).toContain("typescript@6");
    expect(r.fix).not.toContain("@latest");
  });

  it("warns for 5.8, below the supported minimum", () => {
    writeProject(tmpDir, "~5.8.0", "5.8.3");
    const r = checkTypeScript(tmpDir);
    expect(r.status).toBe("warn");
    expect(r.message).toContain(">=5.9.0 <7.0.0");
  });

  it("uses the installed version over the declared range", () => {
    writeProject(tmpDir, "^5.0.0", "5.9.3");
    expect(checkTypeScript(tmpDir).status).toBe("pass");
  });

  it("falls back to the declared range when nothing is installed", () => {
    writeProject(tmpDir, "^7.0.0");
    expect(checkTypeScript(tmpDir).status).toBe("fail");
  });
});
