/**
 * Performance Profiling for typesugar Transformer
 *
 * Gated behind TYPESUGAR_PROFILE=1 environment variable.
 * When enabled, collects timing data for key operations and
 * produces a summary report at the end of the build.
 *
 * @example
 * ```bash
 * TYPESUGAR_PROFILE=1 pnpm test
 * TYPESUGAR_PROFILE=1 typesugar build
 * ```
 */

/** Whether profiling is enabled (check TYPESUGAR_PROFILE env var) */
export const PROFILING_ENABLED = process.env.TYPESUGAR_PROFILE === "1";

/** Individual timing entry */
interface TimingEntry {
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

/** Aggregated statistics for a named operation */
interface AggregatedStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
}

/** Per-file timing breakdown */
interface FileTimings {
  fileName: string;
  readMs: number;
  hashMs: number;
  cacheCheckMs: number;
  preprocessMs: number;
  transformMs: number;
  printMs: number;
  totalMs: number;
}

/**
 * Performance profiler for the transformer pipeline
 */
class TransformProfiler {
  private timings: TimingEntry[] = [];
  private activeTimers = new Map<string, number>();
  private fileTimings: FileTimings[] = [];
  private aggregated = new Map<string, AggregatedStats>();

  /** Start timing an operation */
  start(name: string, metadata?: Record<string, unknown>): void {
    if (!PROFILING_ENABLED) return;
    const now = performance.now();
    this.activeTimers.set(name, now);
    this.timings.push({ name, startTime: now, metadata });
  }

  /** End timing an operation and return duration in ms */
  end(name: string): number {
    if (!PROFILING_ENABLED) return 0;
    const startTime = this.activeTimers.get(name);
    if (startTime === undefined) {
      console.warn(`[profiler] No start time for: ${name}`);
      return 0;
    }
    const endTime = performance.now();
    const durationMs = endTime - startTime;
    this.activeTimers.delete(name);

    // Update the timing entry
    const entry = this.timings.find(
      (t) => t.name === name && t.startTime === startTime && !t.endTime
    );
    if (entry) {
      entry.endTime = endTime;
      entry.durationMs = durationMs;
    }

    // Update aggregated stats
    this.updateAggregated(name, durationMs);

    return durationMs;
  }

  /** Time a synchronous operation */
  time<T>(name: string, fn: () => T, metadata?: Record<string, unknown>): T {
    if (!PROFILING_ENABLED) return fn();
    this.start(name, metadata);
    try {
      return fn();
    } finally {
      this.end(name);
    }
  }

  /** Record a per-file timing breakdown */
  recordFileTimings(timings: FileTimings): void {
    if (!PROFILING_ENABLED) return;
    this.fileTimings.push(timings);
  }

  /** Update aggregated statistics */
  private updateAggregated(name: string, durationMs: number): void {
    const existing = this.aggregated.get(name);
    if (existing) {
      existing.count++;
      existing.totalMs += durationMs;
      existing.minMs = Math.min(existing.minMs, durationMs);
      existing.maxMs = Math.max(existing.maxMs, durationMs);
      existing.avgMs = existing.totalMs / existing.count;
    } else {
      this.aggregated.set(name, {
        count: 1,
        totalMs: durationMs,
        minMs: durationMs,
        maxMs: durationMs,
        avgMs: durationMs,
      });
    }
  }

  /** Get aggregated stats for an operation */
  getStats(name: string): AggregatedStats | undefined {
    return this.aggregated.get(name);
  }

  /** Get all aggregated stats */
  getAllStats(): Map<string, AggregatedStats> {
    return this.aggregated;
  }

  /** Get all file timings */
  getFileTimings(): FileTimings[] {
    return this.fileTimings;
  }

  /** Reset all profiling data */
  reset(): void {
    this.timings = [];
    this.activeTimers.clear();
    this.fileTimings = [];
    this.aggregated.clear();
  }

  /** Generate a summary report */
  generateReport(): string {
    if (!PROFILING_ENABLED) return "";

    const lines: string[] = [];
    lines.push("");
    lines.push("=".repeat(80));
    lines.push("TYPESUGAR PERFORMANCE PROFILE");
    lines.push("=".repeat(80));
    lines.push("");

    // Aggregated stats
    lines.push("AGGREGATED OPERATION TIMINGS:");
    lines.push("-".repeat(80));
    lines.push(
      `${"Operation".padEnd(40)} ${"Count".padStart(8)} ${"Total".padStart(10)} ${"Avg".padStart(10)} ${"Min".padStart(10)} ${"Max".padStart(10)}`
    );
    lines.push("-".repeat(80));

    const sortedStats = [...this.aggregated.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);

    for (const [name, stats] of sortedStats) {
      lines.push(
        `${name.padEnd(40)} ${String(stats.count).padStart(8)} ${formatMs(stats.totalMs).padStart(10)} ${formatMs(stats.avgMs).padStart(10)} ${formatMs(stats.minMs).padStart(10)} ${formatMs(stats.maxMs).padStart(10)}`
      );
    }

    // Per-file breakdown (top 10 slowest)
    if (this.fileTimings.length > 0) {
      lines.push("");
      lines.push("TOP 10 SLOWEST FILES:");
      lines.push("-".repeat(80));
      lines.push(
        `${"File".padEnd(50)} ${"Total".padStart(8)} ${"Transform".padStart(10)} ${"Print".padStart(8)} ${"Preproc".padStart(8)}`
      );
      lines.push("-".repeat(80));

      const sorted = [...this.fileTimings].sort((a, b) => b.totalMs - a.totalMs).slice(0, 10);
      for (const ft of sorted) {
        const shortName = ft.fileName.length > 48 ? "..." + ft.fileName.slice(-45) : ft.fileName;
        lines.push(
          `${shortName.padEnd(50)} ${formatMs(ft.totalMs).padStart(8)} ${formatMs(ft.transformMs).padStart(10)} ${formatMs(ft.printMs).padStart(8)} ${formatMs(ft.preprocessMs).padStart(8)}`
        );
      }
    }

    // Summary
    lines.push("");
    lines.push("SUMMARY:");
    lines.push("-".repeat(80));
    const totalTransform = this.aggregated.get("transform")?.totalMs ?? 0;
    const totalProgram = this.aggregated.get("ensureProgram")?.totalMs ?? 0;
    const totalFactory = this.aggregated.get("macroTransformerFactory")?.totalMs ?? 0;
    const fileCount = this.fileTimings.length;

    lines.push(`Total files processed: ${fileCount}`);
    lines.push(`Total transform time: ${formatMs(totalTransform)}`);
    lines.push(`Program creation: ${formatMs(totalProgram)}`);
    lines.push(`Factory creation: ${formatMs(totalFactory)}`);
    if (fileCount > 0) {
      lines.push(`Average per file: ${formatMs(totalTransform / fileCount)}`);
    }

    lines.push("");
    lines.push("=".repeat(80));

    return lines.join("\n");
  }

  /** Print the summary report to console */
  printReport(): void {
    if (!PROFILING_ENABLED) return;
    console.log(this.generateReport());
  }
}

function formatMs(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)}μs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(1)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

/** Global profiler instance */
export const profiler = new TransformProfiler();

/** Convenience export for FileTimings type */
export type { FileTimings, AggregatedStats };
