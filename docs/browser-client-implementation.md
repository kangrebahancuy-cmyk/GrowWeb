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

- [ ] Define a transport-neutral session boundary around existing player/world operations.
- [ ] Add a WebSocket transport with strict message validation and lifecycle handling.
- [ ] Connect browser sessions to existing authentication and player state without bypassing server rules.
- [ ] Build a canvas/WebGL client that consumes real world and player state.
- [ ] Add local Windows launch instructions and smoke tests.
- [ ] Verify an end-to-end browser session against the existing GrowServer.

## Local development target

Use the repository's existing workspace and server setup instructions first. The first meaningful end-to-end acceptance test is: start the original server locally, open the browser client, authenticate a test account, enter an existing world, and observe server-authoritative player/world updates. A decorative client page or an isolated simulation does not satisfy this target.
