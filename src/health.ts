import { createServer, type Server } from "node:http";
import { createLogger } from "./logger.js";

const log = createLogger("health");

export interface HealthStatus {
  published: number;
  wsConnected: boolean;
  cameras: number;
  activeStreams: number;
}

export function startHealthServer(port: number, status: () => HealthStatus): Server {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      const s = status();
      // Fatal only if nothing published at all; a dropped Frigate WS or a
      // single failed accessory must not restart the pod — the published
      // cameras still stream.
      res.writeHead(s.published > 0 ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify(s));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => log.info("health server listening", { port }));
  return server;
}
