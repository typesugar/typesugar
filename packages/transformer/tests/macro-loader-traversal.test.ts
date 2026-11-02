/**
 * Review finding (transformer #20): the manifest-target guard rejected
 * `"../x"` but not `"./../x"` (or `"./a/../../x"`), which escape the
 * declaring package's own root just the same.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";
import { config } from "@typesugar/core";
import {
  classifyManifestPackages,
  resetLoadedPackages,
  __setRequireForTesting,
} from "../src/macro-loader.js";

function writePkg(nodeModules: string, name: string, macros: string): void {
  const dir = path.join(nodeModules, ...name.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name, version: "1.0.0", typesugar: { macros } })
  );
}

describe("macro-loader manifest target path traversal", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-macro-traversal-"));
    const nm = path.join(tmpDir, "node_modules");
    writePkg(nm, "@typesugar/dot-dotdot", "./../evil");
    writePkg(nm, "@typesugar/nested-dotdot", "./a/../../evil");
    writePkg(nm, "@typesugar/bare-dotdot", "other-pkg/../evil");
    writePkg(nm, "@typesugar/ok-nested", "./dist/macros");
    fs.writeFileSync(path.join(tmpDir, "entry.js"), "");
    __setRequireForTesting(createRequire(path.join(tmpDir, "entry.js")));
    resetLoadedPackages();
    config.reset();
  });

  afterEach(() => {
    __setRequireForTesting(undefined);
    resetLoadedPackages();
    config.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(["@typesugar/dot-dotdot", "@typesugar/nested-dotdot", "@typesugar/bare-dotdot"])(
    "rejects a manifest target that escapes the package root (%s)",
    (pkg) => {
      const { toLoad } = classifyManifestPackages([pkg]);
      expect(toLoad.has(pkg)).toBe(false);
    }
  );

  it("still accepts a nested in-package target", () => {
    const { toLoad } = classifyManifestPackages(["@typesugar/ok-nested"]);
    expect(toLoad.get("@typesugar/ok-nested")).toBe("@typesugar/ok-nested/dist/macros");
  });
});
