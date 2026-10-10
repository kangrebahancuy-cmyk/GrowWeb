/**
 * Versioned envelope for the future browser transport.
 *
 * This package deliberately contains no ENet bridge or game simulation.
 * A gateway must validate these messages and dispatch accepted operations
 * through an authenticated, real GrowServer player session.
 */

export const BROWSER_PROTOCOL_VERSION = 1 as const;
export const MAX_BROWSER_MESSAGE_BYTES = 16 * 1024;
export const MAX_CHAT_LENGTH = 160;
export const MAX_LOGIN_FIELD_LENGTH = 64;

export type BrowserClientMessage =
  | { version: 1; type: "hello"; client: "growserver-web"; }
  | { version: 1; type: "login"; username: string; password: string; }
  | { version: 1; type: "ping"; nonce: string; }
  | { version: 1; type: "world"; name: string; }
  | { version: 1; type: "chat"; text: string; }
  | {
      version: 1;
      type: "input";
      sequence: number;
      direction: "left" | "right" | "stop";
      jump: boolean;
    }
  | {
      version: 1;
      type: "interact";
      sequence: number;
      x: number;
      y: number;
      interaction: "punch" | "place" | "collect";
      itemId?: number;
    };

export type BrowserServerMessage =
  | { version: 1; type: "hello"; protocol: 1; }
  | { version: 1; type: "status"; state: "connected" | "authenticating" | "authenticated" | "in-world" | "disconnected"; }
  | { version: 1; type: "error"; code: string; message: string; }
  | { version: 1; type: "pong"; nonce: string; }
  | { version: 1; type: "event"; name: string; payload: Record<string, unknown>; };

export type ValidationResult =
  | { ok: true; message: BrowserClientMessage }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Parse and validate a text WebSocket message.
 * Binary WebSocket frames are intentionally not accepted by this JSON envelope.
 */
export function parseBrowserClientMessage(input: unknown): ValidationResult {
  let value: unknown = input;

  if (typeof input === "string") {
    if (BufferlessByteLength(input) > MAX_BROWSER_MESSAGE_BYTES) {
      return { ok: false, reason: "message_too_large" };
    }

    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
  }

  if (!isRecord(value)) return { ok: false, reason: "message_must_be_object" };
  if (value.version !== BROWSER_PROTOCOL_VERSION) {
    return { ok: false, reason: "unsupported_protocol_version" };
  }

  switch (value.type) {
    case "hello":
      if (value.client !== "growserver-web") return { ok: false, reason: "invalid_client" };
      return { ok: true, message: { version: 1, type: "hello", client: "growserver-web" } };

    case "login": {
      if (
        typeof value.username !== "string" ||
        value.username.trim().length < 3 ||
        value.username.trim().length > MAX_LOGIN_FIELD_LENGTH ||
        typeof value.password !== "string" ||
        value.password.length < 1 ||
        value.password.length > MAX_LOGIN_FIELD_LENGTH
      ) {
        return { ok: false, reason: "invalid_credentials_shape" };
      }
      return {
        ok: true,
        message: {
          version: 1,
          type: "login",
          username: value.username.trim(),
          password: value.password,
        },
      };
    }

    case "ping":
      if (typeof value.nonce !== "string" || value.nonce.length < 1 || value.nonce.length > 64) {
        return { ok: false, reason: "invalid_nonce" };
      }
      return { ok: true, message: { version: 1, type: "ping", nonce: value.nonce } };

    case "world": {
      if (typeof value.name !== "string" || !/^[a-zA-Z0-9]{1,24}$/.test(value.name)) {
        return { ok: false, reason: "invalid_world_name" };
      }
      return { ok: true, message: { version: 1, type: "world", name: value.name.toUpperCase() } };
    }

    case "chat":
      if (typeof value.text !== "string" || value.text.trim().length === 0 || value.text.length > MAX_CHAT_LENGTH) {
        return { ok: false, reason: "invalid_chat_text" };
      }
      return { ok: true, message: { version: 1, type: "chat", text: value.text.trim() } };

    case "input":
      if (!isSafeInteger(value.sequence) || value.sequence < 0) return { ok: false, reason: "invalid_sequence" };
      if (value.direction !== "left" && value.direction !== "right" && value.direction !== "stop") {
        return { ok: false, reason: "invalid_direction" };
      }
      if (typeof value.jump !== "boolean") return { ok: false, reason: "invalid_jump" };
      return {
        ok: true,
        message: { version: 1, type: "input", sequence: value.sequence, direction: value.direction, jump: value.jump },
      };

    case "interact":
      if (!isSafeInteger(value.sequence) || value.sequence < 0) return { ok: false, reason: "invalid_sequence" };
      if (!isSafeInteger(value.x) || value.x < 0 || value.x > 255 || !isSafeInteger(value.y) || value.y < 0 || value.y > 255) {
        return { ok: false, reason: "invalid_tile_coordinates" };
      }
      if (value.interaction !== "punch" && value.interaction !== "place" && value.interaction !== "collect") {
        return { ok: false, reason: "invalid_interaction" };
      }
      if (value.itemId !== undefined && (!isSafeInteger(value.itemId) || value.itemId < 0 || value.itemId > 65535)) {
        return { ok: false, reason: "invalid_item_id" };
      }
      return {
        ok: true,
        message: {
          version: 1,
          type: "interact",
          sequence: value.sequence,
          x: value.x,
          y: value.y,
          interaction: value.interaction,
          ...(value.itemId === undefined ? {} : { itemId: value.itemId }),
        },
      };

    default:
      return { ok: false, reason: "unknown_message_type" };
  }
}

/** Avoid depending on Node Buffer so this validator can also be bundled for browser use. */
function BufferlessByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function serializeBrowserServerMessage(message: BrowserServerMessage): string {
  return JSON.stringify(message);
}

export type {
  AuthenticatedBrowserGameSession,
  BrowserPlayerSnapshot,
  BrowserSessionProvider,
  BrowserSessionState,
  BrowserWorldSnapshot,
  BrowserWorldTileSnapshot,
} from "./session";

export { BrowserSessionRegistry } from "./session-registry";
export type { SessionClaim } from "./session-registry";
