/**
 * Review finding tooling #20: every `exports` map pointed the `require`
 * condition at the ESM declaration file (`.d.ts` in a `"type": "module"`
 * package). TypeScript then treats the CJS entry's types as ESM and a CJS
 * consumer on `module: node16` gets TS1479 ("The current file is a CommonJS
 * module whose imports will produce 'require' calls; however, the referenced
 * file is an ECMAScript module…"). tsup emits a `.d.cts` beside every `.cjs`;
 * the `require` branch must use it.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";

const ROOT = path.resolve(__dirname, "..");
const PACKAGES = path.join(ROOT, "packages");

/**
 * Packages whose declarations are emitted by plain `tsc` (no `.d.cts`), so
 * their `require` branch can't point at CJS types yet. Each needs a build
 * step that emits `.d.cts` before it can be removed from this list.
 */
const NO_DCTS_YET = new Set<string>([]);

interface Pkg {
  dir: string;
  json: any;
}

function loadPackages(): Pkg[] {
  return fs
    .readdirSync(PACKAGES)
    .map((d) => path.join(PACKAGES, d))
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
    .map((dir) => ({
      dir,
      json: JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")),
    }));
}

describe("package.json exports: require condition uses CJS declarations", () => {
  const pkgs = loadPackages().filter(
    (p) => p.json.type === "module" && p.json.exports && !NO_DCTS_YET.has(p.json.name)
  );

  it.each(pkgs.map((p) => [p.json.name, p] as const))("%s", (_name, pkg) => {
    const problems: string[] = [];
    for (const [subpath, entry] of Object.entries<any>(pkg.json.exports)) {
      if (!entry || typeof entry !== "object" || !("require" in entry)) continue;
      const req = entry.require;
      if (
        typeof req !== "object" ||
        typeof req.types !== "string" ||
        typeof req.default !== "string"
      ) {
        problems.push(`${subpath}: require must be { types, default }, got ${JSON.stringify(req)}`);
        continue;
      }
      if (!req.types.endsWith(".d.cts")) problems.push(`${subpath}: require.types ${req.types}`);
      if (!req.default.endsWith(".cjs"))
        problems.push(`${subpath}: require.default ${req.default}`);
      if (
        entry.import &&
        typeof entry.import === "object" &&
        !entry.import.types?.endsWith(".d.ts")
      ) {
        problems.push(`${subpath}: import.types ${entry.import.types}`);
      }
      // When the package is built, the declared files must actually exist.
      if (fs.existsSync(path.join(pkg.dir, "dist")) && !req.types.includes("*")) {
        for (const f of [req.types, req.default]) {
          if (!fs.existsSync(path.join(pkg.dir, f))) problems.push(`${subpath}: missing ${f}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("node16 consumers type-check against the published shape", () => {
  it.each(["commonjs", "module"] as const)("%s consumer: no TS1479 / TS2307", (type) => {
    const names = ["core", "typeclass", "std", "macros", "transformer"];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-node16-consumer-"));
    try {
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ type }));
      fs.mkdirSync(path.join(tmp, "node_modules", "@typesugar"), { recursive: true });
      const lines: string[] = [];
      names.forEach((n, i) => {
        fs.symlinkSync(
          path.join(PACKAGES, n),
          path.join(tmp, "node_modules", "@typesugar", n),
          "dir"
        );
        lines.push(
          `import * as m${i} from "@typesugar/${n}";`,
          `export const k${i} = Object.keys(m${i});`
        );
      });
      const file = path.join(tmp, "a.ts");
      fs.writeFileSync(file, lines.join("\n") + "\n");
      const program = ts.createProgram([file], {
        module: ts.ModuleKind.Node16,
        moduleResolution: ts.ModuleResolutionKind.Node16,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      });
      const diags = ts
        .getPreEmitDiagnostics(program, program.getSourceFile(file))
        .map(
          (d) =>
            `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n").split("\n")[0]}`
        );
      expect(diags.filter((d) => d.startsWith("TS1479") || d.startsWith("TS2307"))).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
