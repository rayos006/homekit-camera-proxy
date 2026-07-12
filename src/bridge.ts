import { Bridge, Characteristic, Service, uuid } from "@homebridge/hap-nodejs";
import type { AppConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { ADVERTISER_CIAO, CATEGORY_BRIDGE } from "./util/hap-values.js";
import { bridgeUuidSeed, stableUsername } from "./util/identifiers.js";

const log = createLogger("bridge");

export function createBridge(config: AppConfig): Bridge {
  const bridge = new Bridge(config.bridge.name, uuid.generate(bridgeUuidSeed(config.bridge.name)));
  bridge
    .getService(Service.AccessoryInformation)!
    .setCharacteristic(Characteristic.Manufacturer, "homekit-camera-proxy")
    .setCharacteristic(Characteristic.Model, "Frigate Bridge");
  return bridge;
}

export async function publishBridge(bridge: Bridge, config: AppConfig): Promise<void> {
  const username = stableUsername(config.bridge.usernameSeed);
  await bridge.publish({
    username,
    pincode: config.bridge.pincode,
    port: config.bridge.port,
    category: CATEGORY_BRIDGE,
    advertiser: ADVERTISER_CIAO,
  });
  log.info("bridge published", {
    name: config.bridge.name,
    username,
    port: config.bridge.port,
    setupUri: bridge.setupURI(),
  });
  // The pairing PIN is deliberately not logged; it lives in config.
}
