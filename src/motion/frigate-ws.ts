import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { createLogger } from "../logger.js";

const log = createLogger("frigate-ws");

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;
const PING_INTERVAL_MS = 30_000;

/**
 * Client for Frigate's WebSocket API (`/ws`), which mirrors its MQTT topics
 * as JSON frames: { topic, payload, retain }. Emits:
 *   "message" (topic: string, payload: string)
 *   "connected" / "disconnected"
 */
export class FrigateWsClient extends EventEmitter {
  private ws?: WebSocket;
  private backoffMs = INITIAL_BACKOFF_MS;
  private pingTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private closed = false;
  connected = false;

  private readonly url: string;

  constructor(apiBaseUrl: string) {
    super();
    this.url = apiBaseUrl.replace(/\/$/, "").replace(/^http/, "ws") + "/ws";
  }

  start(): void {
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.terminate();
  }

  private connect(): void {
    if (this.closed) return;
    log.info("connecting", { url: this.url });
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on("open", () => {
      log.info("connected");
      this.connected = true;
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.emit("connected");
      this.pingTimer = setInterval(() => ws.ping(), PING_INTERVAL_MS);
    });

    ws.on("message", (data) => {
      let frame: { topic?: unknown; payload?: unknown };
      try {
        frame = JSON.parse(data.toString());
      } catch {
        log.debug("ignoring non-JSON frame");
        return;
      }
      if (typeof frame.topic !== "string") return;
      const payload =
        typeof frame.payload === "string" ? frame.payload : JSON.stringify(frame.payload);
      this.emit("message", frame.topic, payload);
    });

    ws.on("error", (err) => {
      log.warn("socket error", { error: err.message });
    });

    ws.on("close", () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.connected) {
        this.connected = false;
        this.emit("disconnected");
      }
      if (this.closed) return;
      log.info("disconnected, reconnecting", { backoffMs: this.backoffMs });
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    });
  }
}
