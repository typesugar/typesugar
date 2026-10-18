/**
 * Deep review 2026-10, macros-other #2 (cacheable flags) and #19 (include root).
 *
 * #2: the expression-macro cache keys on call text only, so macros whose
 * output depends on types, files, config, or that register into a live
 * registry must opt out with `cacheable: false`.
 *
 * #19: include macros checked `resolved.startsWith(root + sep)`; with a
 * program cwd of "/" (single-file transforms) that is "//" and every path was
 * rejected. The root is now the tsconfig directory / cwd, compared with
 * path.relative, falling back to the source directory.
 */

import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createMacroContext } from "@typesugar/core";
import { reflectAttribute, typeInfoMacro, fieldNamesMacro, validatorMacro } from "./reflect.js";
import {
  includeStrMacro,
  includeBytesMacro,
  includeJsonMacro,
  includeTextMacro,
} from "./include.js";
import { cfgMacro, cfgAttrMacro } from "./cfg.js";
import { configWhenMacro, configWhenAttrMacro } from "./config-when.js";
import {
  extensionAttribute,
  registerExtensionsMacro,
  registerExtensionMacro,
} from "./extension.js";

describe("#2: context-dependent macros are not cacheable", () => {
  const macros = {
    reflectAttribute,
    typeInfoMacro,
    fieldNamesMacro,
    validatorMacro,
    includeStrMacro,
    includeBytesMacro,
    includeJsonMacro,
    includeTextMacro,
    cfgMacro,
    cfgAttrMacro,
    configWhenMacro,
    configWhenAttrMacro,
    extensionAttribute,
    registerExtensionsMacro,
    registerExtensionMacro,
  };
  for (const [name, macro] of Object.entries(macros)) {
    it(`${name} has cacheable: false`, () => {
      expect((macro as { cacheable?: boolean }).cacheable).toBe(false);
    });
  }
});

describe("#19: include root", () => {
  function includeWithCwd(cwd: string, arg: string): { printed: string; error?: string } {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "include-root-")));
    fs.writeFileSync(path.join(dir, "data.txt"), "DATA");
    const filePath = path.join(dir, "main.ts");
    fs.writeFileSync(
      filePath,
      `declare function includeStr(p: string): string;\nincludeStr("${arg}");`
    );
    try {
      const options: ts.CompilerOptions = { noEmit: true };
      const host = ts.createCompilerHost(options);
      const program = ts.createProgram([filePath], options, {
        ...host,
        getCurrentDirectory: () => (cwd === "<dir>" ? dir : cwd),
      });
      const sf = program.getSourceFile(filePath)!;
      const call = (sf.statements[1] as ts.ExpressionStatement).expression as ts.CallExpression;
      let printed = "";
      let error: string | undefined;
      ts.transform(sf, [
        (tctx) => {
          const ctx = createMacroContext(program, sf, tctx);
          try {
            printed = ts
              .createPrinter()
              .printNode(
                ts.EmitHint.Expression,
                includeStrMacro.expand(ctx, call, call.arguments),
                sf
              );
          } catch (e) {
            error = (e as Error).message;
          }
          return (s) => s;
        },
      ]);
      return { printed, error };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("works when the program cwd is the filesystem root", () => {
    expect(includeWithCwd("/", "./data.txt")).toEqual({ printed: `"DATA"`, error: undefined });
  });

  it("still rejects escapes when the cwd is the filesystem root", () => {
    expect(includeWithCwd("/", "../../../../etc/hosts").error).toMatch(/outside the project root/);
  });

  it("works with a normal project cwd", () => {
    expect(includeWithCwd("<dir>", "./data.txt").printed).toBe(`"DATA"`);
  });
});
