import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { BrowserSessionRegistry } from "../../../packages/browser-protocol/src/session-registry";
import type { Base } from "../core/Base";

export interface BrowserAuthenticatedAccount {
  readonly sessionId: string;
  readonly accountId: number;
  readonly username: string;
  readonly displayName: string;
  readonly level: number;
}

/**
 * Reuses GrowServer's existing player database and bcrypt password hashes.
 *
 * This deliberately does not construct a growtopia.js Peer or claim that an
 * authenticated account is already in a world. The WebSocket/game-session
 * adapter must still be implemented against the server's real lifecycle.
 */
export class BrowserAccountAuthenticator {
  constructor(
    private readonly base: Base,
    private readonly registry: BrowserSessionRegistry,
  ) {}

  async authenticate(
    usernameInput: string,
    password: string,
  ): Promise<BrowserAuthenticatedAccount> {
    const username = usernameInput.trim().toLowerCase();

    // Prevent wildcard matching against PlayerDB.get(), which uses SQL LIKE.
    if (!/^[a-z0-9_]{3,18}$/.test(username)) {
      throw new Error("invalid_credentials");
    }
    if (typeof password !== "string" || password.length < 1 || password.length > 64) {
      throw new Error("invalid_credentials");
    }

    const player = await this.base.database.players.get(username);
    if (!player || !(await bcrypt.compare(password, player.password))) {
      throw new Error("invalid_credentials");
    }

    // Explicit policy: native ENet sessions take precedence; browser login
    // must not silently kick an existing Growtopia client.
    const nativePeer = this.base.cache.peers.find(
      (peer) => peer.userID === player.id,
    );
    if (nativePeer) {
      throw new Error("account_in_use_by_native_client");
    }

    const sessionId = randomUUID();
    const claim = this.registry.claim(String(player.id), sessionId);
    if (!claim.ok) {
      throw new Error("account_already_in_use");
    }

    return {
      sessionId,
      accountId: player.id,
      username: player.name,
      displayName: player.display_name,
      level: player.level ?? 0,
    };
  }

  release(sessionId: string): boolean {
    return this.registry.release(sessionId);
  }
}
