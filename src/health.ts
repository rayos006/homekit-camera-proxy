import { createServer, type Server } from "node:http";
import { createLogger } from "./logger.js";

const log = createLogger("health");

export interface HealthStatus {
  bridgePublished: boolean;
  wsConnected: boolean;
  cameras: number;
  activeStreams: number;
}

export function startHealthServer(port: number, status: () => HealthStatus): Server {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      const s = status();
      // Only a failed bridge publish is fatal; a dropped Frigate WS must not
      // restart the pod — live streaming still works without motion events.
      res.writeHead(s.bridgePublished ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify(s));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, () => log.info("health server listening", { port }));
  return server;
}
