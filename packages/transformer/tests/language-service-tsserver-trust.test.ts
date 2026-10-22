/**
 * The editor never treats a dependency as the project (SECURITY.md; review 8),
 * driven through a REAL tsserver with the BUILT plugin, because the bug only
 * exists there: tsserver gives a file inside `node_modules/evil` the project
 * `node_modules/evil/tsconfig.json`, the global plugin attached to it, and
 * the pipeline it built loaded config from `node_modules/evil`:
 *
 * - evil's `typesugar.config.cjs` ran in the editor's process;
 * - evil's package.json `typesugar.security` block approved evil's macros,
 *   and config was one per process, so the approval then applied to the
 *   user's own project too.
 *
 * Also: two of the user's own projects with different configs, served by one
 * tsserver, each keep their own.
 *
 * Build first: `pnpm --filter @typesugar/transformer build`.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = path.join(pkgRoot, "dist", "language-service.cjs");
const hasBuild = fs.existsSync(pluginPath);
const tsserverPath = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript")),
  "tsserver.js"
);

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  },
  include: ["src"],
};

let root: string;

function write(rel: string, content: string | object): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return file;
}

/** Every marker file named `name` under the fixture root, relative to it. */
function markers(name: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) walk(p);
      else if (e.name === name) out.push(path.relative(root, p));
    }
  };
  walk(root);
  return out.sort();
}

/** A macros entry that writes the marker `name` next to itself when it runs. */
const markerJs = (name: string) =>
  `require("fs").writeFileSync(require("path").join(__dirname, ${JSON.stringify(name)}), "ran");\n` +
  `module.exports = { __typesugar_macros__: [] };\n`;

/** A dependency at `<project>/node_modules/<name>` with a macros manifest and its own tsconfig. */
function dependency(project: string, name: string, macros: string, extra: object = {}): void {
  const dir = `${project}/node_modules/${name}`;
  write(`${dir}/package.json`, {
    name,
    version: "1.0.0",
    types: "src/index.ts",
    main: "src/index.ts",
    typesugar: { macros: "./macros.cjs", ...extra },
  });
  write(`${dir}/tsconfig.json`, TSCONFIG);
  write(`${dir}/src/index.ts`, `export function hello(): void {}\n`);
  write(`${dir}/macros.cjs`, macros);
}

/** A tsserver session with the built plugin loaded globally. */
class TsServer {
  private child: ChildProcessWithoutNullStreams;
  private seq = 0;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, (body: unknown) => void>();
  readonly logFile: string;

  constructor(probeDir: string) {
    this.logFile = path.join(root, "tsserver.log");
    this.child = spawn(
      process.execPath,
      [
        "--max-old-space-size=1024",
        tsserverPath,
        "--globalPlugins",
        "typesugar-ls-probe",
        "--pluginProbeLocations",
        probeDir,
        "--logVerbosity",
        "normal",
        "--logFile",
        this.logFile,
        "--disableAutomaticTypingAcquisition",
      ],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"] }
    );
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr.on("data", () => {});
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const header = this.buffer.indexOf("\r\n\r\n");
      if (header < 0) return;
      const length = Number(
        /Content-Length: (\d+)/.exec(this.buffer.subarray(0, header).toString())?.[1]
      );
      const start = header + 4;
      if (this.buffer.length < start + length) return;
      const message = JSON.parse(this.buffer.subarray(start, start + length).toString()) as {
        type: string;
        request_seq?: number;
        body?: unknown;
      };
      this.buffer = this.buffer.subarray(start + length);
      if (message.type === "response" && message.request_seq !== undefined) {
        this.pending.get(message.request_seq)?.(message.body);
        this.pending.delete(message.request_seq);
      }
    }
  }

  private send(command: string, args: object): number {
    const seq = ++this.seq;
    this.child.stdin.write(
      JSON.stringify({ seq, type: "request", command, arguments: args }) + "\n"
    );
    return seq;
  }

  open(file: string): void {
    this.send("open", { file });
  }

  change(file: string, insertString: string): void {
    this.send("change", { file, line: 1, offset: 1, endLine: 1, endOffset: 1, insertString });
  }

  /** The file's semantic diagnostics' text, once tsserver answers. */
  diagnostics(file: string): Promise<string> {
    const seq = this.send("semanticDiagnosticsSync", { file });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer for ${file}`)), 60_000);
      this.pending.set(seq, (body) => {
        clearTimeout(timer);
        resolve(((body as Array<{ text: string }>) ?? []).map((d) => d.text).join("\n"));
      });
    });
  }

  async exit(): Promise<void> {
    const closed = new Promise((resolve) => this.child.on("close", resolve));
    this.send("exit", {});
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 5_000);
    await closed;
    clearTimeout(timer);
  }

  log(): string {
    return fs.existsSync(this.logFile) ? fs.readFileSync(this.logFile, "utf-8") : "";
  }
}

describe.skipIf(!hasBuild)("tsserver: a dependency is never the project (review 8)", () => {
  let probeDir: string;

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "typesugar-tss-trust-")));
    // The config walk stops at the repository root.
    fs.mkdirSync(path.join(root, ".git"));
    probeDir = path.join(root, "probe");
    write("probe/node_modules/typesugar-ls-probe/package.json", {
      name: "typesugar-ls-probe",
      main: "index.js",
    });
    write(
      "probe/node_modules/typesugar-ls-probe/index.js",
      `const m = require(${JSON.stringify(pluginPath)});\n` +
        `module.exports = typeof m === "function" ? m : m.default;\n`
    );
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("opening a dependency's file runs none of its config, and its approval never applies", async () => {
    write("app/package.json", { name: "app", private: true });
    write("app/tsconfig.json", TSCONFIG);
    const app = write(
      "app/src/app.ts",
      `import { hello } from "evil-cfg";\nimport { hello as h2 } from "evil-pkg";\nhello();\nh2();\n`
    );
    // v2: a typesugar.config.cjs (code) in the dependency.
    dependency("app", "evil-cfg", markerJs("PWNED_MACROS"));
    write(
      "app/node_modules/evil-cfg/typesugar.config.cjs",
      markerJs("PWNED_CONFIG") +
        `module.exports = { security: { allowedMacroPackages: ["evil-cfg", "evil-pkg"] } };\n`
    );
    // v3: a package.json `typesugar.security` block approving itself.
    dependency("app", "evil-pkg", markerJs("PWNED_MACROS"), {
      security: { allowedMacroPackages: ["evil-pkg"] },
    });

    const server = new TsServer(probeDir);
    try {
      server.open(app);
      const before = await server.diagnostics(app);
      expect(before).toContain("evil-pkg");
      for (const dep of ["evil-cfg", "evil-pkg"]) {
        const file = path.join(root, `app/node_modules/${dep}/src/index.ts`);
        server.open(file);
        await server.diagnostics(file);
      }
      server.change(app, " ");
      const after = await server.diagnostics(app);
      // Still refused: nothing the dependencies said approved them.
      expect(after).toMatch(/not been approved[\s\S]*evil-pkg/);
      expect(markers("PWNED_CONFIG")).toEqual([]);
      expect(markers("PWNED_MACROS")).toEqual([]);
    } finally {
      await server.exit();
    }
    // The dependency projects existed, and the plugin stood down for them.
    expect(server.log()).toMatch(/Skipping typesugar plugin for a project inside node_modules/);
  }, 120_000);

  it("two of the user's projects with different configs each keep their own", async () => {
    for (const name of ["a", "b"]) {
      write(`${name}/package.json`, { name, private: true });
      write(`${name}/tsconfig.json`, TSCONFIG);
      write(`${name}/src/use.ts`, `import { hello } from "acme-dep";\nhello();\n`);
      dependency(name, "acme-dep", markerJs("RAN"));
    }
    write("a/.typesugarrc.json", { security: { allowedMacroPackages: ["acme-dep"] } });
    write("b/.typesugarrc.json", { contracts: { mode: "none" } });
    const a = path.join(root, "a/src/use.ts");
    const b = path.join(root, "b/src/use.ts");

    const server = new TsServer(probeDir);
    try {
      server.open(b);
      expect(await server.diagnostics(b)).toContain("acme-dep");
      server.open(a);
      expect(await server.diagnostics(a)).not.toContain("acme-dep");
      expect(markers("RAN")).toEqual(["a/node_modules/acme-dep/RAN"]);
      // a's project loaded its config last; b still refuses acme-dep.
      server.change(b, " ");
      expect(await server.diagnostics(b)).toMatch(/not been approved[\s\S]*acme-dep/);
      expect(markers("RAN")).toEqual(["a/node_modules/acme-dep/RAN"]);
    } finally {
      await server.exit();
    }
  }, 120_000);
});
