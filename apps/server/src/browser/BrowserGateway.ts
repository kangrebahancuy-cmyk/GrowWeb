import { BrowserSessionRegistry, parseBrowserClientMessage, serializeBrowserServerMessage } from "@growserver/browser-protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { Base } from "../core/Base";
import { BrowserAccountAuthenticator } from "./AccountAuthenticator";
import logger from "@growserver/logger";

export class BrowserGateway {
  private readonly server: WebSocketServer;
  private readonly auth: BrowserAccountAuthenticator;
  private readonly registry = new BrowserSessionRegistry();
  private readonly sessions = new Map<WebSocket, string>();
  private readonly attempts = new Map<string, { since: number; count: number }>();

  constructor(base: Base) {
    this.auth = new BrowserAccountAuthenticator(base, this.registry);
    const port = Number.parseInt(process.env.BROWSER_GATEWAY_PORT ?? "8081", 10);
    const host = process.env.BROWSER_GATEWAY_HOST ?? "127.0.0.1";
    const origins = (process.env.BROWSER_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((v) => v.trim());
    this.server = new WebSocketServer({
      host:              host,
      port:              port,
      path:              "/browser",
      maxPayload:        16 * 1024,
      perMessageDeflate: false,
      verifyClient: (info, done) => {
        if (!info.origin && process.env.BROWSER_ALLOW_NO_ORIGIN !== "true") return done(false, 403, "Origin required");
        if (info.origin && !origins.includes(info.origin)) return done(false, 403, "Origin not allowed");
        if (this.server.clients.size >= 100) return done(false, 503, "Gateway at capacity");
        done(true);
      },
    });
    this.server.on("connection", (socket, request) => {
      const ip = request.socket.remoteAddress ?? "unknown";
      let sessionId: string | undefined;
      this.send(socket, { version: 1, type: "hello", protocol: 1 });
      this.send(socket, { version: 1, type: "status", state: "connected" });
      socket.on("message", async (raw, binary) => {
        if (binary) return this.fail(socket, "binary_not_supported", "Send JSON text messages only.");
        const parsed = parseBrowserClientMessage(raw.toString());
        if (!parsed.ok) return this.fail(socket, parsed.reason, "Invalid browser message.");
        const msg = parsed.message;
        if (msg.type === "ping") return this.send(socket, { version: 1, type: "pong", nonce: msg.nonce });
        if (msg.type === "hello") return this.send(socket, { version: 1, type: "hello", protocol: 1 });
        if (msg.type !== "login") {
          return this.fail(socket, sessionId ? "game_session_unavailable" : "authentication_required",
            sessionId ? "Account is verified, but no real browser game session is attached yet." : "Log in first.");
        }
        if (sessionId) return this.fail(socket, "already_authenticated", "This connection is already authenticated.");
        const now = Date.now();
        const previous = this.attempts.get(ip);
        if (previous && now - previous.since < 60_000 && previous.count >= 5) {
          this.fail(socket, "login_rate_limited", "Too many login attempts. Try again in one minute.");
          socket.close(1008, "Login rate limited");
          return;
        }
        this.attempts.set(ip, !previous || now - previous.since >= 60_000 ? { since: now, count: 1 } : { ...previous, count: previous.count + 1 });
        this.send(socket, { version: 1, type: "status", state: "authenticating" });
        try {
          const account = await this.auth.authenticate(msg.username, msg.password);
          sessionId = account.sessionId;
          this.sessions.set(socket, sessionId);
          this.send(socket, { version: 1, type: "status", state: "authenticated" });
          this.send(socket, { version: 1, type: "event", name: "account-authenticated", payload: {
            accountId: account.accountId, username: account.username, displayName: account.displayName, level: account.level,
          } });
          this.fail(socket, "game_session_unavailable", "Credentials verified. Browser gameplay is blocked until a real GrowServer player-session adapter is available.");
        } catch (error) {
          const code = error instanceof Error ? error.message : "invalid_credentials";
          const safe = ["invalid_credentials", "account_in_use_by_native_client", "account_already_in_use"].includes(code) ? code : "authentication_failed";
          this.fail(socket, safe, safe === "account_in_use_by_native_client" ? "Account is active in the native client." : "Unable to authenticate this account.");
        }
      });
      socket.on("close", () => {
        const owned = this.sessions.get(socket);
        if (owned) this.auth.release(owned);
        this.sessions.delete(socket);
      });
      socket.on("error", (error) => logger.warn(`Browser gateway socket error: ${error.message}`));
    });
    this.server.on("listening", () => logger.info(`Browser gateway listening on ws://${host}:${port}/browser`));
    this.server.on("error", (error) => logger.error(`Browser gateway error: ${error.message}`));
  }

  private send(socket: WebSocket, message: Parameters<typeof serializeBrowserServerMessage>[0]): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(serializeBrowserServerMessage(message));
  }

  private fail(socket: WebSocket, code: string, message: string): void {
    this.send(socket, { version: 1, type: "error", code, message });
  }

  close(): Promise<void> {
    for (const [socket, sessionId] of this.sessions) {
      this.auth.release(sessionId);
      socket.close(1001, "Server shutting down");
    }
    this.sessions.clear();
    return new Promise((resolve, reject) => this.server.close((error) => error ? reject(error) : resolve()));
  }
}
