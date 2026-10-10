import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserSessionRegistry,
  parseBrowserClientMessage,
} from "../../../packages/browser-protocol/src/index.ts";

test("browser protocol rejects malformed and oversized input", () => {
  assert.deepEqual(parseBrowserClientMessage("{"), {
    ok: false,
    reason: "invalid_json",
  });

  assert.deepEqual(
    parseBrowserClientMessage("x".repeat(16 * 1024 + 1)),
    { ok: false, reason: "message_too_large" },
  );
});

test("browser login envelope validates bounded credentials without authenticating", () => {
  assert.deepEqual(
    parseBrowserClientMessage(
      JSON.stringify({
        version: 1,
        type: "login",
        username: "  example ",
        password: "password",
      }),
    ),
    {
      ok: true,
      message: {
        version: 1,
        type: "login",
        username: "example",
        password: "password",
      },
    },
  );

  assert.deepEqual(
    parseBrowserClientMessage(
      JSON.stringify({
        version: 1,
        type: "login",
        username: "x",
        password: "",
      }),
    ),
    { ok: false, reason: "invalid_credentials_shape" },
  );
});

test("browser input and interaction reject invalid client values", () => {
  assert.deepEqual(
    parseBrowserClientMessage(
      JSON.stringify({
        version: 1,
        type: "input",
        sequence: -1,
        direction: "right",
        jump: false,
      }),
    ),
    { ok: false, reason: "invalid_sequence" },
  );

  assert.deepEqual(
    parseBrowserClientMessage(
      JSON.stringify({
        version: 1,
        type: "interact",
        sequence: 1,
        x: 256,
        y: 0,
        interaction: "punch",
      }),
    ),
    { ok: false, reason: "invalid_tile_coordinates" },
  );
});

test("session registry prevents duplicate claims and releases only its owner", () => {
  const registry = new BrowserSessionRegistry();

  assert.equal(registry.claim("player-db-id", "session-a").ok, true);
  assert.deepEqual(registry.claim("player-db-id", "session-b"), {
    ok: false,
    reason: "account_already_in_use",
  });

  assert.equal(registry.release("session-b"), false);
  assert.equal(registry.isAccountInUse("player-db-id"), true);
  assert.equal(registry.release("session-a"), true);
  assert.equal(registry.isAccountInUse("player-db-id"), false);
});

test("one session cannot claim two different accounts", () => {
  const registry = new BrowserSessionRegistry();

  assert.equal(registry.claim("account-a", "session-a").ok, true);
  assert.deepEqual(registry.claim("account-b", "session-a"), {
    ok: false,
    reason: "invalid_claim",
  });
  assert.equal(registry.getSessionForAccount("account-a"), "session-a");
  assert.equal(registry.getSessionForAccount("account-b"), undefined);
});
