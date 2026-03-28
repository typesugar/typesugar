/**
 * HTTP-based client for the server-side TypeScript language service.
 *
 * Drop-in replacement for TSWorkerClient — same interface, but sends
 * requests to /api/ls instead of a Web Worker. The server has real
 * node_modules access, so no type stubs are needed.
 */

// Re-export the same types the adapter uses
export interface WorkerDiagnostic {
  start: number;
  length: number;
  messageText: string;
  category: number;
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

export class TSServerClient {
  private currentCode = "";
  private currentFileName = "input.ts";
  private sourceMap: unknown = null;
  private original = "";
  private timeout: number;
  private abortController: AbortController | null = null;

  constructor(timeout = 5000) {
    this.timeout = timeout;
  }

  private async call(method: string, position?: number): Promise<unknown> {
    // Abort any in-flight diagnostic request when a new one comes in
    if (method === "getDiagnostics" && this.abortController) {
      this.abortController.abort();
    }

    const controller = new AbortController();
    if (method === "getDiagnostics") {
      this.abortController = controller;
    }

    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch("/api/ls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          code: this.currentCode,
          fileName: this.currentFileName,
          position,
          sourceMap: this.sourceMap,
          original: this.original,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(`[ts-server] ${method} failed: ${response.status}`);
        return null;
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        return null; // timeout or superseded — not an error
      }
      console.warn(`[ts-server] ${method} error:`, err);
      return null;
    }
  }

  /** No-op — server is always ready */
  async waitReady(): Promise<void> {
    // Server is stateless; no initialization needed
  }

  /** Store the transformed code for subsequent LS queries */
  async updateFile(fileName: string, content: string): Promise<void> {
    this.currentFileName = fileName;
    this.currentCode = content;
  }

  /** No-op — server has real node_modules, no stubs needed */
  async addLib(_fileName: string, _content: string): Promise<void> {
    // Intentionally empty — the server resolves types from disk
  }

  /** Store source map for diagnostic position filtering */
  async setSourceMap(sourceMap: unknown, original: string, _transformed: string): Promise<void> {
    this.sourceMap = sourceMap;
    this.original = original;
  }

  async getDiagnostics(_fileName: string): Promise<WorkerDiagnostic[]> {
    const result = await this.call("getDiagnostics");
    return (result as WorkerDiagnostic[]) ?? [];
  }

  async getCompletions(
    _fileName: string,
    position: number
  ): Promise<WorkerCompletionResult | null> {
    return (await this.call("getCompletions", position)) as WorkerCompletionResult | null;
  }

  async getQuickInfo(_fileName: string, position: number): Promise<WorkerQuickInfo | null> {
    return (await this.call("getQuickInfo", position)) as WorkerQuickInfo | null;
  }

  async getDefinition(_fileName: string, position: number): Promise<WorkerDefinition[] | null> {
    return (await this.call("getDefinition", position)) as WorkerDefinition[] | null;
  }

  dispose() {
    this.abortController?.abort();
  }
}
