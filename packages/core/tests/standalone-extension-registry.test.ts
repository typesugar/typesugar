/**
 * The standalone-extension registry is keyed by declaring file (review core
 * #18 root): lookups prefer the asking file's own entries, and re-transforming
 * a file drops its stale entries.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  standaloneExtensionRegistry,
  registerStandaloneExtensionEntry,
  findStandaloneExtension,
  findStandaloneExtensions,
  withStandaloneExtensionFile,
} from "../src/index.js";

beforeEach(() => {
  standaloneExtensionRegistry.length = 0;
});

describe("standalone extension registry scoping", () => {
  it("records the file whose pass registered an entry", () => {
    withStandaloneExtensionFile("/p/a.ts", () =>
      registerStandaloneExtensionEntry({ methodName: "clamp", forType: "number" })
    );
    registerStandaloneExtensionEntry({ methodName: "clamp", forType: "number" });
    expect(standaloneExtensionRegistry.map((e) => e.declaringFile)).toEqual(["/p/a.ts", undefined]);
  });

  it("orders lookups: own file, then process-wide, then other files", () => {
    withStandaloneExtensionFile("/p/other.ts", () =>
      registerStandaloneExtensionEntry({ methodName: "m", forType: "T", qualifier: "O" })
    );
    registerStandaloneExtensionEntry({ methodName: "m", forType: "T", qualifier: "G" });
    withStandaloneExtensionFile("/p/me.ts", () =>
      registerStandaloneExtensionEntry({ methodName: "m", forType: "T", qualifier: "M" })
    );
    expect(findStandaloneExtensions("m", "T", "/p/me.ts").map((e) => e.qualifier)).toEqual([
      "M",
      "G",
      "O",
    ]);
    expect(findStandaloneExtension("m", "T", "/p/me.ts")?.qualifier).toBe("M");
  });

  it("re-transforming a file drops the entries its previous pass registered", () => {
    withStandaloneExtensionFile("/p/a.ts", () =>
      registerStandaloneExtensionEntry({ methodName: "old", forType: "number" })
    );
    // The @extension was renamed: the new pass registers only `renamed`.
    withStandaloneExtensionFile("/p/a.ts", () =>
      registerStandaloneExtensionEntry({ methodName: "renamed", forType: "number" })
    );
    expect(findStandaloneExtension("old", "number")).toBeUndefined();
    expect(findStandaloneExtension("renamed", "number")?.declaringFile).toBe("/p/a.ts");
  });
});
