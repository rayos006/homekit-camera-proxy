import type { Accessory } from "@homebridge/hap-nodejs";
import type { AppConfig, CameraConfig } from "./config.js";
import { createLogger } from "./logger.js";
import {
  ADVERTISER_CIAO,
  CATEGORY_IP_CAMERA,
  CATEGORY_VIDEO_DOORBELL,
} from "./util/hap-values.js";
import { stableUsername } from "./util/identifiers.js";

const log = createLogger("publish");

/**
 * Publish a camera as a standalone HomeKit accessory (accessory mode, not
 * bridged): HAP serializes requests per connection, so one slow bridged
 * camera delays every other; standalone cameras fail independently. Each
 * gets its own mDNS advertisement, port, and pairing (same PIN).
 */
export async function publishCameraAccessory(
  accessory: Accessory,
  camera: CameraConfig,
  config: AppConfig,
): Promise<void> {
  const username = stableUsername(`${config.hap.usernameSeed}:${camera.name}`);
  await accessory.publish({
    username,
    pincode: config.hap.pincode,
    port: camera.hapPort!,
    category: camera.doorbell ? CATEGORY_VIDEO_DOORBELL : CATEGORY_IP_CAMERA,
    advertiser: ADVERTISER_CIAO,
  });
  log.info("accessory published", {
    name: camera.name,
    username,
    port: camera.hapPort,
    doorbell: !!camera.doorbell,
  });
}
