/**
 * PEP-064 through the unplugin: an imported object supplies extension
 * methods only when its import carries a JSDoc `@extension` tag, and the tag
 * on an import is not dispatched as the `@extension` attribute macro (no
 * warning, the import kept as written).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { unpluginFactory } from "../unplugin.js";

// Inside the repo so `@typesugar/macros` resolves from the root node_modules.
let dir: string;

const LOGGER = `export const log = { info(msg: unknown): string { return "info " + String(msg); } };\n`;

function transformMain(main: string): { code: string; warn: ReturnType<typeof vi.fn> } {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/logger.ts"), LOGGER);
  fs.writeFileSync(path.join(dir, "src/main.ts"), main);
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
        strict: true,
      },
      include: ["src"],
    })
  );
  const plugin = unpluginFactory({ tsconfig: path.join(dir, "tsconfig.json") }, {
    framework: "vite",
  } as never) as Record<string, any>;
  const ctx = {
    error: vi.fn((m: unknown) => {
      throw new Error(typeof m === "string" ? m : (m as { message: string }).message);
    }),
    warn: vi.fn(),
    addWatchFile: vi.fn(),
  };
  plugin.buildStart.call(ctx);
  const file = path.join(dir, "src/main.ts");
  const out = plugin.transform.call(ctx, main, file);
  const code = typeof out === "string" ? out : (out?.code ?? main);
  return { code, warn: ctx.warn };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(__dirname, "__fixture_pep064_"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("PEP-064: the @extension import tag under the unplugin", () => {
  it("a tagged import's object supplies the method, with no warning", () => {
    const { code, warn } = transformMain(`/** @extension */
import { log } from "./logger";
const user = { id: 1 };
export const r = user.info();
`);
    expect(code).toContain("log.info(user)");
    expect(code).toContain(`import { log } from "./logger"`);
    expect(warn).not.toHaveBeenCalled();
  });

  it("an untagged import's object does not", () => {
    const { code } = transformMain(`import { log } from "./logger";
const user = { id: 1 };
export const r = user.info();
`);
    expect(code).not.toContain("log.info(user)");
    expect(code).toContain("user.info()");
  });
});
