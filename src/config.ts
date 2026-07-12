import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

const onvifSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(8000),
  username: z.string().min(1),
  password: z.string().min(1),
});

const cameraSchema = z
  .object({
    name: z.string().min(1),
    frigateName: z.string().min(1),
    streams: z.object({
      main: z.string().min(1),
      sub: z.string().min(1).optional(),
    }),
    audio: z.boolean().default(false),
    twoWayAudio: z.boolean().default(false),
    videoCodec: z.enum(["copy", "libx264"]).default("copy"),
    motion: z
      .object({
        labels: z.array(z.string()).default([]),
        resetSeconds: z.number().int().positive().default(30),
      })
      .default({ labels: [], resetSeconds: 30 }),
    doorbell: z.object({ onvif: onvifSchema }).optional(),
    /** HAP port override; defaults to hap.basePort + position in the list. */
    hapPort: z.number().int().positive().optional(),
  })
  .transform((cam) => ({
    ...cam,
    // talkback requires the audio return channel to be negotiated
    audio: cam.audio || cam.twoWayAudio,
  }));

const configSchema = z.object({
  // Each camera publishes as its own HomeKit accessory (accessory mode, not a
  // bridge): HAP serializes requests per connection, so bridged cameras
  // head-of-line block each other; standalone cameras degrade independently.
  hap: z.object({
    pincode: z.string().regex(/^\d{3}-\d{2}-\d{3}$/, "pincode must look like 031-45-154"),
    basePort: z.number().int().positive().default(51826),
    usernameSeed: z.string().min(1),
  }),
  frigate: z.object({
    apiBaseUrl: z.string().url(),
    rtspBaseUrl: z.string().min(1),
  }),
  persistDir: z.string().min(1),
  healthPort: z.number().int().positive().default(9891),
  ffmpegPath: z.string().min(1).default("ffmpeg"),
  cameras: z.array(cameraSchema).min(1),
});

export type AppConfig = z.infer<typeof configSchema>;
export type CameraConfig = AppConfig["cameras"][number];

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

  const names = new Set<string>();
  const ports = new Set<number>();
  config.cameras.forEach((cam, i) => {
    if (names.has(cam.name)) throw new Error(`duplicate camera name in config: ${cam.name}`);
    names.add(cam.name);
    cam.hapPort ??= config.hap.basePort + i;
    if (ports.has(cam.hapPort)) throw new Error(`duplicate hapPort in config: ${cam.hapPort}`);
    ports.add(cam.hapPort);
  });
  return config;
}
