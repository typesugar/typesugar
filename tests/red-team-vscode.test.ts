/**
 * Red Team Tests for @typesugar/vscode
 *
 * Attack surfaces:
 * - package.json VS Code extension manifest structure
 * - TextMate grammar patterns for syntax highlighting
 * - Language configuration bracket/comment handling
 * - Manifest schema and merge behavior
 * - Semantic token type/modifier configuration
 * - Command and activation event registration
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const VSCODE_PKG_PATH = path.resolve(__dirname, "../packages/vscode");

function readJson<T>(relativePath: string): T {
  const fullPath = path.join(VSCODE_PKG_PATH, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf-8")) as T;
}

describe("VSCode Extension Configuration Edge Cases", () => {
  // ==========================================================================
  // Attack 1: package.json Extension Manifest Structure
  // ==========================================================================
  describe("package.json manifest structure", () => {
    const pkg = readJson<Record<string, unknown>>("package.json");

    it("has required VS Code extension fields", () => {
      expect(pkg.name).toBe("@typesugar/vscode");
      expect(pkg.displayName).toBe("typesugar");
      expect(pkg.publisher).toBe("typesugar");
      expect(pkg.engines).toHaveProperty("vscode");
      expect(pkg.main).toBe("./dist/extension.js");
    });

    it("has valid activation events format", () => {
      const activationEvents = pkg.activationEvents as string[];
      expect(Array.isArray(activationEvents)).toBe(true);
      expect(activationEvents.length).toBeGreaterThan(0);

      for (const event of activationEvents) {
        expect(event).toMatch(/^(workspaceContains:|onLanguage:|onCommand:|onView:|onUri:|onWebviewPanel:|onCustomEditor:|onAuthenticationRequest:|onStartupFinished|\*)/);
      }
    });

    it("has valid vscode engine version constraint", () => {
      const engines = pkg.engines as Record<string, string>;
      expect(engines.vscode).toMatch(/^\^?\d+\.\d+\.\d+$/);
      const version = engines.vscode.replace("^", "");
      const [major] = version.split(".").map(Number);
      expect(major).toBeGreaterThanOrEqual(1);
    });

    it("has valid categories", () => {
      const categories = pkg.categories as string[];
      const validCategories = [
        "Programming Languages",
        "Snippets",
        "Linters",
        "Themes",
        "Debuggers",
        "Formatters",
        "Keymaps",
        "SCM Providers",
        "Other",
        "Extension Packs",
        "Language Packs",
        "Data Science",
        "Machine Learning",
        "Visualization",
        "Notebooks",
        "Education",
        "Testing",
      ];
      for (const cat of categories) {
        expect(validCategories).toContain(cat);
      }
    });
  });

  // ==========================================================================
  // Attack 2: Contributes Section Validation
  // ==========================================================================
  describe("contributes section validation", () => {
    const pkg = readJson<Record<string, unknown>>("package.json");
    const contributes = pkg.contributes as Record<string, unknown>;

    it("has valid grammar contributions", () => {
      const grammars = contributes.grammars as Array<{
        scopeName: string;
        path: string;
        injectTo?: string[];
      }>;

      expect(Array.isArray(grammars)).toBe(true);
      for (const grammar of grammars) {
        expect(grammar.scopeName).toMatch(/^[a-z]+(\.[a-z]+)+$/);
        expect(grammar.path).toMatch(/^\.\/syntaxes\/.+\.json$/);

        const grammarFile = path.join(VSCODE_PKG_PATH, grammar.path);
        expect(fs.existsSync(grammarFile)).toBe(true);

        if (grammar.injectTo) {
          for (const target of grammar.injectTo) {
            expect(target).toMatch(/^source\.(ts|tsx|js|jsx)$/);
          }
        }
      }
    });

    it("has valid command contributions", () => {
      const commands = contributes.commands as Array<{
        command: string;
        title: string;
      }>;

      expect(Array.isArray(commands)).toBe(true);
      for (const cmd of commands) {
        expect(cmd.command).toMatch(/^typesugar\.\w+$/);
        expect(cmd.title).toMatch(/^typesugar:/);
        expect(cmd.title.length).toBeGreaterThan(10);
      }
    });

    it("has valid configuration schema", () => {
      const configuration = contributes.configuration as {
        title: string;
        properties: Record<string, { type: string; default: unknown; description: string }>;
      };

      expect(configuration.title).toBe("typesugar");
      expect(configuration.properties).toBeDefined();

      for (const [key, prop] of Object.entries(configuration.properties)) {
        expect(key).toMatch(/^typesugar\.\w+$/);
        expect(["boolean", "string", "number", "array", "object"]).toContain(prop.type);
        expect(typeof prop.description).toBe("string");
        expect(prop.description.length).toBeGreaterThan(10);
      }
    });

    it("has valid semantic token types", () => {
      const tokenTypes = contributes.semanticTokenTypes as Array<{
        id: string;
        superType: string;
        description: string;
      }>;

      const validSuperTypes = [
        "comment",
        "string",
        "keyword",
        "number",
        "regexp",
        "operator",
        "namespace",
        "type",
        "struct",
        "class",
        "interface",
        "enum",
        "enumMember",
        "typeParameter",
        "function",
        "method",
        "decorator",
        "macro",
        "variable",
        "parameter",
        "property",
        "label",
        "event",
      ];

      for (const token of tokenTypes) {
        expect(token.id).toMatch(/^[a-z][a-zA-Z]+$/);
        expect(validSuperTypes).toContain(token.superType);
        expect(typeof token.description).toBe("string");
      }
    });

    it("has valid semantic token scopes mapping", () => {
      const scopes = contributes.semanticTokenScopes as Array<{
        language: string;
        scopes: Record<string, string[]>;
      }>;

      for (const scope of scopes) {
        expect(["typescript", "typescriptreact", "javascript", "javascriptreact"]).toContain(
          scope.language
        );

        for (const [tokenType, tmScopes] of Object.entries(scope.scopes)) {
          expect(Array.isArray(tmScopes)).toBe(true);
          for (const tmScope of tmScopes) {
            expect(tmScope).toMatch(/^[a-z]+(\.[a-z]+)+$/);
          }
        }
      }
    });
  });

  // ==========================================================================
  // Attack 3: TextMate Grammar Patterns
  // ==========================================================================
  describe("TextMate grammar pattern validation", () => {
    const grammar = readJson<{
      scopeName: string;
      injectionSelector: string;
      patterns: Array<{
        name?: string;
        match?: string;
        begin?: string;
        end?: string;
        captures?: Record<string, { name: string }>;
        beginCaptures?: Record<string, { name: string }>;
        endCaptures?: Record<string, { name: string }>;
        patterns?: unknown[];
      }>;
      repository?: Record<string, unknown>;
    }>("syntaxes/typesugar.tmLanguage.json");

    it("has valid scopeName format", () => {
      expect(grammar.scopeName).toMatch(/^source\.[a-z]+(\.[a-z]+)*$/);
    });

    it("has valid injection selector", () => {
      expect(grammar.injectionSelector).toMatch(/^L:source\.(ts|tsx)(,\s*L:source\.(ts|tsx))*$/);
    });

    it("has valid regex patterns (no catastrophic backtracking)", () => {
      function checkPattern(pattern: string, location: string) {
        expect(() => new RegExp(pattern)).not.toThrow();

        const dangerousPatterns = [
          /\(\.\+\)\+/, // (.+)+
          /\(\.\*\)\+/, // (.*)+
          /\(\.\+\)\*/, // (.+)*
          /\(\[^\\]\]\+\)\+/, // ([^x]+)+
        ];

        for (const dangerous of dangerousPatterns) {
          expect(dangerous.test(pattern)).toBe(false);
        }
      }

      for (const pattern of grammar.patterns) {
        if (pattern.match) {
          checkPattern(pattern.match, `pattern.match`);
        }
        if (pattern.begin) {
          checkPattern(pattern.begin, `pattern.begin`);
        }
        if (pattern.end) {
          checkPattern(pattern.end, `pattern.end`);
        }
      }
    });

    it("has valid capture group references", () => {
      for (const pattern of grammar.patterns) {
        function checkCaptures(
          regex: string | undefined,
          captures: Record<string, { name: string }> | undefined,
          type: string
        ) {
          if (!regex || !captures) return;

          const maxGroupInRegex = (regex.match(/\(/g) || []).length;

          for (const groupNum of Object.keys(captures)) {
            const num = parseInt(groupNum, 10);
            expect(num).toBeLessThanOrEqual(maxGroupInRegex);
          }
        }

        checkCaptures(pattern.match, pattern.captures, "captures");
        checkCaptures(pattern.begin, pattern.beginCaptures, "beginCaptures");
        checkCaptures(pattern.end, pattern.endCaptures, "endCaptures");
      }
    });

    it("has valid scope names in captures", () => {
      function checkScopeName(name: string) {
        expect(name).toMatch(/^[a-z]+(\.[a-z]+)+(\.[a-z]+)?$/);
      }

      function extractScopeNames(pattern: {
        name?: string;
        captures?: Record<string, { name: string }>;
        beginCaptures?: Record<string, { name: string }>;
        endCaptures?: Record<string, { name: string }>;
      }) {
        if (pattern.name) checkScopeName(pattern.name);
        for (const captures of [pattern.captures, pattern.beginCaptures, pattern.endCaptures]) {
          if (captures) {
            for (const cap of Object.values(captures)) {
              checkScopeName(cap.name);
            }
          }
        }
      }

      for (const pattern of grammar.patterns) {
        extractScopeNames(pattern);
      }
    });
  });

  // ==========================================================================
  // Attack 4: Language Configuration
  // ==========================================================================
  describe("language configuration validation", () => {
    const langConfig = readJson<{
      comments?: {
        lineComment?: string;
        blockComment?: [string, string];
      };
      brackets?: Array<[string, string]>;
      autoClosingPairs?: Array<{
        open: string;
        close: string;
        notIn?: string[];
      }>;
      surroundingPairs?: Array<[string, string]>;
    }>("language-configuration.json");

    it("has valid comment configuration", () => {
      if (langConfig.comments) {
        if (langConfig.comments.lineComment) {
          expect(typeof langConfig.comments.lineComment).toBe("string");
          expect(langConfig.comments.lineComment.length).toBeGreaterThan(0);
        }
        if (langConfig.comments.blockComment) {
          expect(Array.isArray(langConfig.comments.blockComment)).toBe(true);
          expect(langConfig.comments.blockComment).toHaveLength(2);
          expect(langConfig.comments.blockComment[0]).not.toBe(langConfig.comments.blockComment[1]);
        }
      }
    });

    it("has valid bracket pairs (no duplicates, proper pairing)", () => {
      if (langConfig.brackets) {
        const seen = new Set<string>();
        for (const [open, close] of langConfig.brackets) {
          expect(open).not.toBe(close);
          expect(seen.has(open)).toBe(false);
          seen.add(open);
        }
      }
    });

    it("has valid auto-closing pairs", () => {
      if (langConfig.autoClosingPairs) {
        for (const pair of langConfig.autoClosingPairs) {
          expect(typeof pair.open).toBe("string");
          expect(typeof pair.close).toBe("string");
          expect(pair.open.length).toBeGreaterThan(0);
          expect(pair.close.length).toBeGreaterThan(0);

          if (pair.notIn) {
            const validContexts = ["string", "comment", "regex"];
            for (const ctx of pair.notIn) {
              expect(validContexts).toContain(ctx);
            }
          }
        }
      }
    });

    it("bracket pairs are symmetric with auto-closing pairs", () => {
      if (langConfig.brackets && langConfig.autoClosingPairs) {
        for (const [open, close] of langConfig.brackets) {
          const hasAutoClose = langConfig.autoClosingPairs.some(
            (p) => p.open === open && p.close === close
          );
          expect(hasAutoClose).toBe(true);
        }
      }
    });
  });

  // ==========================================================================
  // Attack 5: Units Grammar Edge Cases
  // ==========================================================================
  describe("units grammar edge cases", () => {
    const unitsGrammar = readJson<{
      scopeName: string;
      patterns: Array<{
        match?: string;
        begin?: string;
        patterns?: Array<{ match?: string }>;
      }>;
    }>("syntaxes/typesugar-units.tmLanguage.json");

    it("handles negative numbers in units", () => {
      const numberPattern = unitsGrammar.patterns[0]?.patterns?.find(
        (p) => p.match?.includes("-?\\d+")
      );
      expect(numberPattern).toBeDefined();

      const regex = new RegExp(numberPattern!.match!);
      expect(regex.test("-42.5 meters")).toBe(true);
      expect(regex.test("0.001 kg")).toBe(true);
    });

    it("handles compound units (e.g., km/h, m/s)", () => {
      const unitPattern = unitsGrammar.patterns[0]?.patterns?.find((p) =>
        p.match?.includes("km/h")
      );
      expect(unitPattern).toBeDefined();

      const regex = new RegExp(unitPattern!.match!);
      expect(regex.test("km/h")).toBe(true);
      expect(regex.test("m/s")).toBe(true);
      expect(regex.test("mph")).toBe(true);
    });

    it("has complete unit coverage for SI base units", () => {
      const unitPattern = unitsGrammar.patterns[0]?.patterns?.find((p) =>
        p.match?.includes("\\b(m|meter")
      );
      expect(unitPattern).toBeDefined();

      const siBaseUnits = ["m", "kg", "s", "A", "K", "mol", "cd"];
      const regex = new RegExp(unitPattern!.match!);

      for (const unit of siBaseUnits) {
        expect(regex.test(unit)).toBe(true);
      }
    });

    it("does not match invalid unit strings", () => {
      const unitPattern = unitsGrammar.patterns[0]?.patterns?.find((p) =>
        p.match?.includes("\\b(m|meter")
      );
      const regex = new RegExp(unitPattern!.match!);

      expect(regex.test("xyz")).toBe(false);
      expect(regex.test("foobar")).toBe(false);
    });
  });

  // ==========================================================================
  // Attack 6: TypeScript Plugin Configuration
  // ==========================================================================
  describe("TypeScript plugin configuration", () => {
    const pkg = readJson<{
      contributes: {
        typescriptServerPlugins?: Array<{
          name: string;
          enableForWorkspaceTypeScriptVersions?: boolean;
        }>;
      };
    }>("package.json");

    it("has valid TypeScript server plugin configuration", () => {
      const plugins = pkg.contributes.typescriptServerPlugins;
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins!.length).toBeGreaterThan(0);

      for (const plugin of plugins!) {
        expect(plugin.name).toMatch(/^@?[\w-]+(\/[\w-]+)?$/);
        expect(typeof plugin.enableForWorkspaceTypeScriptVersions).toBe("boolean");
      }
    });

    it("references a valid package as TS plugin", () => {
      const plugins = pkg.contributes.typescriptServerPlugins!;

      for (const plugin of plugins) {
        expect(plugin.name).toBe("@typesugar/ts-plugin");
      }
    });
  });

  // ==========================================================================
  // Attack 7: Color Configuration Validation
  // ==========================================================================
  describe("semantic token color configuration", () => {
    const pkg = readJson<{
      contributes: {
        configurationDefaults?: {
          "editor.semanticTokenColorCustomizations"?: {
            rules: Record<
              string,
              {
                foreground?: string;
                bold?: boolean;
                italic?: boolean;
                fontStyle?: string;
              }
            >;
          };
        };
      };
    }>("package.json");

    it("has valid color hex codes", () => {
      const rules =
        pkg.contributes.configurationDefaults?.["editor.semanticTokenColorCustomizations"]?.rules;
      expect(rules).toBeDefined();

      for (const [tokenType, style] of Object.entries(rules!)) {
        if (style.foreground) {
          expect(style.foreground).toMatch(/^#[0-9A-Fa-f]{6}$/);
        }
      }
    });

    it("color rules reference declared semantic token types", () => {
      const pkg2 = readJson<{
        contributes: {
          semanticTokenTypes: Array<{ id: string }>;
          configurationDefaults?: {
            "editor.semanticTokenColorCustomizations"?: {
              rules: Record<string, unknown>;
            };
          };
        };
      }>("package.json");

      const declaredTypes = new Set(pkg2.contributes.semanticTokenTypes.map((t) => t.id));
      const rules =
        pkg2.contributes.configurationDefaults?.["editor.semanticTokenColorCustomizations"]?.rules;

      for (const tokenType of Object.keys(rules ?? {})) {
        expect(declaredTypes.has(tokenType)).toBe(true);
      }
    });
  });
});
