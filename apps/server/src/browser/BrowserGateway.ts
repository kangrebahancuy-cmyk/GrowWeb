import { BrowserSessionRegistry, parseBrowserClientMessage, serializeBrowserServerMessage } from "@growserver/browser-protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { Base } from "../core/Base";
import type { PeerData } from "@growserver/types";
import { Peer } from "../core/Peer";
import { Input } from "../network/actions/Input";
import { BrowserPeerTransportRegistry } from "./BrowserPeerTransportRegistry";
import { BrowserAccountAuthenticator } from "./AccountAuthenticator";
import { getBrowserWorldSnapshot } from "./BrowserWorldSnapshot";
import logger from "@growserver/logger";

export class BrowserGateway {
  private readonly server: WebSocketServer;
  private readonly auth: BrowserAccountAuthenticator;
  private readonly registry = new BrowserSessionRegistry();
  private readonly sessions = new Map<WebSocket, string>();
  private readonly peers = new Map<WebSocket, Peer>();
  private nextVirtualNetID = 1_000_000;
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
      verifyClient:      (info, done) => {
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
        if (msg.type === "world") {
          const peer = this.peers.get(socket);
          if (!sessionId || !peer) return this.fail(socket, "authentication_required", "Log in before entering a world.");
          try {
            const snapshot = await getBrowserWorldSnapshot(base, msg.name);
            if (!snapshot) return this.fail(socket, "world_not_found_or_invalid", "That world does not exist or its map data is invalid.");
            if (peer.data.world !== "EXIT") peer.leaveWorld();
            await peer.enterWorld(snapshot.name);
            this.send(socket, { version: 1, type: "status", state: "in-world" });
            this.send(socket, {
              version: 1,
              type:    "event",
              name:    "world-snapshot",
              payload: { snapshot },
            });
          } catch (error) {
            logger.warn(`Browser world entry failed: ${error instanceof Error ? error.message : String(error)}`);
            this.fail(socket, "world_entry_failed", "Unable to enter that world right now.");
          }
          return;
        }
        if (msg.type === "chat") {
          const peer = this.peers.get(socket);
          if (!sessionId || !peer) return this.fail(socket, "authentication_required", "Log in first.");
          if (peer.data.world === "EXIT") return this.fail(socket, "not_in_world", "Enter a world before chatting.");
          try {
            await new Input(base, peer).execute({ text: msg.text });
          } catch (error) {
            logger.warn(`Browser chat action failed: ${error instanceof Error ? error.message : String(error)}`);
            this.fail(socket, "chat_failed", "Unable to send that chat message.");
          }
          return;
        }
        if (msg.type !== "login") {
          return this.fail(socket, sessionId ? "gameplay_action_unavailable" : "authentication_required",
            sessionId ? "Movement and tile interactions remain disabled until server-authoritative validation is implemented." : "Log in first.");
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
          const peer = await this.createVirtualPeer(base, socket, account.username);
          sessionId = account.sessionId;
          this.sessions.set(socket, sessionId);
          this.peers.set(socket, peer);
          this.send(socket, { version: 1, type: "status", state: "authenticated" });
          this.send(socket, {
            version: 1,
            type:    "event",
            name:    "account-authenticated",
            payload: {
              accountId:   account.accountId,
              username:    account.username,
              displayName: account.displayName,
              level:       account.level,
              netID:       peer.data.netID,
            },
          });
        } catch (error) {
          const code = error instanceof Error ? error.message : "invalid_credentials";
          const safe = ["invalid_credentials", "account_in_use_by_native_client", "account_already_in_use"].includes(code) ? code : "authentication_failed";
          this.fail(socket, safe, safe === "account_in_use_by_native_client" ? "Account is active in the native client." : "Unable to authenticate this account.");
        }
      });
      socket.on("close", () => {
        void this.closeVirtualPeer(socket);
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

  private async createVirtualPeer(base: Base, socket: WebSocket, username: string): Promise<Peer> {
    const player = await base.database.players.get(username);
    if (!player) throw new Error("invalid_credentials");

    let netID = this.nextVirtualNetID++;
    while (base.cache.peers.has(netID) || BrowserPeerTransportRegistry.has(netID)) {
      netID = this.nextVirtualNetID++;
    }

    const parseStoredJson = <T,>(value: unknown, fallback: T): T => {
      if (value === undefined || value === null || value === "") return fallback;
      try {
        const serialized = Buffer.isBuffer(value) ? value.toString() : String(value);
        return JSON.parse(serialized) as T;
      } catch {
        return fallback;
      }
    };

    const data: PeerData = {
      channelID:        0,
      x:                0,
      y:                0,
      world:            "EXIT",
      inventory:        parseStoredJson(player.inventory, { max: 32, items: [{ id: 18, amount: 1 }, { id: 32, amount: 1 }] }),
      rotatedLeft:      false,
      name:             player.name,
      displayName:      player.display_name,
      netID,
      country:          "ID",
      platformID:       "browser",
      userID:           player.id,
      role:             player.role,
      gems:             player.gems ?? 0,
      clothing:         parseStoredJson(player.clothing, { hair: 0, shirt: 0, pants: 0, feet: 0, face: 0, hand: 0, back: 0, mask: 0, necklace: 0, ances: 0 }),
      exp:              player.exp ?? 0,
      level:            player.level ?? 0,
      lastVisitedWorlds: parseStoredJson(player.last_visited_worlds, []),
      state:            { mod: 0, canWalkInBlocks: false, modsEffect: 0, isGhost: false, lava: { damage: 0, resetStateAt: 0 } },
      heartMonitors:    new Map(Object.entries(parseStoredJson<Record<string, number[]>>(player.heart_monitors, {}))),
    };

    base.cache.peers.set(netID, data);
    const peer = new Peer(base, netID);
    BrowserPeerTransportRegistry.attach(netID, {
      send: (packet) => {
        if (socket.readyState === WebSocket.OPEN) {
          this.send(socket, {
            version: 1,
            type:    "event",
            name:    "game-packet",
            payload: { encoding: "base64", data: packet.toString("base64") },
          });
        }
      },
      disconnect: (code, reason) => {
        if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
      },
    });
    await peer.saveToCache();
    return peer;
  }

  private async closeVirtualPeer(socket: WebSocket): Promise<void> {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    try {
      if (peer.data.world !== "EXIT") peer.leaveWorld();
      await peer.saveToDatabase();
    } catch (error) {
      logger.warn(`Browser peer cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      BrowserPeerTransportRegistry.detach(peer.data.netID);
      peer.base.cache.peers.delete(peer.data.netID);
    }
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
