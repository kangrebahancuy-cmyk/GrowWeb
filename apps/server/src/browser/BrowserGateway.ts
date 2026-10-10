import { WebSocket, WebSocketServer, type VerifyClientCallbackAsync } from "ws";
import { BrowserSessionRegistry, parseBrowserClientMessage, serializeBrowserServerMessage } from "@growserver/browser-protocol";
import { BrowserAccountAuthenticator } from "./AccountAuthenticator";
import type { Base } from "../core/Base";
import logger from "@growserver/logger";

type LoginLimit = { startedAt: number; attempts: number };

const WINDOW_MS = 60_000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_CONNECTIONS = 100;

export class BrowserGateway {
  private readonly registry = new BrowserSessionRegistry();
  private readonly authenticator: BrowserAccountAuthenticator;
  private readonly loginLimits = new Map<string, LoginLimit>();
  private readonly server: WebSocketServer;
  private readonly authenticatedSockets = new Map<WebSocket, string>();

  constructor(private readonly base: Base) {
    this.authenticator = new BrowserAccountAuthenticator(base, this.registry);
    const port = Number.parseInt(process.env.BROWSER_GATEWAY_PORT ?? "8081", 10);
    const host = process.env.BROWSER_GATEWAY_HOST ?? "127.0.0.1";
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("BROWSER_GATEWAY_PORT must be a valid TCP port");
    }

    this.server = new WebSocketServer({
      host,
      port,
      path: "/browser",
      maxPayload: 16 * 1024,
      perMessageDeflate: false,
      clientTracking: true,
      verifyClient: (info, done) => {
        if ((this.server?.clients.size ?? 0) >= MAX_CONNECTIONS) {
          done(false, 503, "Browser gateway is at capacity");
          return;
        }

        const origin = info.origin;
        const configured = (process.env.BROWSER_ALLOWED_ORIGINS ??
          "http://localhost:3000,http://127.0.0.1:3000")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        const allowMissingOrigin = process.env.BROWSER_ALLOW_NO_ORIGIN === "true";
        if (!origin && !allowMissingOrigin) {
          done(false, 403, "Origin header required");
          return;
        }
        if (origin && !configured.includes(origin)) {
          done(false, 403, "Origin not allowed");
          return;
        }
        done(true);
      },
    });

    this.server.on("connection", (socket, request) => {
      const ip = request.socket.remoteAddress ?? "unknown";
      let authenticatedSessionId: string | undefined;
      let lastSequence = -1;

      this.send(socket, { version: 1, type: "hello", protocol: 1 });
      this.send(socket, { version: 1, type: "status", state: "connected" });

      socket.on("message", async (raw, isBinary) => {
        if (isBinary) {
          this.fail(socket, "binary_messages_not_supported", "Only JSON text messages are accepted.");
          socket.close(1003, "Text messages required");
          return;
        }

        const parsed = parseBrowserClientMessage(raw.toString());
        if (!parsed.ok) {
          this.fail(socket, parsed.reason, "Invalid browser protocol message.");
          return;
        }

        const message = parsed.message;
        if (message.type === "hello") {
          this.send(socket, { version: 1, type: "hello", protocol: 1 });
          return;
        }
        if (message.type === "ping") {
          this.send(socket, { version: 1, type: "pong", nonce: message.nonce });
          return;
        }
        if (message.type === "login") {
          if (authenticatedSessionId) {
            this.fail(socket, "already_authenticated", "This connection already has an authenticated account.");
            return;
          }
          if (!this.takeLoginAttempt(ip)) {
            this.fail(socket, "login_rate_limited", "Too many login attempts. Try again later.");
            socket.close(1008, "Login rate limit");
            return;
          }

          this.send(socket, { version: 1, type: "status", state: "authenticating" });
          try {
            const account = await this.authenticator.authenticate(message.username, message.password);
            authenticatedSessionId = account.sessionId;
            this.authenticatedSockets.set(socket, account.sessionId);
            this.send(socket, { version: 1, type: "status", state: "authenticated" });
            this.send(socket, {
              version: 1,
              type: "event",
              name: "account-authenticated",
              payload: {
                accountId: account.accountId,
                username: account.username,
                displayName: account.displayName,
                level: account.level,
              },
            });
            // Deliberately do not claim the player is in a world: the current
            // growtopia.js API has no supported virtual-peer transport adapter.
            this.fail(socket, "game_session_unavailable", "Account verified. Browser gameplay is not enabled until a real GrowServer player-session adapter is installed.");
          } catch (error) {
            const code = error instanceof Error ? error.message : "invalid_credentials";
            const allowed = new Set([
              "invalid_credentials",
              "account_in_use_by_native_client",
              "account_already_in_use",
            ]);
            this.fail(
              socket,
              allowed.has(code) ? code : "authentication_failed",
              code === "account_in_use_by_native_client"
                ? "This account is already connected with the native game client."
                : code === "account_already_in_use"
                  ? "This account already has a browser session."
                  : "Unable to authenticate this account.",
            );
          }
          return;
        }

        if (!authenticatedSessionId) {
          this.fail(socket, "authentication_required", "Log in before sending gameplay messages.");
          return;
        }

        if (message.type === "input" || message.type === "interact") {
          if (message.sequence <= lastSequence) {
            this.fail(socket, "stale_sequence", "Input sequence must increase.");
            return;
          }
          lastSequence = message.sequence;
        }

        // Never mutate the world from browser messages until these messages can
        // be routed through the real server-owned Peer/action lifecycle.
        this.fail(socket, "game_session_unavailable", "No real browser game session is attached to this connection.");
      });

      socket.on("close", () => {
        const sessionId = this.authenticatedSockets.get(socket);
        if (sessionId) {
          this.authenticator.release(sessionId);
          this.authenticatedSockets.delete(socket);
        }
      });
      socket.on("error", (error) => logger.warn(`Browser gateway socket error: ${error.message}`));
    });

    this.server.on("listening", () => {
      logger.info(`Browser WebSocket gateway listening on ws://${host}:${port}/browser`);
    });
    this.server.on("error", (error) => {
      logger.error(`Browser WebSocket gateway failed: ${error.message}`);
    });
  }

  private takeLoginAttempt(ip: string): boolean {
    const now = Date.now();
    const entry = this.loginLimits.get(ip);
    if (!entry || now - entry.startedAt >= WINDOW_MS) {
      this.loginLimits.set(ip, { startedAt: now, attempts: 1 });
      return true;
    }
    if (entry.attempts >= MAX_LOGIN_ATTEMPTS) return false;
    entry.attempts += 1;
    return true;
  }

  private send(socket: WebSocket, message: Parameters<typeof serializeBrowserServerMessage>[0]): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(serializeBrowserServerMessage(message));
    }
  }

  private fail(socket: WebSocket, code: string, message: string): void {
    this.send(socket, { version: 1, type: "error", code, message });
  }

  close(): Promise<void> {
    for (const [socket, sessionId] of this.authenticatedSockets) {
      this.authenticator.release(sessionId);
      socket.close(1001, "Server shutting down");
    }
    this.authenticatedSockets.clear();
    return new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
