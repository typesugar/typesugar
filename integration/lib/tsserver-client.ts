/**
 * tsserver stdio client for the editor integration tests.
 *
 * Spawns TypeScript's own `tsserver.js`, the process every tsserver-based
 * editor runs (VS Code, and typescript-language-server / vtsls underneath
 * Neovim, Zed, Sublime, Helix and Emacs), so the tests exercise the typesugar
 * plugin exactly as an editor loads it: from the project's `tsconfig.json`.
 *
 * Protocol: requests go in as one JSON object per line; responses and events
 * come out framed as `Content-Length: N\r\n\r\n<body>`, where N counts UTF-8
 * BYTES. The buffer is therefore kept as bytes and sliced by byte length: a
 * decoded string overshoots by one character per extra byte of any non-ASCII
 * text (an em dash in a diagnostic, say) and breaks the next frame.
 */

import { spawn, type ChildProcess } from "child_process";

export interface TsServerResponse<T = unknown> {
  seq: number;
  type: "response";
  command: string;
  request_seq: number;
  success: boolean;
  message?: string;
  body?: T;
}

export interface TsServerEvent<T = unknown> {
  seq: number;
  type: "event";
  event: string;
  body?: T;
}

export interface TsServerClientOptions {
  /** Absolute path to `typescript/lib/tsserver.js`. */
  tsserverPath: string;
  /** Working directory for the server process. */
  cwd: string;
  /** Directories whose `node_modules` tsserver searches for tsconfig plugins. */
  pluginProbeLocations?: string[];
  /** tsserver log file (verbose); useful when a test fails. */
  logFile?: string;
  /** Extra environment for the server process. */
  env?: Record<string, string>;
}

export class TsServerClient {
  private server: ChildProcess;
  private seq = 0;
  private buffer: Buffer = Buffer.alloc(0);
  private pending = new Map<
    number,
    { resolve: (r: TsServerResponse) => void; reject: (e: Error) => void }
  >();
  private events: TsServerEvent[] = [];
  private eventWaiters: Array<() => void> = [];
  private exited = false;
  private stderr = "";

  constructor(options: TsServerClientOptions) {
    const args = [options.tsserverPath, "--disableAutomaticTypingAcquisition", "--locale", "en"];
    if (options.pluginProbeLocations?.length) {
      args.push("--pluginProbeLocations", options.pluginProbeLocations.join(","));
    }
    if (options.logFile) {
      args.push("--logVerbosity", "verbose", "--logFile", options.logFile);
    }

    this.server = spawn(process.execPath, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "", ...options.env },
    });

    this.server.stdout!.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processBuffer();
    });
    this.server.stderr!.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
    });
    this.server.on("exit", (code) => {
      this.exited = true;
      const err = new Error(`tsserver exited (code ${code}). stderr:\n${this.stderr}`);
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    });
  }

  private processBuffer(): void {
    while (true) {
      const headerStart = this.buffer.indexOf("Content-Length:");
      if (headerStart === -1) return;
      const headerEnd = this.buffer.indexOf("\r\n\r\n", headerStart);
      if (headerEnd === -1) return;

      const header = this.buffer.subarray(headerStart, headerEnd).toString("ascii");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;

      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      this.dispatch(JSON.parse(body));
    }
  }

  private dispatch(msg: TsServerResponse | TsServerEvent): void {
    if (msg.type === "response") {
      const waiter = this.pending.get(msg.request_seq);
      if (waiter) {
        this.pending.delete(msg.request_seq);
        waiter.resolve(msg);
      }
    } else if (msg.type === "event") {
      this.events.push(msg);
      const waiters = this.eventWaiters;
      this.eventWaiters = [];
      for (const w of waiters) w();
    }
  }

  private write(command: string, args?: unknown): number {
    if (this.exited) throw new Error(`tsserver has exited. stderr:\n${this.stderr}`);
    const seq = ++this.seq;
    this.server.stdin!.write(
      JSON.stringify({ seq, type: "request", command, arguments: args }) + "\n"
    );
    return seq;
  }

  /**
   * Send a request and wait for its response body. Rejects when tsserver
   * reports `success: false` (an exception in tsserver or in the plugin).
   */
  async request<T = unknown>(command: string, args?: unknown, timeout = 30000): Promise<T> {
    const response = await this.requestRaw<T>(command, args, timeout);
    if (!response.success) {
      throw new Error(`tsserver "${command}" failed: ${response.message}`);
    }
    return response.body as T;
  }

  /** Send a request and return the whole response, success or not. */
  requestRaw<T = unknown>(
    command: string,
    args?: unknown,
    timeout = 30000
  ): Promise<TsServerResponse<T>> {
    return new Promise((resolve, reject) => {
      const seq = this.write(command, args);
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`Timeout waiting for tsserver "${command}" (seq=${seq})`));
      }, timeout);
      this.pending.set(seq, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r as TsServerResponse<T>);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  /** Send a command tsserver doesn't answer (`open`, `change`, `geterr`). */
  notify(command: string, args?: unknown): number {
    return this.write(command, args);
  }

  /** Wait for (and consume) the first event matching `event` and `predicate`. */
  async waitForEvent<T = unknown>(
    event: string,
    predicate: (body: T) => boolean = () => true,
    timeout = 30000
  ): Promise<T> {
    const deadline = Date.now() + timeout;
    while (true) {
      const idx = this.events.findIndex((e) => e.event === event && predicate(e.body as T));
      if (idx !== -1) {
        const [found] = this.events.splice(idx, 1);
        return found.body as T;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`Timeout waiting for tsserver event "${event}"`);
      if (this.exited) throw new Error(`tsserver has exited. stderr:\n${this.stderr}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.eventWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  clearEvents(): void {
    this.events = [];
  }

  async dispose(): Promise<void> {
    if (!this.exited) {
      try {
        this.notify("exit");
      } catch {
        // already gone
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.server.kill();
          resolve();
        }, 2000);
        this.server.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}
