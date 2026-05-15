(function () {
  "use strict";

  const SAVE_KEY = "dead-zone-gps-save-v1";

  const state = {
    gps: null,
    origin: null,
    player: { x: 0, y: 0, lat: null, lon: null, hp: 100, supplies: 0 },
    caches: [],
    dangers: [],
    logs: [],
    fakeMode: false,
    running: false,
    startedAt: Date.now(),
    lastTick: Date.now(),
    map: null
  };

  const els = {};
  let canvas, ctx;

  function log(msg) {
    state.logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    state.logs = state.logs.slice(0, 8);
    renderHud();
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function polarPoint(radiusMin, radiusMax) {
    const angle = rand(0, Math.PI * 2);
    const radius = rand(radiusMin, radiusMax);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    };
  }

  function generateWorld() {
    state.caches = Array.from({ length: 10 }, (_, i) => ({
      id: "cache-" + i,
      ...polarPoint(80, 650),
      collected: false
    }));

    state.dangers = Array.from({ length: 5 }, (_, i) => ({
      id: "danger-" + i,
      ...polarPoint(120, 750),
      radius: rand(35, 95)
    }));

    log("Dead zone generated.");
  }

  function collectNearby() {
    for (const cache of state.caches) {
      if (!cache.collected && dist(state.player, cache) <= 25) {
        cache.collected = true;
        state.player.supplies += 1;
        state.player.hp = Math.min(100, state.player.hp + 8);
        log("Supply cache recovered.");
      }
    }
  }

  function applyDanger(dt) {
    for (const zone of state.dangers) {
      zone.radius += dt * 0.0015;

      if (dist(state.player, zone) <= zone.radius) {
        state.player.hp = Math.max(0, state.player.hp - dt * 0.006);
      }
    }

    if (state.player.hp <= 0 && state.running) {
      state.running = false;
      log("You collapsed in the dead zone.");
    }
  }

  function update(dt) {
    if (!state.running) return;
    collectNearby();
    applyDanger(dt);
    save();
  }

  function draw() {
    CanvasMap.clearCanvas(ctx, canvas, "#08100d");

    const points = [
      { x: state.player.x, y: state.player.y },
      ...state.caches.filter(c => !c.collected),
      ...state.dangers
    ];

    if (state.map.autoFit) CanvasMap.autoFit(points, canvas, state.map, 70, 0.25, 8);

    for (const zone of state.dangers) {
      const s = CanvasMap.worldToScreen(zone, state.map);
      ctx.beginPath();
      ctx.arc(s.x, s.y, zone.radius * state.map.zoom, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 40, 40, 0.18)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 80, 80, 0.65)";
      ctx.stroke();
    }

    for (const cache of state.caches) {
      if (cache.collected) continue;
      const s = CanvasMap.worldToScreen(cache, state.map);
      CanvasMap.drawPickup(ctx, s.x, s.y, 25 * state.map.zoom, "rgb(255,204,68)", "📦");
    }

    const p = CanvasMap.worldToScreen(state.player, state.map);
    CanvasMap.drawPlayerDot(ctx, p.x, p.y, null, "#41f0a0", 9);
    CanvasMap.drawNorth(ctx, canvas);
    CanvasMap.drawScale(ctx, canvas, state.map);
  }

  function renderHud() {
    els.hp.textContent = Math.round(state.player.hp);
    els.supplies.textContent = state.player.supplies;
    els.mode.textContent = state.fakeMode ? "Fake walk" : "GPS";
    els.accuracy.textContent = state.gps?.accuracy ? Math.round(state.gps.accuracy) + "m" : "--";
    els.log.innerHTML = state.logs.map(x => `<div>${x}</div>`).join("");
  }

  function loop() {
    const now = Date.now();
    const dt = now - state.lastTick;
    state.lastTick = now;
    update(dt);
    draw();
    renderHud();
    requestAnimationFrame(loop);
  }

  function fakeMove(dx, dy) {
    state.fakeMode = true;
    state.player.x += dx;
    state.player.y += dy;
  }

  function save() {
    const playerForSave = { ...state.player, lat: null, lon: null };
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      player: playerForSave,
      caches: state.caches,
      dangers: state.dangers,
      logs: state.logs,
      startedAt: state.startedAt
    }));
  }

  function load() {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;

    try {
      const saved = JSON.parse(raw);
      Object.assign(state.player, saved.player || {});
      state.caches = saved.caches || [];
      state.dangers = saved.dangers || [];
      state.logs = saved.logs || [];
      state.startedAt = saved.startedAt || Date.now();
      return true;
    } catch {
      return false;
    }
  }

  function reset() {
    localStorage.removeItem(SAVE_KEY);
    state.player = { x: 0, y: 0, lat: null, lon: null, hp: 100, supplies: 0 };
    state.map.autoFit = true;
    generateWorld();
    state.running = true;
    log("New run started.");
  }

  function initGps() {
    if (!window.GPS || !navigator.geolocation) {
      log("GPS unavailable. Use fake walk mode.");
      return;
    }

    navigator.geolocation.watchPosition(
      pos => {
        state.gps = pos.coords;

        if (!state.origin) {
          state.origin = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude
          };
          state.player.lat = pos.coords.latitude;
          state.player.lon = pos.coords.longitude;
          log("GPS locked.");
          return;
        }

        const metersPerLat = 111320;
        const metersPerLon = 111320 * Math.cos(state.origin.lat * Math.PI / 180);

        state.player.x = (pos.coords.longitude - state.origin.lon) * metersPerLon;
        state.player.y = -(pos.coords.latitude - state.origin.lat) * metersPerLat;
        state.player.lat = pos.coords.latitude;
        state.player.lon = pos.coords.longitude;
      },
      err => log("GPS error: " + err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }

  function bind() {
    els.hp = document.getElementById("hp");
    els.supplies = document.getElementById("supplies");
    els.mode = document.getElementById("mode");
    els.accuracy = document.getElementById("accuracy");
    els.log = document.getElementById("log");

    document.getElementById("reset").addEventListener("click", reset);
    document.getElementById("autofit").addEventListener("click", () => state.map.autoFit = true);

    document.addEventListener("keydown", e => {
      const step = e.shiftKey ? 30 : 12;
      if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") fakeMove(0, -step);
      if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") fakeMove(0, step);
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") fakeMove(-step, 0);
      if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") fakeMove(step, 0);
    });
  }

  function init() {
    canvas = document.getElementById("map");
    ctx = canvas.getContext("2d");
    state.map = CanvasMap.createState();

    bind();

    CanvasMap.resizeToWrapper(canvas, document.getElementById("map-wrap"), draw);
    window.addEventListener("resize", () => CanvasMap.resizeToWrapper(canvas, document.getElementById("map-wrap"), draw));
    CanvasMap.addInteraction(canvas, state.map, draw);

    if (!load()) generateWorld();

    state.running = true;
    initGps();
    log("Use WASD/arrows on desktop. Walk outside on mobile.");
    loop();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
