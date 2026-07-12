import { mkdirSync } from "node:fs";
import { HAPStorage } from "@homebridge/hap-nodejs";
import { buildCameraAccessory, type CameraAccessory } from "./camera/accessory.js";
import { SnapshotFetcher } from "./camera/snapshot.js";
import { loadConfig } from "./config.js";
import { startHealthServer } from "./health.js";
import { createLogger } from "./logger.js";
import { DoorbellEventSource } from "./doorbell/onvif-events.js";
import { FrigateWsClient } from "./motion/frigate-ws.js";
import { MotionHandler } from "./motion/motion-handler.js";
import { publishCameraAccessory } from "./publish.js";

const log = createLogger("main");

async function main(): Promise<void> {
  const configPath = process.argv[2] ?? process.env.CONFIG_PATH ?? "/config/config.yaml";
  const config = loadConfig(configPath);
  log.info("config loaded", { path: configPath, cameras: config.cameras.length });

  // Must run before any Accessory is constructed.
  mkdirSync(config.persistDir, { recursive: true });
  HAPStorage.setCustomStoragePath(config.persistDir);

  const snapshots = new SnapshotFetcher(config.frigate.apiBaseUrl);
  const ws = new FrigateWsClient(config.frigate.apiBaseUrl);

  const accessories: CameraAccessory[] = [];
  const doorbells: DoorbellEventSource[] = [];
  let publishedCount = 0;

  for (const camera of config.cameras) {
    const cam = buildCameraAccessory(config, camera, snapshots);
    new MotionHandler(camera, ws, cam.setMotion);
    if (camera.doorbell && cam.ring) {
      doorbells.push(new DoorbellEventSource(camera, cam.ring));
    }
    try {
      await publishCameraAccessory(cam.accessory, camera, config);
      publishedCount++;
    } catch (err) {
      log.error("accessory publish failed", { name: camera.name, error: String(err) });
    }
    accessories.push(cam);
  }

  ws.start();
  for (const doorbell of doorbells) doorbell.start();

  const health = startHealthServer(config.healthPort, () => ({
    published: publishedCount,
    wsConnected: ws.connected,
    cameras: accessories.length,
    activeStreams: accessories.reduce((n, a) => n + a.delegate.activeStreamCount, 0),
  }));

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("shutting down", { signal });
    setTimeout(() => process.exit(1), 5000).unref();

    for (const a of accessories) a.delegate.stopAll();
    for (const d of doorbells) d.stop();
    ws.stop();
    health.close();
    void Promise.allSettled(accessories.map((a) => a.accessory.unpublish())).finally(() =>
      process.exit(0),
    );
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("fatal", { error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  process.exit(1);
});
