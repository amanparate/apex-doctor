import { LogEvent } from "./parser";

export interface HeapAllocator {
  /** Enclosing method / code-unit name, or "(top level)" if outside any frame */
  name: string;
  lineNumber?: number;
  /** Total bytes attributed to this frame */
  bytes: number;
  /** Number of HEAP_ALLOCATE events attributed here */
  count: number;
  /** Share of total allocated bytes */
  pctOfTotal: number;
}

export interface HeapSample {
  /** Nanoseconds since the first allocation */
  tNs: number;
  /** Cumulative bytes allocated up to this point */
  cumulativeBytes: number;
}

export interface HeapProfile {
  /** Sum of every HEAP_ALLOCATE `Bytes:N` — total churn, not live heap */
  totalAllocatedBytes: number;
  /** Number of HEAP_ALLOCATE events seen */
  allocationCount: number;
  /** Allocators ranked by bytes (top 50) */
  byAllocator: HeapAllocator[];
  /** The single biggest allocator */
  topAllocator?: HeapAllocator;
  /** Cumulative-allocation series for charting (capped) */
  series: HeapSample[];
  /** Authoritative peak live-heap from the governor "Maximum heap size" metric, if present */
  peakHeapBytes?: number;
  /** The heap governor limit (bytes), if present */
  heapLimitBytes?: number;
  /** peakHeapBytes / heapLimitBytes as a percentage, if both are known */
  pctOfLimit?: number;
}

const MAX_SERIES = 300;

/**
 * Build a heap profile from the raw event stream.
 *
 * HEAP_ALLOCATE events look like (after the parser strips the `[line]` prefix):
 *   <ts> (<nanos>)|HEAP_ALLOCATE|[42]|Bytes:88
 * so `ev.details` === "Bytes:88" and `ev.lineNumber` === 42.
 *
 * Allocations are attributed to the nearest enclosing METHOD_ENTRY (falling back
 * to the enclosing CODE_UNIT_STARTED), mirroring the analyzer's stack walk.
 *
 * @param peakHeap optional `{ used, limit }` from the parsed "Maximum heap size"
 *                 governor metric — the only authoritative live-heap figure.
 */
export function buildHeapProfile(
  events: LogEvent[],
  peakHeap?: { used: number; limit: number },
): HeapProfile {
  interface Frame {
    name: string;
    lineNumber?: number;
  }
  const stack: Frame[] = [];
  const byName = new Map<string, HeapAllocator>();
  const series: HeapSample[] = [];

  let totalAllocatedBytes = 0;
  let allocationCount = 0;
  let firstNs: number | undefined;

  for (const ev of events) {
    switch (ev.eventType) {
      case "METHOD_ENTRY": {
        const parts = ev.details.split("|");
        stack.push({ name: parts[parts.length - 1] || ev.details, lineNumber: ev.lineNumber });
        break;
      }
      case "METHOD_EXIT":
        if (stack.length) {
          stack.pop();
        }
        break;
      case "CODE_UNIT_STARTED": {
        const parts = ev.details.split("|");
        stack.push({ name: parts[parts.length - 1] || ev.details, lineNumber: ev.lineNumber });
        break;
      }
      case "CODE_UNIT_FINISHED":
        if (stack.length) {
          stack.pop();
        }
        break;
      case "HEAP_ALLOCATE": {
        const m = /Bytes:(\d+)/.exec(ev.details);
        if (!m) {
          break;
        }
        const bytes = Number(m[1]);
        totalAllocatedBytes += bytes;
        allocationCount += 1;

        const frame = stack[stack.length - 1];
        const name = frame?.name || "(top level)";
        const key = name;
        const existing = byName.get(key);
        if (existing) {
          existing.bytes += bytes;
          existing.count += 1;
        } else {
          byName.set(key, {
            name,
            lineNumber: frame?.lineNumber,
            bytes,
            count: 1,
            pctOfTotal: 0,
          });
        }

        if (firstNs === undefined) {
          firstNs = ev.nanoseconds;
        }
        series.push({ tNs: ev.nanoseconds - firstNs, cumulativeBytes: totalAllocatedBytes });
        break;
      }
    }
  }

  for (const a of byName.values()) {
    a.pctOfTotal = totalAllocatedBytes > 0 ? (a.bytes / totalAllocatedBytes) * 100 : 0;
  }
  const byAllocator = [...byName.values()].sort((x, y) => y.bytes - x.bytes).slice(0, 50);

  return {
    totalAllocatedBytes,
    allocationCount,
    byAllocator,
    topAllocator: byAllocator[0],
    series: downsample(series, MAX_SERIES),
    peakHeapBytes: peakHeap?.used,
    heapLimitBytes: peakHeap?.limit,
    pctOfLimit:
      peakHeap && peakHeap.limit > 0 ? (peakHeap.used / peakHeap.limit) * 100 : undefined,
  };
}

/** Evenly thin a sample series down to at most `max` points, keeping the last. */
function downsample(series: HeapSample[], max: number): HeapSample[] {
  if (series.length <= max) {
    return series;
  }
  const step = series.length / max;
  const out: HeapSample[] = [];
  for (let i = 0; i < max; i++) {
    out.push(series[Math.floor(i * step)]);
  }
  out.push(series[series.length - 1]);
  return out;
}

/** Human-readable byte formatting for the UI. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
