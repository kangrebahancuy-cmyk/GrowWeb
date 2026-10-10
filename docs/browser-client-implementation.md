# Browser Client Implementation Plan

## Goal

Make the existing GrowServer game playable from a modern web browser for local Windows testing. This work must reuse the existing server's player, world, item, inventory, and action logic; it must not replace the game with a separate tile sandbox.

## Current architecture confirmed in source

- `apps/server/src/core/Base.ts` creates the `growtopia.js` ENet server and loads item data.
- `apps/server/src/core/Peer.ts` wraps a server peer and exposes player/world operations.
- `apps/server/src/core/World.ts` owns world state and world operations.
- `apps/server/src/events/Raw.ts` dispatches incoming ENet packets to text, action, and tank packet handlers.
- `apps/server/src/network/Action.ts`, `Text.ts`, and `Tank.ts` dispatch protocol packets into existing server logic.
- The server currently listens on ENet (default port 17091); browser JavaScript cannot open a native ENet/UDP socket.

## Required architecture

1. **Transport adapter:** a server-side WebSocket endpoint for browser sessions. It must not pretend that WebSocket frames are ENet datagrams; it must explicitly translate and validate messages.
2. **Server integration:** route browser-originated actions through the same authenticated player and world logic used by the existing server. Do not duplicate game rules in a separate web-only simulation.
3. **Browser client:** render the real world/tile data, player state, inventory, and other-player updates; send movement, interaction, and chat input through the adapter.
4. **Assets:** provide browser-readable game assets and item metadata from a controlled local endpoint. Keep asset paths and licensing/source requirements documented.
5. **Security:** authenticate sessions, validate every browser message, rate-limit inputs, avoid exposing server internals, and keep secrets on the server.
6. **Local testing:** verify server startup, browser handshake, authentication, entering a world, receiving real world state, movement, and interaction in that order.

## Implementation constraints

- Do not add a fake world or standalone sandbox as a substitute for GrowServer.
- Do not claim browser playability until the browser client has been tested against the real server.
- Avoid changing the existing ENet path for native clients while the browser transport is developed.
- Keep browser transport optional so a local server can still run in its existing configuration.
- The current repository source has not yet been modified to add a functioning browser transport or game client. This document records the implementation boundary, not a completed feature.

## Milestones

- [x] Define the initial versioned browser message envelope and validation package (`packages/browser-protocol`).
- [x] Define the transport-neutral session contract (`packages/browser-protocol/src/session.ts`).
- [ ] Implement the contract against the existing authenticated GrowServer player/world lifecycle.
- [ ] Add a WebSocket transport with strict message validation and lifecycle handling.
- [ ] Connect browser sessions to existing authentication and player state without bypassing server rules.
- [ ] Build a canvas/WebGL client that consumes real world and player state.
- [ ] Add local Windows launch instructions and smoke tests.
- [ ] Verify an end-to-end browser session against the existing GrowServer.

## Local development target

Use the repository's existing workspace and server setup instructions first. The first meaningful end-to-end acceptance test is: start the original server locally, open the browser client, authenticate a test account, enter an existing world, and observe server-authoritative player/world updates. A decorative client page or an isolated simulation does not satisfy this target.

## Source inspection: login and transport constraints

The following details were verified from the current source:

- `packages/config/config.toml` currently sets `[web].address = "127.0.0.1"`, `[web].ports = [17091]`, and `[web].loginUrl = "login.growserver.app:8080"`.
- `apps/server/src/core/Base.ts` creates a `growtopia.js` `Client` configured as an ENet server and starts listening on its ENet port.
- `apps/server/src/events/Raw.ts` reads the first four bytes as a packet type, then dispatches STR/ACTION and TANK payloads to the existing handlers.
- `apps/server/src/network/Text.ts` handles both the login token and refresh-token path. The login-token path chooses a configured game port and emits `OnSendToServer` with the server address, port, player ID, and a generated token. The refresh-token path initializes the actual `PeerData`, loads the player inventory/clothing and saves the player to cache/database.
- `apps/server/src/network/Action.ts` routes parsed actions through `ActionMap`; `apps/server/src/network/Tank.ts` routes tank packets through `TankMap`.

### Consequence for a browser implementation

A raw WebSocket-to-ENet byte pipe is not enough to make this work. The login flow redirects the client to a selected game port, and the current handlers assume a real `growtopia.js` ENet peer. A browser adapter must preserve the authentication and player lifecycle while routing input through the existing action/tank handlers. It must not construct a fake `Peer` with a guessed network ID or bypass the server's player state.

Before coding the gateway, the next technical task is to inspect the exact `growtopia.js@2.1.7` client/server raw-event and send APIs, then define how a browser session maps to a real ENet peer across the login-to-game handoff. Only after that contract is known should an optional gateway package be added.

### Current status

This is source-analysis progress only. No browser transport, browser renderer, or end-to-end browser login has been implemented or tested yet.

## Transport library findings

Inspection of the upstream `StileDevs/growtopia.js` source and `StileDevs/GrowProxy` confirms that the library is a native ENet transport, not a browser WebSocket protocol. Its native host exposes peer connect/send/disconnect operations, while GrowProxy relays packet buffers between two ENet peers and explicitly handles `OnSendToServer` handoff. That is a useful reference for native-client proxying, but it does not provide browser-side ENet or a ready-made WebSocket game protocol.

This narrows the first implementation milestone: **do not create a generic WebSocket pipe and label it a game gateway**. The browser side needs a defined, versioned message envelope and the server needs an authenticated mapping from each browser session to the actual GrowServer player lifecycle. The current login code also chooses a game port from `config.web.ports`; a browser transport will need a deliberate policy for that handoff rather than assuming every login and gameplay packet remains on one socket.

The source repository and protocol constraints have been documented. The first code foundation now exists at `packages/browser-protocol`: versioned message types and validation for hello/ping/chat/input/interact messages. This package is only a contract; it is not a WebSocket server, does not authenticate users, does not create a real GrowServer peer, and does not yet route messages into game logic. The next blocker remains a transport-neutral session interface that maps a browser connection to an authenticated real player without guessing a netID or breaking native ENet clients.



## Progress update — browser protocol foundation

Implemented on `main`:

- `packages/browser-protocol/package.json`
- `packages/browser-protocol/src/index.ts`
- `packages/browser-protocol/README.md`

The protocol package defines a version-1 JSON envelope and rejects malformed/oversized messages, invalid login credential shapes, invalid chat lengths, invalid movement directions/sequences, out-of-range tile coordinates, unsupported interactions, and invalid item IDs. A `login` message now exists in the contract so a future gateway has a defined credential envelope; it does not authenticate credentials itself. Use HTTPS/WSS outside localhost so credentials are protected in transit. The validator is deliberately transport-only and does not mutate player/world state.

**Not implemented yet:** WebSocket server, authenticated session mapping, login/refresh-token handoff, actual game-state serialization, browser renderer/assets, or end-to-end tests. Do not use this package as evidence that the game is already playable in a browser.


## Progress update — session contract

Added `packages/browser-protocol/src/session.ts` and exported its types from the package entry point. The contract describes an authenticated server-owned session, player/world snapshots, movement, interactions, chat, and close lifecycle. The browser does not provide its own player ID.

This is an interface contract only. No implementation currently authenticates against the database, creates/owns a real ENet-backed player session, serializes the real world, or applies game actions. The WebSocket gateway remains pending; the next implementation must be wired to the existing server internals rather than simulate them.


## Progress update — login envelope

Added a validated `login` message to the shared protocol with bounded username/password fields. This only validates message shape; the server must still verify credentials against the existing account database, apply login throttling, and bind the authenticated identity to a server-owned session. Never log or echo passwords. The gateway and real gameplay integration are still not implemented.


## Progress update — single-process browser session lease

Added `packages/browser-protocol/src/session-registry.ts` and exported `BrowserSessionRegistry` from the protocol package. It provides a small in-memory claim/release primitive so one normalized server-side account key cannot be claimed by two browser sessions in the same process. Release is bound to the owning session ID, preventing an old connection from releasing a newer connection's claim.

**Important limitations:** this registry is not yet called by the GrowServer login flow; it does not verify credentials, coordinate with native ENet clients, survive restarts, or coordinate multiple server processes. It must only be claimed after database authentication. The production integration still needs an explicit browser-vs-native duplicate-login policy and cleanup on disconnect/timeout.

## Local validation status

No Windows machine or repository checkout is available to this change operation, so no `pnpm install`, TypeScript build, server start, browser handshake, or gameplay test has been run. The session registry should receive unit tests and a workspace type-check before being wired into the live server.


## Progress update — existing-account authentication adapter

Added `apps/server/src/browser/AccountAuthenticator.ts`. It looks up accounts through the existing `base.database.players.get()`, verifies the existing bcrypt hash, rejects invalid/wildcard-like usernames, and applies a conservative duplicate-login policy: if a native ENet peer already owns that account, browser login is rejected rather than kicking the native player. Successful browser authentication receives a server-generated session ID and an in-memory account lease. Passwords are not included in the returned account object.

Added tests in `apps/server/scripts/browser-auth.test.ts` and `apps/server/scripts/browser-protocol.test.ts`, invoked by:

```powershell
pnpm --filter server test:browser-protocol
```

The GitHub Actions workflow is `.github/workflows/browser-protocol.yml`. It was corrected to use the pnpm version already declared by the repository. The tests and build still need a passing CI result before they can be considered verified.

**Still not complete:** the authenticator is not wired to a WebSocket endpoint; the in-memory lease does not coordinate with other server processes or survive restarts; browser sessions are not native game peers; no world snapshot, movement, interaction, chat relay, renderer, or full Windows end-to-end test exists. In particular, do not expose this authenticator to the network until the WebSocket gateway adds origin checks, rate limiting, connection limits, and safe disconnect cleanup.
