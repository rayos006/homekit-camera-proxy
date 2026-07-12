import { Cam, type CamEventMessage } from "onvif";
import type { CameraConfig } from "../config.js";
import { createLogger } from "../logger.js";

const INITIAL_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 300_000;

/**
 * Subscribes to a doorbell's ONVIF events (PullPoint; the onvif package
 * manages the pull loop and renewals once an "event" listener is attached)
 * and fires `onRing` for Reolink's Visitor rule — the button-press event.
 */
export class DoorbellEventSource {
  private readonly log;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = false;
  connected = false;

  constructor(
    private readonly camera: CameraConfig,
    private readonly onRing: () => void,
  ) {
    this.log = createLogger(`doorbell:${camera.frigateName}`);
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
  }

  private connect(): void {
    if (this.stopped || !this.camera.doorbell) return;
    const { host, port, username, password } = this.camera.doorbell.onvif;
    this.log.info("connecting to ONVIF", { host, port });

    const cam = new Cam(
      { hostname: host, port, username, password, timeout: 10_000, preserveAddress: true },
      (err) => {
        if (err) {
          this.log.warn("ONVIF connect failed", { error: err.message, retryMs: this.backoffMs });
          this.scheduleReconnect();
          return;
        }
        this.connected = true;
        this.backoffMs = INITIAL_BACKOFF_MS;
        this.log.info("ONVIF connected, subscribed to events");

        cam.on("event", (message: CamEventMessage) => this.onEvent(message));
        cam.on("error", (err: unknown) => {
          this.log.warn("ONVIF error, resubscribing", { error: String(err) });
          this.connected = false;
          cam.removeAllListeners("event");
          this.scheduleReconnect();
        });
      },
    );
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private onEvent(message: CamEventMessage): void {
    const topic = message.topic?._ ?? "";
    if (!/Visitor/i.test(topic)) return;

    const items = message.message?.message?.data?.simpleItem;
    const list = Array.isArray(items) ? items : items ? [items] : [];
    const state = list.find((i) => i.$?.Name === "State")?.$?.Value;
    // Some firmwares omit the State item entirely on press
    const pressed = state === undefined || state === true || state === "true";

    this.log.debug("visitor event", { topic, state: String(state) });
    if (pressed) {
      this.log.info("doorbell pressed");
      this.onRing();
    }
  }
}
