import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";

import { BrowserSessionRegistry } from "../../../packages/browser-protocol/src/session-registry.ts";
import { BrowserAccountAuthenticator } from "../src/browser/AccountAuthenticator.ts";
import type { Base } from "../src/core/Base.ts";

async function fixture(options: { nativeOnline?: boolean } = {}) {
  const passwordHash = await bcrypt.hash("test-password", 4);
  const player = {
    id: 42,
    name: "test_growid",
    display_name: "Test GrowID",
    password: passwordHash,
    level: 7,
  };
  const base = {
    database: {
      players: {
        get: async (username: string) =>
          username === player.name ? player : undefined,
      },
    },
    cache: {
      peers: {
        find: (predicate: (peer: { userID: number }) => boolean) =>
          options.nativeOnline && predicate({ userID: player.id })
            ? { userID: player.id }
            : undefined,
      },
    },
  } as unknown as Base;
  const registry = new BrowserSessionRegistry();
  return {
    player,
    registry,
    auth: new BrowserAccountAuthenticator(base, registry),
  };
}

test("browser authentication uses the existing password hash and claims the account", async () => {
  const { auth, registry, player } = await fixture();
  const account = await auth.authenticate(" TEST_GROWID ", "test-password");

  assert.equal(account.accountId, player.id);
  assert.equal(account.username, player.name);
  assert.equal(account.displayName, player.display_name);
  assert.equal(account.level, 7);
  assert.equal(registry.isAccountInUse(String(player.id)), true);
  assert.equal("password" in account, false);
  assert.equal("sessionId" in account, true);
});

test("browser authentication rejects incorrect passwords and unknown accounts", async () => {
  const { auth } = await fixture();
  await assert.rejects(
    auth.authenticate("test_growid", "wrong-password"),
    /invalid_credentials/,
  );
  await assert.rejects(
    auth.authenticate("not_found", "test-password"),
    /invalid_credentials/,
  );
});

test("browser authentication does not kick a native ENet session", async () => {
  const { auth, registry } = await fixture({ nativeOnline: true });
  await assert.rejects(
    auth.authenticate("test_growid", "test-password"),
    /account_in_use_by_native_client/,
  );
  assert.equal(registry.size, 0);
});

test("browser authentication rejects wildcard-like usernames", async () => {
  const { auth } = await fixture();
  await assert.rejects(auth.authenticate("%_abc", "test-password"), /invalid_credentials/);
});

test("releasing a browser session frees its account lease", async () => {
  const { auth, registry, player } = await fixture();
  const account = await auth.authenticate("test_growid", "test-password");
  assert.equal(auth.release(account.sessionId), true);
  assert.equal(registry.isAccountInUse(String(player.id)), false);
});
