import type { CameraConfig } from "../config.js";
import { createLogger } from "../logger.js";
import type { FrigateWsClient } from "./frigate-ws.js";

const log = createLogger("motion");

interface FrigateEvent {
  type: "new" | "update" | "end";
  before?: { id?: string; camera?: string; label?: string };
  after?: { id?: string; camera?: string; label?: string };
}

/**
 * Maps Frigate WS messages to a motion state callback for one camera.
 *
 * labels [] or ["motion"]: follows the raw `<camera>/motion` ON/OFF topic.
 * Otherwise: follows the `events` topic filtered by camera + object label.
 * A reset timer backstops missed OFF/end messages across reconnects.
 */
export class MotionHandler {
  private resetTimer?: NodeJS.Timeout;
  private readonly activeEventIds = new Set<string>();
  private readonly useRawMotion: boolean;

  constructor(
    private readonly camera: CameraConfig,
    ws: FrigateWsClient,
    private readonly setMotion: (detected: boolean) => void,
  ) {
    const labels = camera.motion.labels;
    this.useRawMotion = labels.length === 0 || (labels.length === 1 && labels[0] === "motion");
    ws.on("message", (topic: string, payload: string) => this.onMessage(topic, payload));
  }

  private onMessage(topic: string, payload: string): void {
    if (this.useRawMotion) {
      if (topic !== `${this.camera.frigateName}/motion`) return;
      if (payload === "ON") this.trigger();
      else if (payload === "OFF") this.clear();
      return;
    }

    if (topic !== "events") return;
    let event: FrigateEvent;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    const after = event.after ?? event.before;
    if (!after || after.camera !== this.camera.frigateName) return;
    if (!after.label || !this.camera.motion.labels.includes(after.label)) return;

    const id = after.id ?? "unknown";
    if (event.type === "end") {
      this.activeEventIds.delete(id);
      if (this.activeEventIds.size === 0) this.clear();
    } else {
      this.activeEventIds.add(id);
      this.trigger();
    }
  }

  private trigger(): void {
    log.debug("motion detected", { camera: this.camera.frigateName });
    this.setMotion(true);
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.activeEventIds.clear();
      this.clear();
    }, this.camera.motion.resetSeconds * 1000);
  }

  private clear(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    this.setMotion(false);
  }
}
