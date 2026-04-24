/**
 * Territory Tap — app.js
 *
 * Core game logic for the Territory Tap MVP.
 * Everything runs in the browser; all persistence uses localStorage.
 * No external dependencies, no build step required.
 *
 * Architecture overview:
 *   State  – in-memory JS object mirrored to/from localStorage
 *   GPS    – browser Geolocation API (watchPosition / getCurrentPosition)
 *   Tiles  – latitude/longitude snapped to a configurable grid
 *   Score  – 10 pts per unique tile + 1 pt per revisit
 *   UI     – plain DOM manipulation; canvas draws the mini-map
 */

'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// Configuration
// ══════════════════════════════════════════════════════════════════════════════

/**
 * TILE_SIZE — how many degrees lat/lng each grid tile spans.
 * 0.001° ≈ ~111 m at the equator.  Decrease for a finer grid, increase to
 * make tiles larger and easier to walk between.
 */
var TILE_SIZE = 0.001;

/** localStorage key used to persist all game data. */
var STORAGE_KEY = 'territoryTapSave';

/** Points awarded for claiming a brand-new tile. */
var POINTS_NEW_TILE = 10;

/** Points awarded each time an already-owned tile is revisited. */
var POINTS_REVISIT = 1;

// ══════════════════════════════════════════════════════════════════════════════
// State
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The live game state.  This object is what gets serialized to localStorage.
 *
 * @typedef {Object} SaveData
 * @property {string} playerName
 * @property {Object.<string, TileRecord>} tiles
 *
 * @typedef {Object} TileRecord
 * @property {string} tileId
 * @property {string} claimedAt      – ISO timestamp of first claim
 * @property {string} lastVisitedAt  – ISO timestamp of most recent claim
 * @property {number} claimCount     – total times claimed (1 on first visit)
 */

/** @type {SaveData} */
var state = {
  playerName: 'Local Player',
  tiles: {}
};

/**
 * The player's current GPS position (null until first fix).
 * @type {{ lat: number, lng: number } | null}
 */
var currentPos = null;

/**
 * The tile ID derived from currentPos (null until first fix).
 * @type {string | null}
 */
var currentTileId = null;

/** Geolocation watchId so we can stop watching when needed. */
var watchId = null;

// ══════════════════════════════════════════════════════════════════════════════
// localStorage helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Load save data from localStorage into `state`.
 * Silently falls back to an empty save if nothing is stored yet.
 */
function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      // Merge carefully so we don't lose defaults for missing fields
      state.playerName = parsed.playerName || 'Local Player';
      state.tiles = parsed.tiles || {};
    }
  } catch (e) {
    console.warn('Territory Tap: failed to load save data', e);
  }
}

/**
 * Persist the current `state` to localStorage.
 */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Territory Tap: failed to save data', e);
    showError('Could not save – localStorage may be full or disabled.');
  }
}

/**
 * Wipe all saved data and reset `state` to defaults.
 */
function resetState() {
  state = { playerName: 'Local Player', tiles: {} };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Territory Tap: failed to remove save data', e);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Tile helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a GPS coordinate to a tile ID string.
 * Tiles are axis-aligned rectangles of TILE_SIZE degrees.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {string}  e.g. "37001:-122002"
 */
function latLngToTileId(lat, lng) {
  var tileX = Math.floor(lat / TILE_SIZE);
  var tileY = Math.floor(lng / TILE_SIZE);
  return tileX + ':' + tileY;
}

/**
 * Calculate the player's current score from the state.
 * 10 pts per unique tile + cumulative (claimCount - 1) revisit points.
 *
 * @returns {number}
 */
function calcScore() {
  var score = 0;
  Object.keys(state.tiles).forEach(function (id) {
    score += POINTS_NEW_TILE;                              // first claim
    score += (state.tiles[id].claimCount - 1) * POINTS_REVISIT; // revisits
  });
  return score;
}

// ══════════════════════════════════════════════════════════════════════════════
// Geolocation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Start watching the player's position.
 * Updates currentPos + currentTileId on every GPS fix.
 */
function startWatching() {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by this browser.');
    return;
  }

  // Clear any previous watch
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
  }

  watchId = navigator.geolocation.watchPosition(
    onPositionSuccess,
    onPositionError,
    {
      enableHighAccuracy: true,
      maximumAge: 5000,   // accept cached fixes up to 5 s old
      timeout: 15000      // give up after 15 s if no fix
    }
  );
}

/**
 * Fallback: request a single position fix (useful when the user taps the
 * "Get Current Location" button explicitly).
 */
function getPositionOnce() {
  if (!navigator.geolocation) {
    showError('Geolocation is not supported by this browser.');
    return;
  }

  hideError();
  document.getElementById('gps-coords').textContent = 'Acquiring location…';

  navigator.geolocation.getCurrentPosition(
    onPositionSuccess,
    onPositionError,
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

/**
 * Called whenever a new GPS fix arrives.
 * @param {GeolocationPosition} position
 */
function onPositionSuccess(position) {
  var lat = position.coords.latitude;
  var lng = position.coords.longitude;
  var acc = position.coords.accuracy;       // metres

  currentPos    = { lat: lat, lng: lng };
  currentTileId = latLngToTileId(lat, lng);

  // Update coordinate display
  document.getElementById('gps-coords').textContent =
    'Lat: ' + lat.toFixed(6) + '  Lng: ' + lng.toFixed(6) +
    '  (±' + Math.round(acc) + ' m)';

  // Enable the Claim button now that we have a position
  document.getElementById('btn-claim').disabled = false;

  hideError();
  renderUI();
}

/**
 * Called when geolocation fails.
 * @param {GeolocationPositionError} err
 */
function onPositionError(err) {
  var msg;
  switch (err.code) {
    case err.PERMISSION_DENIED:
      msg = '❌ Location permission denied. Please allow location access and try again.';
      break;
    case err.POSITION_UNAVAILABLE:
      msg = '⚠️ Location unavailable. Check your device GPS.';
      break;
    case err.TIMEOUT:
      msg = '⏱️ Location request timed out. Tap "Get Current Location" to retry.';
      break;
    default:
      msg = '❓ Unknown location error: ' + err.message;
  }
  showError(msg);
  document.getElementById('gps-coords').textContent = 'No location fix.';
}

// ══════════════════════════════════════════════════════════════════════════════
// Game actions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Claim or revisit the current tile.
 * - First visit: creates a new TileRecord with claimCount = 1.
 * - Revisit: increments claimCount and updates lastVisitedAt.
 */
function claimCurrentTile() {
  if (!currentTileId) {
    showError('No GPS fix yet – tap "Get Current Location" first.');
    return;
  }

  var now = new Date().toISOString();
  var existing = state.tiles[currentTileId];

  if (existing) {
    // Revisiting an owned tile
    existing.claimCount   += 1;
    existing.lastVisitedAt = now;
  } else {
    // Brand-new tile
    state.tiles[currentTileId] = {
      tileId:        currentTileId,
      claimedAt:     now,
      lastVisitedAt: now,
      claimCount:    1
    };
  }

  saveState();
  renderUI();

  // Brief visual feedback on the button
  var btn = document.getElementById('btn-claim');
  var originalText = btn.textContent;
  btn.textContent = existing ? '✅ Revisited!' : '🎉 Claimed!';
  btn.disabled = true;
  setTimeout(function () {
    btn.textContent = originalText;
    btn.disabled = (currentPos === null);
  }, 1200);
}

// ══════════════════════════════════════════════════════════════════════════════
// Import / Export
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Serialize `state` to a JSON file and trigger a browser download.
 */
function exportSave() {
  var json = JSON.stringify(state, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url  = URL.createObjectURL(blob);

  var a    = document.createElement('a');
  a.href     = url;
  a.download = 'territory-tap-save.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read a JSON file chosen by the user and overwrite current state.
 * Validates the basic shape of the data before accepting it.
 * @param {File} file
 */
function importSave(file) {
  var reader = new FileReader();
  reader.onload = function (evt) {
    try {
      var parsed = JSON.parse(evt.target.result);

      // Basic validation
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('File is not a valid JSON object.');
      }
      if (parsed.tiles && typeof parsed.tiles !== 'object') {
        throw new Error('"tiles" field is not an object.');
      }

      state.playerName = parsed.playerName || 'Local Player';
      state.tiles      = parsed.tiles || {};

      saveState();
      renderUI();
      hideError();
      alert('Save imported successfully!');
    } catch (e) {
      showError('Import failed: ' + e.message);
    }
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════════════════════════════════════
// Canvas mini-map
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Draw a simple tile grid on the canvas.
 *
 * Strategy:
 *   - Collect all owned tile IDs, extract their integer row/col values.
 *   - Find the bounding box.
 *   - Scale tiles to fill the canvas with a small margin.
 *   - Draw each owned tile in blue; highlight the current tile in red.
 */
function drawMap() {
  var canvas = document.getElementById('map-canvas');
  var ctx    = canvas.getContext('2d');
  var W      = canvas.width;
  var H      = canvas.height;

  // Clear background
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, W, H);

  // Collect all tile coordinates (integer row/col pairs)
  var tileIds = Object.keys(state.tiles);

  // Include currentTileId in the layout even if not yet claimed,
  // so the player can see where they are on the map.
  var allIds = tileIds.slice();
  if (currentTileId && allIds.indexOf(currentTileId) === -1) {
    allIds.push(currentTileId);
  }

  if (allIds.length === 0) {
    // Nothing to draw yet
    ctx.fillStyle = '#8b949e';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Claim a tile to see your map.', W / 2, H / 2);
    return;
  }

  // Parse integer row/col from each tile ID
  var coords = allIds.map(function (id) {
    var parts = id.split(':');
    return { id: id, row: parseInt(parts[0], 10), col: parseInt(parts[1], 10) };
  });

  // Bounding box
  var minRow = coords[0].row, maxRow = coords[0].row;
  var minCol = coords[0].col, maxCol = coords[0].col;
  coords.forEach(function (c) {
    if (c.row < minRow) minRow = c.row;
    if (c.row > maxRow) maxRow = c.row;
    if (c.col < minCol) minCol = c.col;
    if (c.col > maxCol) maxCol = c.col;
  });

  var rows  = maxRow - minRow + 1;
  var cols  = maxCol - minCol + 1;
  var margin = 20;

  // Cell size — fit to canvas with equal aspect ratio
  var cellW = (W - margin * 2) / cols;
  var cellH = (H - margin * 2) / rows;
  var cell  = Math.min(cellW, cellH, 60); // cap at 60 px

  // Re-center with actual cell size
  var gridW   = cell * cols;
  var gridH   = cell * rows;
  var offsetX = (W - gridW) / 2;
  var offsetY = (H - gridH) / 2;

  // Draw owned tiles
  var ownedSet = {};
  tileIds.forEach(function (id) { ownedSet[id] = true; });

  coords.forEach(function (c) {
    var x = offsetX + (c.col - minCol) * cell;
    var y = offsetY + (c.row - minRow) * cell;

    // Fill
    if (c.id === currentTileId && ownedSet[c.id]) {
      ctx.fillStyle = '#f85149'; // current + owned → red
    } else if (c.id === currentTileId) {
      ctx.fillStyle = '#6e3030'; // current but not yet owned → dark red
    } else {
      // Shade by claim count (more claims = brighter blue)
      var count = state.tiles[c.id] ? state.tiles[c.id].claimCount : 0;
      var brightness = Math.min(0.3 + count * 0.07, 1);
      ctx.fillStyle = 'rgba(31, 111, 235, ' + brightness + ')';
    }
    ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);

    // Border
    ctx.strokeStyle = c.id === currentTileId ? '#f85149' : '#30363d';
    ctx.lineWidth   = 1;
    ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);

    // Label claim count inside cell if it fits
    if (cell >= 24 && ownedSet[c.id]) {
      ctx.fillStyle  = '#ffffffcc';
      ctx.font       = Math.min(cell * 0.35, 14) + 'px sans-serif';
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.tiles[c.id].claimCount, x + cell / 2, y + cell / 2);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// UI rendering
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Re-render all dynamic UI elements from the current state.
 * Called after every state change.
 */
function renderUI() {
  var tileCount = Object.keys(state.tiles).length;
  var score     = calcScore();

  // Status bar
  document.getElementById('score-display').textContent = score;
  document.getElementById('tile-count-display').textContent = tileCount;
  document.getElementById('current-tile-display').textContent =
    currentTileId || '—';

  // Tile log list
  renderTileList();

  // Mini-map
  drawMap();
}

/**
 * Build and insert the tile log card list.
 * Shows the most recently visited tile first.
 */
function renderTileList() {
  var container = document.getElementById('tiles-list');
  var tiles     = state.tiles;
  var ids       = Object.keys(tiles);

  if (ids.length === 0) {
    container.innerHTML = '<p class="empty-msg">No tiles claimed yet.</p>';
    return;
  }

  // Sort by lastVisitedAt descending (most recent first)
  ids.sort(function (a, b) {
    return new Date(tiles[b].lastVisitedAt) - new Date(tiles[a].lastVisitedAt);
  });

  var html = ids.map(function (id) {
    var t   = tiles[id];
    var isCurrent = (id === currentTileId);
    var claimedDate   = new Date(t.claimedAt).toLocaleString();
    var visitedDate   = new Date(t.lastVisitedAt).toLocaleString();
    var pointsEarned  = POINTS_NEW_TILE + (t.claimCount - 1) * POINTS_REVISIT;

    return (
      '<div class="tile-card' + (isCurrent ? ' is-current' : '') + '">' +
        '<div class="tile-id">📍 ' + escapeHtml(t.tileId) + (isCurrent ? '  ← you are here' : '') + '</div>' +
        '<div class="tile-meta">' +
          'First claimed: ' + claimedDate + '<br>' +
          'Last visited: '  + visitedDate + '<br>' +
          'Claim count: '   + t.claimCount + '<br>' +
          'Points: '        + pointsEarned +
        '</div>' +
      '</div>'
    );
  }).join('');

  container.innerHTML = html;
}

/**
 * Minimal HTML escaping to prevent XSS when rendering user-influenced data
 * (tileId is derived from Math.floor output so is safe, but defensive is good).
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════════════════════════════
// Error helpers
// ══════════════════════════════════════════════════════════════════════════════

/** Display a user-visible error message. */
function showError(msg) {
  var el = document.getElementById('gps-error');
  el.textContent = msg;
  el.hidden = false;
}

/** Hide the error message. */
function hideError() {
  var el = document.getElementById('gps-error');
  el.hidden = true;
  el.textContent = '';
}

// ══════════════════════════════════════════════════════════════════════════════
// Event wiring
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Wire up all button click handlers and file input.
 * Called once on DOMContentLoaded.
 */
function initEventListeners() {
  // "Get Current Location" — request a fresh fix and (re)start watching
  document.getElementById('btn-locate').addEventListener('click', function () {
    getPositionOnce();
    startWatching();
  });

  // "Claim Tile" — record the current tile
  document.getElementById('btn-claim').addEventListener('click', function () {
    claimCurrentTile();
  });

  // "Export Save JSON"
  document.getElementById('btn-export').addEventListener('click', function () {
    exportSave();
  });

  // "Import Save JSON" — trigger the hidden file input
  document.getElementById('btn-import').addEventListener('click', function () {
    document.getElementById('import-file-input').click();
  });

  // File chosen for import
  document.getElementById('import-file-input').addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    if (file) {
      importSave(file);
      // Reset so the same file can be imported again if needed
      evt.target.value = '';
    }
  });

  // "Reset Local Save" — confirm before destroying data
  document.getElementById('btn-reset').addEventListener('click', function () {
    if (confirm('Reset all save data? This cannot be undone.')) {
      resetState();
      currentPos    = null;
      currentTileId = null;
      document.getElementById('gps-coords').textContent = 'Waiting for location…';
      document.getElementById('btn-claim').disabled = true;
      renderUI();
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Boot
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Entry point — runs once the DOM is ready.
 */
document.addEventListener('DOMContentLoaded', function () {
  loadState();          // restore any previous save
  initEventListeners(); // attach button handlers
  renderUI();           // paint the initial state

  // Auto-start location watching so the map updates without requiring
  // the user to tap "Get Current Location" first.
  startWatching();
});
