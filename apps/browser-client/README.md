# GrowWeb Browser Client (experimental)

This is a dependency-free static browser client for local development. It connects to the optional GrowWeb WebSocket gateway at `ws://127.0.0.1:8081/browser`, authenticates with an existing GrowWeb account, requests an existing world, and visualizes the real world snapshot returned by the server.

## Run on Windows

1. Start GrowWeb using the repository's own setup instructions and ensure the optional browser gateway is started.
2. From the repository root, serve this directory on port 3000 so its origin matches the gateway's default allowlist:

   ```powershell
   py -m http.server 3000 --directory apps/browser-client
   ```

3. Open `http://localhost:3000`.
4. Connect, sign in with a test account already in the GrowWeb database, then enter an existing world name.

If `py` is unavailable, use an equivalent static file server bound to port 3000. The gateway must be configured to allow `http://localhost:3000`.

## Current limits — not yet fully playable

- The map is sourced from the server's actual world snapshot, but tile colors and player shapes are diagnostic placeholders; the APK's RTTEX texture/sprite formats have not yet been decoded or mapped.
- Browser movement now routes through the existing GrowServer State handler, with server-side input sequencing/rate limiting and a conservative foreground-tile collision/gravity fallback. Clicking a tile invokes the existing TileChangeReq handler for punching; right-clicking invokes it for placing an item ID selected in the UI. This is an early adapter and needs end-to-end testing against real worlds: its collision fallback treats most foreground tiles as solid, jump/physics are simplified, and dropped-item collection is not implemented.
- Native outgoing packets are currently base64 events. A Growtopia packet decoder/state adapter and sprite renderer are still needed for animation, inventory, effects, and real-time entity updates.
- This remains an experimental browser client, not a completed conversion of the Android APK. Real textures, accurate player physics, complete packet decoding, item/inventory UI, drops, effects, and full end-to-end validation are still required before calling it fully playable.

## Next implementation milestones

1. Extract and catalog browser-usable textures/item metadata from the supplied `apkgt` repository.
2. Add protocol decoders for world/player/tank packets and verify them against the server version.
3. Implement server-authoritative movement, tile interaction, inventory, and player updates using existing GrowWeb action rules.
4. Test a full browser session end-to-end without changing the native ENet client path.
