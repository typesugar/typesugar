/**
 * A REAL tsserver with the BUILT typesugar plugin loaded globally, for tests
 * of behaviour that only exists there (project discovery, the plugin's
 * diagnostics as an editor receives them).
 *
 * Build first: `pnpm --filter @typesugar/transformer build`.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const pluginPath = path.join(pkgRoot, "dist", "language-service.cjs");
export const hasPluginBuild = fs.existsSync(pluginPath);
const tsserverPath = path.join(
  path.dirname(createRequire(import.meta.url).resolve("typescript")),
  "tsserver.js"
);

/**
 * Write the probe package (`<root>/probe/node_modules/typesugar-ls-probe`)
 * that loads the built plugin; returns the probe location to pass to
 * {@link TsServer}.
 */
export function writePluginProbe(root: string): string {
  const probeDir = path.join(root, "probe");
  const pkg = path.join(probeDir, "node_modules", "typesugar-ls-probe");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "typesugar-ls-probe", main: "index.js" })
  );
  fs.writeFileSync(
    path.join(pkg, "index.js"),
    `const m = require(${JSON.stringify(pluginPath)});\n` +
      `module.exports = typeof m === "function" ? m : m.default;\n`
  );
  return probeDir;
}

/** A diagnostic as tsserver's `semanticDiagnosticsSync` returns it. */
export interface ProtocolDiagnostic {
  text: string;
  code: number;
  category: string;
  start: { line: number; offset: number };
  end: { line: number; offset: number };
}

/** A tsserver session with the built plugin loaded globally. */
export class TsServer {
  private child: ChildProcessWithoutNullStreams;
  private seq = 0;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, (body: unknown) => void>();
  readonly logFile: string;

  constructor(root: string, probeDir: string) {
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

  /** The file's semantic diagnostics, once tsserver answers. */
  semanticDiagnostics(file: string): Promise<ProtocolDiagnostic[]> {
    const seq = this.send("semanticDiagnosticsSync", { file });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer for ${file}`)), 60_000);
      this.pending.set(seq, (body) => {
        clearTimeout(timer);
        resolve((body as ProtocolDiagnostic[]) ?? []);
      });
    });
  }

  /** The file's semantic diagnostics' text, once tsserver answers. */
  async diagnostics(file: string): Promise<string> {
    return (await this.semanticDiagnostics(file)).map((d) => d.text).join("\n");
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
