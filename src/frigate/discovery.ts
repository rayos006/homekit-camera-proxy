import { createLogger } from "../logger.js";

const log = createLogger("discovery");

/** A camera auto-discovered from Frigate, before config overrides are applied. */
export interface DiscoveredCamera {
  frigateName: string;
  name: string;
  streams: { main: string; sub?: string };
  audio: boolean;
  motion: { labels: string[] };
}

interface FrigateConfig {
  cameras?: Record<string, { enabled?: boolean }>;
  go2rtc?: { streams?: Record<string, unknown> };
}

function humanize(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Enumerate cameras from Frigate's config API. Each enabled camera with a
 * go2rtc restream becomes a camera using that restream (main = <name>,
 * sub = <name>_sub if present). Retries so a booting Frigate doesn't leave
 * us with nothing. Returns [] if Frigate stays unreachable.
 */
export async function discoverFrigateCameras(
  apiBaseUrl: string,
  attempts = 5,
  delayMs = 3000,
): Promise<DiscoveredCamera[]> {
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/config`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cfg = (await res.json()) as FrigateConfig;
      const streams = cfg.go2rtc?.streams ?? {};
      const discovered: DiscoveredCamera[] = [];

      for (const [key, cam] of Object.entries(cfg.cameras ?? {})) {
        if (cam?.enabled === false) {
          log.info("skipping disabled camera", { camera: key });
          continue;
        }
        if (!(key in streams)) {
          log.warn("camera has no go2rtc restream; skipping (add one or define it manually)", {
            camera: key,
          });
          continue;
        }
        discovered.push({
          frigateName: key,
          name: humanize(key),
          streams: { main: key, sub: `${key}_sub` in streams ? `${key}_sub` : undefined },
          // audio on by default — the user mutes in the Home app if unwanted;
          // cameras/streams without an audio track simply stay silent
          audio: true,
          // person is the sensible HomeKit-notification default; widen per
          // camera with motion.labels in config to match Frigate's tracking
          motion: { labels: ["person"] },
        });
      }

      log.info("discovered cameras from Frigate", {
        count: discovered.length,
        cameras: discovered.map((d) => d.frigateName),
      });
      return discovered;
    } catch (err) {
      log.warn("discovery attempt failed", { attempt, attempts, error: String(err) });
      if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  log.error("Frigate discovery failed after all attempts; relying on configured cameras only");
  return [];
}
