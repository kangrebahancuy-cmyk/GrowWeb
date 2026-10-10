/**
 * Server-side adapter contract between browser transport and GrowServer.
 *
 * Implementations belong in the server process and must resolve player identity
 * from a validated login/session, never from fields sent by the browser.
 * These types do not implement authentication or mutate game state.
 */

export type BrowserSessionState =
  | "connected"
  | "authenticating"
  | "authenticated"
  | "in-world"
  | "closed";

export interface BrowserPlayerSnapshot {
  /** Server-assigned identity. Never accepted from client messages. */
  readonly playerId: string;
  readonly displayName: string;
  readonly worldName: string | null;
  readonly x: number;
  readonly y: number;
  readonly facing: "left" | "right";
  readonly level: number;
}

export interface BrowserWorldTileSnapshot {
  readonly x: number;
  readonly y: number;
  readonly foregroundId: number;
  readonly backgroundId: number;
  readonly flags: number;
}

export interface BrowserWorldSnapshot {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly BrowserWorldTileSnapshot[];
  readonly players: readonly BrowserPlayerSnapshot[];
}

/**
 * The authenticated server session is the only authority for player actions.
 * Implementations must apply the same permissions, cooldowns, inventory checks,
 * world bounds, and persistence rules as native-client actions.
 */
export interface AuthenticatedBrowserGameSession {
  readonly sessionId: string;
  readonly state: BrowserSessionState;
  readonly player: BrowserPlayerSnapshot | null;

  getWorldSnapshot(): Promise<BrowserWorldSnapshot | null>;
  move(input: {
    sequence: number;
    direction: "left" | "right" | "stop";
    jump: boolean;
  }): Promise<void>;
  interact(input: {
    sequence: number;
    x: number;
    y: number;
    interaction: "punch" | "place" | "collect";
    itemId?: number;
  }): Promise<void>;
  sendChat(text: string): Promise<void>;
  close(reason?: string): Promise<void>;
}

/**
 * Login credentials/tokens must be verified by the existing account system.
 * Do not implement this interface by constructing a Peer with a guessed netID.
 */
export interface BrowserSessionProvider {
  authenticate(input: {
    username: string;
    password: string;
  }): Promise<AuthenticatedBrowserGameSession>;
}

/**
 * A future gateway can depend on this narrow interface and remain decoupled
 * from the WebSocket implementation. It is intentionally not wired to the
 * current ENet Peer yet; that integration needs a real server-owned session.
 */
