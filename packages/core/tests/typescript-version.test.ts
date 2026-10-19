/**
 * PEP-060 item 1: the TypeScript-major guard.
 *
 * TypeScript 7 (`typescript@7.x`) ships only `version`/`versionMajorMinor` from its
 * root entry — no `factory`, no `createProgram`, no transformer hooks. Without a
 * guard, the first `ts.ScriptTarget.ES2022` / `ts.factory.*` access throws an opaque
 * "Cannot read properties of undefined". These tests simulate a TS-7-shaped module
 * (TS 7 is deliberately not installed) and assert the one actionable message.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import {
  assertSupportedTypeScript,
  getUnsupportedTypeScriptReason,
  UnsupportedTypeScriptError,
  TYPESCRIPT_SUPPORT_URL,
} from "@typesugar/core";

const ts7Shaped = () => ({ version: "7.0.2", versionMajorMinor: "7.0" });

describe("TypeScript version guard", () => {
  it("rejects a TS-7-shaped module with one actionable message", () => {
    expect(() => assertSupportedTypeScript(ts7Shaped())).toThrow(UnsupportedTypeScriptError);
    expect(() => assertSupportedTypeScript(ts7Shaped())).toThrow(
      "[typesugar] TypeScript 7.0.2 is not supported: TypeScript 7 removed the JavaScript " +
        "compiler API that typesugar's transformer needs. Install typescript@6 (or 5.9+) as a " +
        "devDependency for typesugar (npm i -D typescript@6); see " +
        TYPESCRIPT_SUPPORT_URL
    );
  });

  it("links to a troubleshooting anchor that exists in the docs", async () => {
    const fs = await import("node:fs");
    expect(TYPESCRIPT_SUPPORT_URL).toBe(
      "https://typesugar.org/getting-started/troubleshooting#typescript-7"
    );
    const doc = fs.readFileSync(
      new URL("../../../docs/getting-started/troubleshooting.md", import.meta.url),
      "utf8"
    );
    expect(doc).toContain("{#typescript-7}");
  });

  it("rejects TS 7 even if it someday grows a factory (the major is what counts)", () => {
    const mod = { ...ts7Shaped(), factory: {}, createProgram: () => undefined };
    expect(getUnsupportedTypeScriptReason(mod)).toMatch(/TypeScript 7\.0\.2 is not supported/);
  });

  it("rejects a module with a supported-looking version but no compiler API", () => {
    const reason = getUnsupportedTypeScriptReason({ version: "6.0.3", versionMajorMinor: "6.0" });
    expect(reason).toMatch(/^\[typesugar\] The "typescript" module \(version 6\.0\.3\)/);
    expect(reason).toContain("ts.factory / ts.createProgram");
    expect(reason).toContain(TYPESCRIPT_SUPPORT_URL);
  });

  it("rejects TypeScript older than 5.9 (measured floor, see MIN_MINOR)", () => {
    for (const version of ["4.9.5", "5.0.4", "5.5.4", "5.8.3"]) {
      const reason = getUnsupportedTypeScriptReason({
        version,
        versionMajorMinor: version.split(".").slice(0, 2).join("."),
        factory: {},
        createProgram: () => undefined,
      });
      expect(reason).toContain(
        `TypeScript ${version} is not supported: typesugar needs TypeScript 5.9 or later (>=5.9.0 <7.0.0)`
      );
    }
  });

  it("accepts 5.x and 6.x modules with the JS compiler API", () => {
    for (const version of ["5.9.2", "5.9.3", "6.0.3"]) {
      const mod = {
        version,
        versionMajorMinor: version.split(".").slice(0, 2).join("."),
        factory: {},
        createProgram: () => undefined,
      };
      expect(getUnsupportedTypeScriptReason(mod)).toBeUndefined();
      expect(() => assertSupportedTypeScript(mod)).not.toThrow();
    }
  });

  it("looks through an ESM-interop `default` wrapper", () => {
    const real = { version: "6.0.3", versionMajorMinor: "6.0", factory: {}, createProgram() {} };
    expect(getUnsupportedTypeScriptReason({ default: real })).toBeUndefined();
    expect(getUnsupportedTypeScriptReason({ default: ts7Shaped() })).toMatch(/7\.0\.2/);
  });

  it("accepts the TypeScript this repo is built with (default argument)", () => {
    expect(() => assertSupportedTypeScript()).not.toThrow();
    expect(() => assertSupportedTypeScript(ts)).not.toThrow();
  });
});
