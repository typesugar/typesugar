/**
 * Yield to the event loop after every test.
 *
 * Vitest runs a file's synchronous tests back to back without returning to the
 * event loop, so a worker cannot answer its own RPC traffic until the file
 * ends. On a slow runner a file of synchronous whole-program tests
 * (strict-output.test.ts takes ~64s on TypeScript 5.9.2 in CI) exceeds
 * vitest's 60s RPC timeout and the run fails with "Timeout calling
 * onTaskUpdate" even though every test passed. `setImmediate` lets pending
 * I/O, including those RPC replies, be processed between tests.
 */
import { afterEach } from "vitest";

afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
