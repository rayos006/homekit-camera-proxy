import { createHash } from "node:crypto";

/**
 * Derive a stable MAC-like HAP username from a seed string. The first byte
 * has the locally-administered bit set and the multicast bit cleared so it
 * can never collide with a real burned-in address.
 */
export function stableUsername(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  const bytes = Array.from(digest.subarray(0, 6));
  bytes[0] = (bytes[0] | 0x02) & 0xfe;
  return bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
}

export function cameraUuidSeed(cameraName: string): string {
  return `homekit-camera-proxy:camera:${cameraName}`;
}

export function bridgeUuidSeed(bridgeName: string): string {
  return `homekit-camera-proxy:bridge:${bridgeName}`;
}
