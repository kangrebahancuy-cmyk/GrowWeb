import { WebSocketServer } from "ws";
import type { Base } from "../core/Base";
import logger from "@growserver/logger";

export class BrowserGateway {
  private readonly server: WebSocketServer;

  constructor(_base: Base) {
    const port = Number.parseInt(process.env.BROWSER_GATEWAY_PORT ?? "8081", 10);
    const host = process.env.BROWSER_GATEWAY_HOST ?? "127.0.0.1";
    this.server = new WebSocketServer({
      host,
      port,
      path: "/browser",
      maxPayload: 16 * 1024,
      perMessageDeflate: false,
      verifyClient: (info, done) => {
        const allowed = (process.env.BROWSER_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((value) => value.trim());
        if (!info.origin && process.env.BROWSER_ALLOW_NO_ORIGIN !== "true") return done(false, 403, "Origin required");
        if (info.origin && !allowed.includes(info.origin)) return done(false, 403, "Origin not allowed");
        if (this.server.clients.size >= 100) return done(false, 503, "Gateway at capacity");
        done(true);
      },
    });
    this.server.on("connection", (socket) => {
      socket.send(JSON.stringify({ version: 1, type: "hello", protocol: 1 }));
      socket.send(JSON.stringify({ version: 1, type: "status", state: "connected" }));
      socket.on("message", () => {
        socket.send(JSON.stringify({ version: 1, type: "error", code: "game_session_unavailable", message: "Gateway transport is online, but real player-session integration is not enabled." }));
      });
    });
    this.server.on("listening", () => logger.info(`Browser gateway listening on ws://${host}:${port}/browser`));
    this.server.on("error", (error) => logger.error(`Browser gateway error: ${error.message}`));
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }
}
