import type { VercelRequest, VercelResponse } from "@vercel/node";
import { transformCode, type TransformDiagnostic } from "@typesugar/transformer";

// ---------------------------------------------------------------------------
// LRU Cache (survives across warm Vercel invocations)
// ---------------------------------------------------------------------------

interface CacheEntry {
  code: string;
  diagnostics: TransformDiagnostic[];
  changed: boolean;
}

class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, entry);
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

const cache = new LRUCache(200);

// ---------------------------------------------------------------------------
// Rate Limiter (sliding window, per-IP)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

class RateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private maxRequests: number;
  private windowMs: number;
  private maxEntries: number;

  constructor(maxRequests: number, windowMs: number, maxEntries = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
  }

  isAllowed(ip: string): boolean {
    const now = Date.now();
    const entry = this.limits.get(ip);

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.limits.set(ip, { count: 1, windowStart: now });
      this.cleanup();
      return true;
    }

    if (entry.count >= this.maxRequests) {
      return false;
    }

    entry.count++;
    return true;
  }

  private cleanup(): void {
    if (this.limits.size > this.maxEntries) {
      const now = Date.now();
      for (const [ip, entry] of this.limits) {
        if (now - entry.windowStart > this.windowMs) {
          this.limits.delete(ip);
        }
      }
      if (this.limits.size > this.maxEntries) {
        const oldest = this.limits.keys().next().value;
        if (oldest) this.limits.delete(oldest);
      }
    }
  }
}

const rateLimiter = new RateLimiter(60, 60_000);

// ---------------------------------------------------------------------------
// Content hashing (FNV-1a)
// ---------------------------------------------------------------------------

function hashContent(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Compile using the real transformer
// ---------------------------------------------------------------------------

interface CompileResult {
  code: string;
  diagnostics: TransformDiagnostic[];
  changed: boolean;
  cached: boolean;
}

function compile(code: string, fileName: string): CompileResult {
  const cacheKey = hashContent(code + "\0" + fileName);

  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const result = transformCode(code, { fileName });

  const entry: CacheEntry = {
    code: result.code,
    diagnostics: result.diagnostics,
    changed: result.changed,
  };
  cache.set(cacheKey, entry);

  return { ...entry, cached: false };
}

// ---------------------------------------------------------------------------
// Vercel serverless handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    res.setHeader("Cache-Control", "no-cache");
    return res.status(200).json({ status: "warm", cacheSize: cache.size });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (!rateLimiter.isAllowed(clientIp)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Rate limit exceeded. Try again in 1 minute." });
  }

  const body = req.body;
  if (!body || typeof body.code !== "string") {
    return res.status(400).json({ error: "Request body must include a `code` string" });
  }

  if (body.code.length > 100_000) {
    return res.status(413).json({ error: "Code exceeds 100KB limit" });
  }

  const code: string = body.code;
  const fileName: string = typeof body.fileName === "string" ? body.fileName : "input.ts";

  if (code.trim() === "") {
    return res.status(200).json({
      code: "",
      diagnostics: [],
      changed: false,
      cached: false,
    });
  }

  const start = performance.now();

  try {
    const result = compile(code, fileName);
    const elapsed = Math.round(performance.now() - start);

    console.log(
      JSON.stringify({
        type: "compile",
        fileName,
        codeLength: code.length,
        elapsed,
        cached: result.cached,
        changed: result.changed,
        diagnosticCount: result.diagnostics.length,
      })
    );

    res.setHeader("X-Compile-Time-Ms", String(elapsed));
    res.setHeader("X-Compile-Cached", result.cached ? "true" : "false");
    res.setHeader("Cache-Control", "no-cache");

    return res.status(200).json({
      code: result.code,
      diagnostics: result.diagnostics,
      changed: result.changed,
      cached: result.cached,
      compileTimeMs: elapsed,
    });
  } catch (err) {
    const elapsed = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);

    console.error(
      JSON.stringify({
        type: "compile_error",
        fileName,
        codeLength: code.length,
        elapsed,
        error: message,
      })
    );

    return res.status(500).json({
      error: "Compilation failed",
      message,
    });
  }
}
