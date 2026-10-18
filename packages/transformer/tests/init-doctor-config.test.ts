/**
 * Deep review, transformer findings #11, #19, #20 (init/doctor).
 *
 * #11: init wrote the tsserver plugin name "typesugar/language-service",
 *      which no package exports -> the IDE plugin silently never loaded.
 * #19: doctor JSON.parse'd tsconfig (fails on JSONC, ignores `extends`),
 *      skipped the registration check (bare `require` in ESM), never ran
 *      the transformer in its "macro expansion test", and failed ts-patch
 *      checks for bundler-only (unplugin) users.
 * #20: init installed runtime packages (e.g. `typesugar`) as devDependencies.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  patchTsConfig,
  getInstallCommands,
  LANGUAGE_SERVICE_PLUGIN_NAME,
  LEGACY_BROKEN_LANGUAGE_SERVICE_PLUGIN_NAME,
} from "../src/init.js";
import {
  checkTransformerPlugin,
  checkLanguageServicePlugin,
  checkTsPatch,
  checkTsPatchActive,
  checkMacroRegistration,
  tryMacroExpansion,
} from "../src/doctor.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-init-doctor-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function linkWorkspaceModules(): void {
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(dir, "node_modules"), "dir");
}

describe("typesugar init", () => {
  it("writes a language-service plugin name that actually resolves", () => {
    linkWorkspaceModules();
    expect(patchTsConfig(dir)).toBe(true);
    const tsconfig = JSON.parse(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf-8"));
    const names = tsconfig.compilerOptions.plugins.map((p: { name?: string }) => p.name);
    expect(names).toContain(LANGUAGE_SERVICE_PLUGIN_NAME);
    expect(names).not.toContain(LEGACY_BROKEN_LANGUAGE_SERVICE_PLUGIN_NAME);

    const req = createRequire(path.join(dir, "package.json"));
    expect(() => req.resolve(LANGUAGE_SERVICE_PLUGIN_NAME)).not.toThrow();
    // ...and the old name really was broken.
    expect(() => req.resolve(LEGACY_BROKEN_LANGUAGE_SERVICE_PLUGIN_NAME)).toThrow();
  });

  it("patches a JSONC tsconfig and repairs the legacy broken plugin name", () => {
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      `{
  // a comment
  "compilerOptions": {
    "strict": true,
    "plugins": [{ "name": "typesugar/language-service" }],
  },
}`
    );
    expect(patchTsConfig(dir)).toBe(true);
    const tsconfig = JSON.parse(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf-8"));
    const plugins = tsconfig.compilerOptions.plugins as Array<{
      name?: string;
      transform?: string;
    }>;
    expect(plugins.map((p) => p.name).filter(Boolean)).toEqual([LANGUAGE_SERVICE_PLUGIN_NAME]);
    expect(plugins.some((p) => p.transform === "@typesugar/transformer")).toBe(true);
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("installs runtime packages as dependencies and tooling as devDependencies", () => {
    const cmds = getInstallCommands("npm", {
      runtime: ["typesugar", "@typesugar/derive"],
      dev: ["@typesugar/transformer", "ts-patch"],
    });
    expect(cmds).toEqual([
      "npm install typesugar @typesugar/derive",
      "npm install --save-dev @typesugar/transformer ts-patch",
    ]);
    expect(getInstallCommands("pnpm", { runtime: [], dev: ["ts-patch"] })).toEqual([
      "pnpm add -D ts-patch",
    ]);
  });
});

describe("typesugar doctor", () => {
  it("reads JSONC tsconfig and follows extends", () => {
    fs.writeFileSync(
      path.join(dir, "base.json"),
      JSON.stringify({
        compilerOptions: {
          plugins: [
            { name: LANGUAGE_SERVICE_PLUGIN_NAME },
            { transform: "@typesugar/transformer", type: "program" },
          ],
        },
      })
    );
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      `{\n  // inherits plugins\n  "extends": "./base.json",\n  "compilerOptions": { "strict": true, },\n}\n`
    );
    expect(checkTransformerPlugin(dir).status).toBe("pass");
    expect(checkLanguageServicePlugin(dir).status).toBe("pass");
  });

  it("flags the legacy broken language-service plugin name", () => {
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { plugins: [{ name: "typesugar/language-service" }] } })
    );
    const check = checkLanguageServicePlugin(dir);
    expect(check.status).toBe("fail");
    expect(check.fix).toContain(LANGUAGE_SERVICE_PLUGIN_NAME);
  });

  it("does not fail ts-patch checks for bundler-only (unplugin) users", () => {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ devDependencies: { vite: "^5", "unplugin-typesugar": "^0.1" } })
    );
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
    fs.mkdirSync(path.join(dir, "node_modules", "typescript", "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "typescript", "lib", "typescript.js"), "");
    expect(checkTsPatch(dir).status).not.toBe("fail");
    expect(checkTsPatchActive(dir).status).not.toBe("fail");
    expect(checkTransformerPlugin(dir).status).not.toBe("fail");
  });

  it("macro registration check actually loads the project's macros", () => {
    linkWorkspaceModules();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
    const check = checkMacroRegistration(dir);
    expect(check.status, check.message).toBe("pass");
  });

  it("macro expansion test really runs the transformer", () => {
    linkWorkspaceModules();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
        },
      })
    );
    const check = tryMacroExpansion(dir, false);
    expect(check.status, check.message).toBe("pass");
    expect(check.message).toContain("42");
  });
});
