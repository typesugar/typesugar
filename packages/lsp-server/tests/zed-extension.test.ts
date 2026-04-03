/**
 * Tests for the Zed extension structure.
 * Validates extension.toml format and build artifacts.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ZED_DIR = path.resolve(__dirname, "../../zed");

describe("Zed extension", () => {
  it("has a valid extension.toml with required fields", () => {
    const tomlPath = path.join(ZED_DIR, "extension.toml");
    expect(fs.existsSync(tomlPath)).toBe(true);

    const content = fs.readFileSync(tomlPath, "utf-8");

    // Required top-level fields per Zed schema
    expect(content).toMatch(/^id\s*=/m);
    expect(content).toMatch(/^name\s*=/m);
    expect(content).toMatch(/^version\s*=/m);
    expect(content).toMatch(/^schema_version\s*=/m);
    expect(content).toMatch(/^authors\s*=/m);
    expect(content).toMatch(/^description\s*=/m);
    expect(content).toMatch(/^repository\s*=/m);

    // Must NOT use [package] (that's a common mistake)
    expect(content).not.toMatch(/^\[package\]/m);

    // schema_version must be 1
    expect(content).toMatch(/schema_version\s*=\s*1/);
  });

  it("has language configs for .sts and .stsx", () => {
    const stsConfig = path.join(ZED_DIR, "languages/sugared-typescript/config.toml");
    const stsxConfig = path.join(ZED_DIR, "languages/sugared-typescriptreact/config.toml");

    expect(fs.existsSync(stsConfig)).toBe(true);
    expect(fs.existsSync(stsxConfig)).toBe(true);

    const stsContent = fs.readFileSync(stsConfig, "utf-8");
    const stsxContent = fs.readFileSync(stsxConfig, "utf-8");

    // Verify file extensions are registered
    expect(stsContent).toContain('"sts"');
    expect(stsxContent).toContain('"stsx"');

    // Verify grammars
    expect(stsContent).toMatch(/grammar\s*=\s*"typescript"/);
    expect(stsxContent).toMatch(/grammar\s*=\s*"tsx"/);
  });

  it("has Rust source that compiles (Cargo.toml and src/lib.rs exist)", () => {
    expect(fs.existsSync(path.join(ZED_DIR, "Cargo.toml"))).toBe(true);
    expect(fs.existsSync(path.join(ZED_DIR, "src/lib.rs"))).toBe(true);

    const cargoContent = fs.readFileSync(path.join(ZED_DIR, "Cargo.toml"), "utf-8");
    expect(cargoContent).toContain('crate-type = ["cdylib"]');
    expect(cargoContent).toContain("zed_extension_api");
  });

  it("references typesugar-lsp in the language server config", () => {
    const tomlContent = fs.readFileSync(path.join(ZED_DIR, "extension.toml"), "utf-8");
    expect(tomlContent).toContain("typesugar-lsp");
    expect(tomlContent).toContain("Sugared TypeScript");
  });

  it("Rust source launches server via node", () => {
    const libRs = fs.readFileSync(path.join(ZED_DIR, "src/lib.rs"), "utf-8");
    expect(libRs).toContain("node");
    expect(libRs).toContain("--stdio");
    expect(libRs).toContain("bin/typesugar-lsp");
  });
});
