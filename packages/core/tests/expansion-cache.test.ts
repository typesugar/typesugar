/**
 * MacroExpansionCache persistence (deep-review core #1, #55): file-scoped
 * keys, LRU eviction on save, and atomic temp-file + rename writes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MacroExpansionCache } from "../src/cache.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ts-core-cache-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("MacroExpansionCache", () => {
  it("keys differ by scope (source file path)", () => {
    const cache = new MacroExpansionCache(dir);
    const a = cache.computeKey("m", "m(1)", ["1"], "/a.ts");
    const b = cache.computeKey("m", "m(1)", ["1"], "/b.ts");
    expect(a).not.toBe(b);
  });

  it("evicts least-recently-used entries beyond maxEntries on save", () => {
    const cache = new MacroExpansionCache(dir, { maxEntries: 2 });
    cache.set("k1", "1");
    cache.set("k2", "2");
    cache.set("k3", "3");
    // Make k1 most recent (hit refreshes timestamp)
    const entries = (cache as unknown as { entries: Map<string, { timestamp: number }> }).entries;
    entries.get("k2")!.timestamp = 1;
    entries.get("k3")!.timestamp = 2;
    expect(cache.get("k1")).toBe("1");
    cache.save();

    const reloaded = new MacroExpansionCache(dir, { maxEntries: 2 });
    expect(reloaded.size).toBe(2);
    expect(reloaded.get("k1")).toBe("1");
    expect(reloaded.get("k3")).toBe("3");
    expect(reloaded.get("k2")).toBeUndefined();
  });

  it("writes atomically and leaves no temp files behind", () => {
    const cache = new MacroExpansionCache(dir);
    cache.set("k", "v");
    cache.save();
    const files = fs.readdirSync(dir);
    expect(files).toEqual(["expansions.json"]);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "expansions.json"), "utf-8")).k.expandedText
    ).toBe("v");
  });

  it("discards entries written under the old (pre-scope) cache version", () => {
    fs.writeFileSync(
      path.join(dir, "expansions.json"),
      JSON.stringify({ old: { inputHash: "old", expandedText: "x", timestamp: 0, version: "2" } })
    );
    const cache = new MacroExpansionCache(dir);
    expect(cache.get("old")).toBeUndefined();
  });
});
