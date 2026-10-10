# GrowWeb Browser Client

A dependency-free, browser-playable 2D tile sandbox prototype in `apps/web`. It is an initial web client experiment, not yet connected to the GrowServer ENet multiplayer backend.

## Run locally on Windows

Install Node.js 20 or newer, then from the repository root run:

```powershell
cd apps/web
node server.cjs
```

Open **http://localhost:4173** in your browser. No Docker, database, or package installation is required for this standalone prototype. You can also open `index.html` directly, although using the local server is recommended.

## Controls

- **A / D** or **← / →**: move
- **Space / W / ↑**: jump
- **1–5**: select a block
- **Left click**: break a block
- **Right click**: place the selected block
- On touch devices, use the on-screen movement/jump controls and tap tiles to interact.

The world is currently local and resets when the page reloads. It does not save accounts, inventory, or world edits and does not yet support multiplayer.

## Deploy as a static site to Vercel

Create a Vercel project from this repository and set **Root Directory** to `apps/web`. This app is static HTML/CSS/JavaScript, so it does not need a build command or environment variables. For local development, use the Node server above.

## Next integration stage

The existing GrowServer uses ENet/Growtopia protocol and server-side services. A browser cannot directly use its native ENet connection. Multiplayer requires a server-side WebSocket gateway/adapter that authenticates players and translates browser messages to validated game actions. That adapter must be implemented and secured before this client can connect to the actual server.
