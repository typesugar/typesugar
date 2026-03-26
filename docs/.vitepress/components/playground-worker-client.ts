/**
 * Promise-based RPC client for the TypeScript language service worker.
 */

export interface WorkerDiagnostic {
  start: number;
  length: number;
  messageText: string;
  category: number; // ts.DiagnosticCategory
  code: number;
}

export interface WorkerCompletionResult {
  isGlobalCompletion: boolean;
  isMemberCompletion: boolean;
  entries: Array<{
    name: string;
    kind: string;
    sortText: string;
    insertText?: string;
    isRecommended?: boolean;
  }>;
}

export interface WorkerQuickInfo {
  kind: string;
  textSpan: { start: number; length: number };
  displayParts: string;
  documentation: string;
}

export interface WorkerDefinition {
  textSpan: { start: number; length: number };
  fileName: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TSWorkerClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private timeout: number;

  constructor(workerUrl: string | URL, timeout = 5000) {
    this.timeout = timeout;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });

    try {
      this.worker = new Worker(workerUrl);
      this.worker.onmessage = (e) => this.handleMessage(e.data);
      this.worker.onerror = (e) => {
        console.warn("[ts-worker] Worker error:", e.message);
      };
    } catch (e) {
      console.warn("[ts-worker] Failed to create worker:", e);
    }
  }

  private handleMessage(data: { id: number; result?: unknown; error?: string }) {
    if (data.id === -1) {
      // Ready signal
      this.resolveReady();
      return;
    }

    const pending = this.pending.get(data.id);
    if (!pending) return;

    this.pending.delete(data.id);
    clearTimeout(pending.timer);

    if (data.error) {
      pending.reject(new Error(data.error));
    } else {
      pending.resolve(data.result);
    }
  }

  private call(method: string, ...params: unknown[]): Promise<unknown> {
    if (!this.worker) return Promise.resolve(null);

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null); // timeout → return null, don't break the UI
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, method, params });
    });
  }

  async waitReady(): Promise<void> {
    return this.readyPromise;
  }

  async updateFile(fileName: string, content: string): Promise<void> {
    await this.call("updateFile", fileName, content);
  }

  async addLib(fileName: string, content: string): Promise<void> {
    await this.call("addLib", fileName, content);
  }

  async getDiagnostics(fileName: string): Promise<WorkerDiagnostic[]> {
    return ((await this.call("getDiagnostics", fileName)) as WorkerDiagnostic[]) ?? [];
  }

  async getCompletions(fileName: string, position: number): Promise<WorkerCompletionResult | null> {
    return (await this.call("getCompletions", fileName, position)) as WorkerCompletionResult | null;
  }

  async getQuickInfo(fileName: string, position: number): Promise<WorkerQuickInfo | null> {
    return (await this.call("getQuickInfo", fileName, position)) as WorkerQuickInfo | null;
  }

  async getDefinition(fileName: string, position: number): Promise<WorkerDefinition[] | null> {
    return (await this.call("getDefinition", fileName, position)) as WorkerDefinition[] | null;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this.pending.clear();
  }
}
