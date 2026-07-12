import { createLogger } from "../logger.js";

const log = createLogger("snapshot");

const CACHE_TTL_MS = 3000;
const FETCH_TIMEOUT_MS = 5000;

interface CacheEntry {
  fetchedAt: number;
  data: Buffer;
}

export class SnapshotFetcher {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly apiBaseUrl: string) {}

  /**
   * Fetch the latest snapshot for a Frigate camera, scaled to `height`.
   * Serves a short-lived cache to absorb Home-app tile refresh bursts and
   * falls back to the last known image if Frigate is unreachable.
   */
  async fetch(frigateName: string, height: number): Promise<Buffer> {
    const key = `${frigateName}:${height}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

    const url = `${this.apiBaseUrl.replace(/\/$/, "")}/api/${frigateName}/latest.jpg?h=${height}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      this.cache.set(key, { fetchedAt: Date.now(), data });
      return data;
    } catch (err) {
      if (cached) {
        log.warn("snapshot fetch failed, serving stale cache", {
          camera: frigateName,
          error: String(err),
        });
        return cached.data;
      }
      throw new Error(`snapshot fetch failed for ${frigateName}: ${String(err)}`);
    }
  }
}
