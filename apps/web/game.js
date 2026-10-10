(() => {
  "use strict";
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const coordsEl = document.getElementById("coords");
  const toastEl = document.getElementById("toast");
  const hotbar = document.getElementById("hotbar");
  const TILE = 32, WORLD_W = 150, WORLD_H = 46;
  const blocks = [
    { name: "Grass", top: "#75c95d", side: "#94613d", dark: "#6d452d" },
    { name: "Dirt", top: "#a36e45", side: "#895632", dark: "#684027" },
    { name: "Stone", top: "#a4afbd", side: "#778494", dark: "#5b6574" },
    { name: "Wood", top: "#bd874d", side: "#996333", dark: "#6f4729" },
    { name: "Glass", top: "#a5f0f0a8", side: "#70cbd6a8", dark: "#d0ffff" }
  ];
  let world = [], selected = 0, cameraX = 0, cameraY = 0, lastTime = 0, toastTimer = 0;
  let viewW = 900, viewH = 480, dpr = 1;
  const keys = new Set(), touch = { left: false, right: false, jump: false };
  const player = { x: 7 * TILE, y: 10 * TILE, w: 21, h: 29, vx: 0, vy: 0, grounded: false, facing: 1 };
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function notify(message) {
    toastEl.textContent = message;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
  }
  function makeWorld() {
    world = Array.from({ length: WORLD_H }, () => Array(WORLD_W).fill(-1));
    for (let x = 0; x < WORLD_W; x++) {
      const ground = Math.floor(28 + Math.sin(x * .13) * 2 + Math.sin(x * .047) * 3);
      for (let y = ground; y < WORLD_H; y++) {
        world[y][x] = y === ground ? 0 : y < ground + 4 ? 1 : 2;
      }
      if (x % 13 === 4 && x > 3 && x < WORLD_W - 3) {
        for (let y = ground - 1; y > ground - 4; y--) world[y][x] = 3;
        for (let ox = -2; ox <= 2; ox++) for (let oy = -5; oy <= -3; oy++) {
          const tx = x + ox, ty = ground + oy;
          if (tx >= 0 && tx < WORLD_W && ty >= 0 && ty < WORLD_H && Math.abs(ox) + Math.abs(oy + 4) < 4) world[ty][tx] = 0;
        }
      }
    }
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = Math.max(1, rect.width); viewH = Math.max(1, rect.height);
    canvas.width = Math.round(viewW * dpr); canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function solidAt(px, py) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    return tx < 0 || tx >= WORLD_W || ty >= WORLD_H || (ty >= 0 && world[ty][tx] >= 0);
  }
  function movePlayer(dt) {
    const left = keys.has("ArrowLeft") || keys.has("a") || touch.left;
    const right = keys.has("ArrowRight") || keys.has("d") || touch.right;
    const jump = keys.has(" ") || keys.has("ArrowUp") || keys.has("w") || touch.jump;
    const speed = 190;
    player.vx = (right ? 1 : 0) - (left ? 1 : 0);
    player.vx *= speed;
    if (player.vx) player.facing = Math.sign(player.vx);
    if (jump && player.grounded) { player.vy = -440; player.grounded = false; }
    player.vy = Math.min(650, player.vy + 1150 * dt);
    let nx = player.x + player.vx * dt;
    if (player.vx > 0 && (solidAt(nx + player.w, player.y + 3) || solidAt(nx + player.w, player.y + player.h - 3))) nx = Math.floor((nx + player.w) / TILE) * TILE - player.w - .1;
    if (player.vx < 0 && (solidAt(nx, player.y + 3) || solidAt(nx, player.y + player.h - 3))) nx = (Math.floor(nx / TILE) + 1) * TILE + .1;
    player.x = clamp(nx, 0, WORLD_W * TILE - player.w);
    let ny = player.y + player.vy * dt;
    player.grounded = false;
    if (player.vy > 0 && (solidAt(player.x + 2, ny + player.h) || solidAt(player.x + player.w - 2, ny + player.h))) {
      ny = Math.floor((ny + player.h) / TILE) * TILE - player.h - .1; player.vy = 0; player.grounded = true;
    } else if (player.vy < 0 && (solidAt(player.x + 2, ny) || solidAt(player.x + player.w - 2, ny))) {
      ny = (Math.floor(ny / TILE) + 1) * TILE + .1; player.vy = 0;
    }
    player.y = clamp(ny, -TILE * 2, WORLD_H * TILE);
  }
  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, viewH);
    sky.addColorStop(0, "#7ac8eb"); sky.addColorStop(.7, "#c5e8e7"); sky.addColorStop(1, "#f4d7a5");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, viewW, viewH);
    ctx.fillStyle = "#fff5c7"; ctx.beginPath(); ctx.arc(viewW * .79, viewH * .19, 29, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff75";
    for (let i = 0; i < 5; i++) {
      const x = ((i * 227 - cameraX * .18) % (viewW + 150) + viewW + 150) % (viewW + 150) - 70;
      const y = 55 + (i % 3) * 48;
      ctx.beginPath(); ctx.ellipse(x, y, 34, 9, 0, 0, Math.PI * 2); ctx.ellipse(x + 15, y - 7, 20, 13, 0, 0, Math.PI * 2); ctx.ellipse(x + 31, y, 25, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#8ec9a2";
    for (let i = 0; i < 9; i++) {
      const x = ((i * 155 - cameraX * .32) % (viewW + 180) + viewW + 180) % (viewW + 180) - 80;
      ctx.beginPath(); ctx.ellipse(x, viewH * .69 + (i % 3) * 12, 100, 54, 0, Math.PI, Math.PI * 2); ctx.fill();
    }
  }
  function drawTile(id, sx, sy) {
    const b = blocks[id] || blocks[1];
    ctx.fillStyle = b.side; ctx.fillRect(sx, sy, TILE, TILE);
    ctx.fillStyle = b.top; ctx.fillRect(sx, sy, TILE, 6);
    ctx.fillStyle = b.dark; ctx.globalAlpha = .25; ctx.fillRect(sx + TILE - 4, sy, 4, TILE); ctx.fillRect(sx, sy + TILE - 4, TILE, 4); ctx.globalAlpha = 1;
    if (id === 0) {
      ctx.fillStyle = "#a2e77c"; ctx.fillRect(sx + 4, sy + 2, 5, 2); ctx.fillRect(sx + 19, sy + 1, 4, 2);
    } else if (id === 2) {
      ctx.fillStyle = "#ffffff25"; ctx.fillRect(sx + 6, sy + 11, 7, 3); ctx.fillRect(sx + 20, sy + 23, 5, 3);
    } else if (id === 3) {
      ctx.fillStyle = "#e0ac70"; ctx.fillRect(sx + 7, sy + 9, 2, 14); ctx.fillRect(sx + 22, sy + 8, 2, 16);
    } else if (id === 4) {
      ctx.strokeStyle = "#d8ffff"; ctx.lineWidth = 1; ctx.strokeRect(sx + 4, sy + 4, TILE - 8, TILE - 8);
    }
  }
  function drawPlayer() {
    const x = Math.round(player.x - cameraX), y = Math.round(player.y - cameraY);
    ctx.save(); ctx.translate(x + player.w / 2, y);
    // Shadow
    ctx.fillStyle = "#1c40534a"; ctx.beginPath(); ctx.ellipse(0, player.h + 2, 15, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3c4b70"; ctx.fillRect(-10, 17, 9, 11); ctx.fillRect(1, 17, 9, 11);
    ctx.fillStyle = "#f1bc8c"; ctx.fillRect(-10, 2, 20, 17);
    ctx.fillStyle = "#61433c"; ctx.fillRect(-11, 0, 22, 6); ctx.fillRect(-11, 3, 4, 7);
    ctx.fillStyle = "#27344a"; ctx.fillRect(player.facing > 0 ? 3 : -7, 8, 3, 4);
    ctx.fillStyle = "#e8f3ff"; ctx.fillRect(-8, 19, 7, 9); ctx.fillRect(2, 19, 7, 9);
    ctx.restore();
  }
  function draw() {
    drawBackground();
    cameraX = clamp(player.x + player.w / 2 - viewW / 2, 0, WORLD_W * TILE - viewW);
    cameraY = clamp(player.y + player.h / 2 - viewH * .53, 0, WORLD_H * TILE - viewH);
    const x0 = Math.max(0, Math.floor(cameraX / TILE)), x1 = Math.min(WORLD_W - 1, Math.ceil((cameraX + viewW) / TILE));
    const y0 = Math.max(0, Math.floor(cameraY / TILE)), y1 = Math.min(WORLD_H - 1, Math.ceil((cameraY + viewH) / TILE));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (world[y][x] >= 0) drawTile(world[y][x], Math.floor(x * TILE - cameraX), Math.floor(y * TILE - cameraY));
    drawPlayer();
    coordsEl.textContent = `X ${Math.floor(player.x / TILE)} · Y ${Math.floor(player.y / TILE)}`;
  }
  function frame(time) {
    const dt = Math.min(.032, (time - (lastTime || time)) / 1000);
    lastTime = time; movePlayer(dt); draw(); requestAnimationFrame(frame);
  }
  function pointerTile(event) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor((event.clientX - r.left + cameraX) / TILE), y: Math.floor((event.clientY - r.top + cameraY) / TILE) };
  }
  function interact(event) {
    event.preventDefault();
    const p = pointerTile(event);
    if (p.x < 0 || p.x >= WORLD_W || p.y < 0 || p.y >= WORLD_H) return;
    const distance = Math.hypot((p.x + .5) * TILE - (player.x + player.w / 2), (p.y + .5) * TILE - (player.y + player.h / 2));
    if (distance > TILE * 6) { notify("That block is too far away."); return; }
    if (event.button === 2 || event.pointerType === "touch" && world[p.y][p.x] === -1) {
      if (world[p.y][p.x] >= 0) { notify("That tile is occupied."); return; }
      const bx = p.x * TILE, by = p.y * TILE;
      if (bx < player.x + player.w && bx + TILE > player.x && by < player.y + player.h && by + TILE > player.y) { notify("You cannot place a block inside yourself."); return; }
      world[p.y][p.x] = selected; notify(`${blocks[selected].name} placed.`);
    } else {
      if (world[p.y][p.x] === 0) { notify("Choose a block and tap an empty tile to build."); return; }
      world[p.y][p.x] = -1; notify("Block broken.");
    }
  }
  function selectSlot(index) {
    selected = clamp(index, 0, blocks.length - 1);
    hotbar.querySelectorAll(".slot").forEach((el, i) => {
      el.classList.toggle("selected", i === selected);
      el.setAttribute("aria-pressed", i === selected ? "true" : "false");
    });
  }
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", e => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (["ArrowLeft","ArrowRight","ArrowUp"," ","ArrowDown"].includes(key)) e.preventDefault();
    if (/^[1-5]$/.test(key)) selectSlot(Number(key) - 1);
    keys.add(key);
  });
  window.addEventListener("keyup", e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  window.addEventListener("blur", () => { keys.clear(); Object.keys(touch).forEach(k => touch[k] = false); });
  canvas.addEventListener("pointerdown", e => { canvas.focus({ preventScroll: true }); interact(e); });
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  hotbar.addEventListener("click", e => { const btn = e.target.closest("[data-slot]"); if (btn) selectSlot(Number(btn.dataset.slot)); });
  document.querySelectorAll("[data-key]").forEach(btn => {
    const key = btn.dataset.key;
    const start = e => { e.preventDefault(); touch[key] = true; if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId); };
    const stop = e => { e.preventDefault(); touch[key] = false; };
    btn.addEventListener("pointerdown", start); btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop); btn.addEventListener("lostpointercapture", stop);
  });
  document.getElementById("resetBtn").addEventListener("click", () => {
    makeWorld(); player.x = 7 * TILE; player.y = 10 * TILE; player.vx = player.vy = 0; notify("World reset. Have fun building!");
  });
  makeWorld(); resize(); selectSlot(0); requestAnimationFrame(frame);
})();
