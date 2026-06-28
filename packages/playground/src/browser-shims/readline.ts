/**
 * Browser shim for Node.js `readline`.
 *
 * `@typesugar/fp`'s `Console` IO uses `readline.createInterface()` to read from
 * stdin. There is no stdin in the browser playground, so this shim provides an
 * inert interface whose `question()` immediately yields an empty string and which
 * is otherwise a no-op. (fp emits a lazy `require("readline")`; de-bundling its
 * per-module output means the playground bundler now sees this import.)
 */
export interface Interface {
  question(query: string, callback: (answer: string) => void): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export function createInterface(_options?: unknown): Interface {
  const iface: Interface = {
    question(_query, callback) {
      callback("");
    },
    close() {},
    on() {
      return iface;
    },
  };
  return iface;
}

export default { createInterface };
