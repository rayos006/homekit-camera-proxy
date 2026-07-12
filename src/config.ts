import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import type { DiscoveredCamera } from "./frigate/discovery.js";

const onvifSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(8000),
  username: z.string().min(1),
  password: z.string().min(1),
});

const streamsSchema = z.object({
  main: z.string().min(1),
  sub: z.string().min(1).optional(),
});

const motionSchema = z.object({
  labels: z.array(z.string()).default([]),
  resetSeconds: z.number().int().positive().default(30),
});

/** Fully-resolved camera (discovery + overrides merged), with defaults applied. */
const cameraSchema = z
  .object({
    name: z.string().min(1),
    frigateName: z.string().min(1),
    streams: streamsSchema,
    audio: z.boolean().default(false),
    twoWayAudio: z.boolean().default(false),
    videoCodec: z.enum(["copy", "libx264"]).default("copy"),
    motion: motionSchema.default({ labels: [], resetSeconds: 30 }),
    doorbell: z.object({ onvif: onvifSchema }).optional(),
    hapPort: z.number().int().positive().optional(),
  })
  .transform((cam) => ({
    ...cam,
    // talkback requires the audio return channel to be negotiated
    audio: cam.audio || cam.twoWayAudio,
  }));

/**
 * A config `cameras` entry. `frigateName` is the merge key: matching a
 * discovered camera overrides its fields; not matching defines a manual
 * camera (which must then supply enough to be valid, e.g. streams.main).
 * Everything but `frigateName` is optional so overrides stay terse.
 */
const cameraOverrideSchema = z.object({
  frigateName: z.string().min(1),
  name: z.string().min(1).optional(),
  streams: z.object({ main: z.string().min(1).optional(), sub: z.string().min(1).optional() }).optional(),
  audio: z.boolean().optional(),
  twoWayAudio: z.boolean().optional(),
  videoCodec: z.enum(["copy", "libx264"]).optional(),
  motion: z
    .object({ labels: z.array(z.string()).optional(), resetSeconds: z.number().int().positive().optional() })
    .optional(),
  doorbell: z.object({ onvif: onvifSchema }).optional(),
  hapPort: z.number().int().positive().optional(),
});

const configSchema = z.object({
  // Each camera publishes as its own HomeKit accessory (accessory mode, not a
  // bridge): HAP serializes requests per connection, so bridged cameras would
  // head-of-line block each other.
  hap: z.object({
    pincode: z.string().regex(/^\d{3}-\d{2}-\d{3}$/, "pincode must look like 031-45-154"),
    basePort: z.number().int().positive().default(51826),
    usernameSeed: z.string().min(1),
  }),
  frigate: z.object({
    apiBaseUrl: z.string().url(),
    rtspBaseUrl: z.string().min(1),
    // discover cameras from Frigate's config API on startup
    discover: z.boolean().default(true),
  }),
  persistDir: z.string().min(1),
  healthPort: z.number().int().positive().default(9891),
  ffmpegPath: z.string().min(1).default("ffmpeg"),
  cameras: z.array(cameraOverrideSchema).default([]),
});

export type AppConfig = z.infer<typeof configSchema>;
export type CameraOverride = z.infer<typeof cameraOverrideSchema>;
export type CameraConfig = z.infer<typeof cameraSchema>;

/** Resolve a stream config value to a full RTSP URL. */
export function rtspUrl(config: AppConfig, stream: string): string {
  if (stream.startsWith("rtsp://") || stream.startsWith("rtsps://")) return stream;
  return `${config.frigate.rtspBaseUrl.replace(/\/$/, "")}/${stream}`;
}

function substituteEnv(raw: string): string {
  return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`config references environment variable ${name}, which is not set`);
    }
    return value;
  });
}

export function loadConfig(path: string): AppConfig {
  const raw = substituteEnv(readFileSync(path, "utf8"));
  const parsed = configSchema.safeParse(parse(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`invalid config ${path}:\n${issues}`);
  }
  const config = parsed.data;
  if (process.env.HKCP_PINCODE) config.hap.pincode = process.env.HKCP_PINCODE;
  return config;
}

/** Raw (pre-normalization) camera shape used while merging discovery + overrides. */
type RawCamera = {
  frigateName: string;
  name?: string;
  streams?: { main?: string; sub?: string };
  audio?: boolean;
  twoWayAudio?: boolean;
  videoCodec?: "copy" | "libx264";
  motion?: { labels?: string[]; resetSeconds?: number };
  doorbell?: CameraOverride["doorbell"];
  hapPort?: number;
};

function mergeCamera(base: RawCamera, ov: CameraOverride): RawCamera {
  return {
    frigateName: base.frigateName,
    name: ov.name ?? base.name,
    streams: { main: ov.streams?.main ?? base.streams?.main, sub: ov.streams?.sub ?? base.streams?.sub },
    audio: ov.audio ?? base.audio,
    twoWayAudio: ov.twoWayAudio ?? base.twoWayAudio,
    videoCodec: ov.videoCodec ?? base.videoCodec,
    motion: { labels: ov.motion?.labels ?? base.motion?.labels, resetSeconds: ov.motion?.resetSeconds ?? base.motion?.resetSeconds },
    doorbell: ov.doorbell ?? base.doorbell,
    hapPort: ov.hapPort ?? base.hapPort,
  };
}

/**
 * Combine discovered cameras with config overrides into the final list.
 * Overrides match discovered cameras by `frigateName`; unmatched overrides
 * are treated as fully-manual cameras. Assigns each a stable HAP port.
 */
export function resolveCameras(config: AppConfig, discovered: DiscoveredCamera[]): CameraConfig[] {
  const merged = new Map<string, RawCamera>();
  for (const d of discovered) {
    merged.set(d.frigateName, {
      frigateName: d.frigateName,
      name: d.name,
      streams: { ...d.streams },
      motion: { labels: d.motion.labels },
    });
  }
  for (const ov of config.cameras) {
    const base = merged.get(ov.frigateName) ?? { frigateName: ov.frigateName };
    merged.set(ov.frigateName, mergeCamera(base, ov));
  }

  const cameras = [...merged.values()].map((rawWithUndef) => {
    // drop undefined keys so schema defaults apply cleanly
    const raw = JSON.parse(JSON.stringify(rawWithUndef));
    const parsed = cameraSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new Error(`camera "${rawWithUndef.frigateName}" is incomplete (${issues})`);
    }
    return parsed.data;
  });

  if (cameras.length === 0) {
    throw new Error(
      "no cameras: Frigate discovery returned none and none were configured. Is Frigate reachable?",
    );
  }

  // stable ordering so auto-assigned ports don't shuffle arbitrarily
  cameras.sort((a, b) => a.frigateName.localeCompare(b.frigateName));

  const names = new Set<string>();
  const usedPorts = new Set<number>();
  for (const c of cameras) {
    if (names.has(c.name)) throw new Error(`duplicate camera name: ${c.name}`);
    names.add(c.name);
    if (c.hapPort) usedPorts.add(c.hapPort);
  }
  let next = config.hap.basePort;
  for (const c of cameras) {
    if (c.hapPort) continue;
    while (usedPorts.has(next)) next++;
    c.hapPort = next;
    usedPorts.add(next);
  }
  return cameras;
}
