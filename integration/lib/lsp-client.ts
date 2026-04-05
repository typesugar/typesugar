/**
 * LSP stdio client for integration testing.
 *
 * Extracted from packages/lsp-server/tests/lsp-integration.test.ts.
 * Spawns a typesugar-lsp server and provides typed helpers for
 * sending requests and collecting notifications.
 */

import { spawn, type ChildProcess } from "child_process";
import * as path from "path";

export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number;
  code?: number | string;
  source?: string;
  message: string;
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  data?: unknown;
}

export interface LspHover {
  contents: { kind?: string; value: string } | string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface LspLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export class LspClient {
  private server: ChildProcess;
  private msgId = 0;
  private buf = "";
  private responses = new Map<number, unknown>();
  private notifications: Array<{ method: string; params: unknown }> = [];
  private ready: Promise<void>;
  private resolveReady!: () => void;

  constructor(serverPath: string, args: string[] = ["--stdio"]) {
    this.server = spawn("node", [serverPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.ready = new Promise((r) => {
      this.resolveReady = r;
    });

    this.server.stdout!.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString();
      this.parseMessages();
    });

    this.server.stderr!.on("data", () => {});

    setTimeout(() => this.resolveReady(), 100);
  }

  private parseMessages() {
    while (true) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const headerStr = this.buf.slice(0, headerEnd);
      const lenMatch = headerStr.match(/Content-Length: (\d+)/);
      if (!lenMatch) break;
      const len = parseInt(lenMatch[1]);
      const bodyStart = headerEnd + 4;
      if (this.buf.length < bodyStart + len) break;
      const body = JSON.parse(this.buf.slice(bodyStart, bodyStart + len));
      this.buf = this.buf.slice(bodyStart + len);

      if (body.id !== undefined && !body.method) {
        this.responses.set(body.id, body);
      } else if (body.method) {
        this.notifications.push({ method: body.method, params: body.params });
      }
    }
  }

  private send(msg: object) {
    const json = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
    this.server.stdin!.write(header + json);
  }

  async request<T = unknown>(method: string, params: unknown, timeout = 15000): Promise<T> {
    await this.ready;
    const id = ++this.msgId;
    this.send({ jsonrpc: "2.0", id, method, params });

    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.responses.has(id)) {
        const resp = this.responses.get(id) as { result?: T; error?: unknown };
        this.responses.delete(id);
        if (resp.error) throw new Error(JSON.stringify(resp.error));
        return resp.result as T;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Timeout waiting for response to ${method} (id=${id})`);
  }

  async notify(method: string, params: unknown): Promise<void> {
    await this.ready;
    this.send({ jsonrpc: "2.0", method, params });
  }

  async waitForNotification<T = unknown>(
    method: string,
    predicate?: (params: unknown) => boolean,
    timeout = 15000
  ): Promise<T | null> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const idx = this.notifications.findIndex(
        (n) => n.method === method && (!predicate || predicate(n.params))
      );
      if (idx !== -1) {
        const notif = this.notifications[idx];
        this.notifications.splice(idx, 1);
        return notif.params as T;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return null;
  }

  clearNotifications() {
    this.notifications = [];
  }

  async dispose(): Promise<void> {
    try {
      await this.request("shutdown", null, 3000);
      await this.notify("exit", null);
    } catch {
      // Server may already be gone
    }
    await new Promise((r) => setTimeout(r, 200));
    if (!this.server.killed) {
      this.server.kill();
    }
  }
}
