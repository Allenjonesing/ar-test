/**
 * Canvas Map Utility Library — shared/canvas-map.js
 *
 * Standalone IIFE; sets window.CanvasMap.
 * No external dependencies. Works alongside shared/gps.js.
 *
 * Provides helpers for rendering a 2-D GPS canvas map:
 *   - World ↔ screen coordinate conversion (with zoom + pan offset)
 *   - Auto-fit viewport to a set of points
 *   - Pan, pinch-zoom, and mouse-wheel zoom interaction
 *   - Common drawing utilities: player dot, heading arrow, N↑ label, scale bar
 *   - Paw-print drawing (useful for dog-walk themes)
 *
 * Usage:
 *   // Create a map state object
 *   var map = CanvasMap.createState();
 *
 *   // Convert world point to screen
 *   var screen = CanvasMap.worldToScreen({ x: 10, y: -5 }, map);
 *
 *   // Auto-fit zoom/offset to a list of world points
 *   CanvasMap.autoFit(points, canvas, map, 60);
 *
 *   // Wire up pan + pinch + wheel on a canvas element
 *   CanvasMap.addInteraction(canvas, map, redrawFn);
 *
 *   // Drawing helpers (call inside your render function)
 *   CanvasMap.drawPlayerDot(ctx, sx, sy, heading, '#00ccff');
 *   CanvasMap.drawNorth(ctx, canvas);
 *   CanvasMap.drawScale(ctx, canvas, map, '#00ff88');
 *   CanvasMap.drawPaw(ctx, sx, sy, angleDeg, color, size);
 *   CanvasMap.drawPath(ctx, points, map, strokeStyle, lineWidth);
 *   CanvasMap.drawGlowDot(ctx, sx, sy, radius, fillColor, glowColor);
 *   CanvasMap.drawCompassArrow(ctx, sx, sy, bearingDeg, color);
 */
(function (global) {
  'use strict';

  // ── Map state ──────────────────────────────────────────────────────────────

  /**
   * Create a fresh map state object.
   * Mutate zoom / offset to control the viewport.
   */
  function createState(opts) {
    opts = opts || {};
    return {
      zoom:      opts.zoom      || 4,
      offset:    { x: opts.offsetX || 0, y: opts.offsetY || 0 },
      autoFit:   opts.autoFit  !== false,  // default true
      dragging:  false,
      lastTouch: null
    };
  }

  // ── Coordinate conversion ──────────────────────────────────────────────────

  /**
   * Convert a world-space point {x, y} to canvas screen coords.
   */
  function worldToScreen(pt, map) {
    return {
      x: pt.x * map.zoom + map.offset.x,
      y: pt.y * map.zoom + map.offset.y
    };
  }

  /**
   * Convert canvas screen coords back to world space.
   */
  function screenToWorld(sx, sy, map) {
    return {
      x: (sx - map.offset.x) / map.zoom,
      y: (sy - map.offset.y) / map.zoom
    };
  }

  // ── Auto-fit ───────────────────────────────────────────────────────────────

  /**
   * Adjust map.zoom and map.offset so that all `points` fit inside
   * the canvas with `padding` pixels of margin on each side.
   *
   * @param {Array<{x:number,y:number}>} points  — world-space points
   * @param {HTMLCanvasElement}          canvas
   * @param {object}                     map      — state from createState()
   * @param {number}                     [padding=60]
   * @param {number}                     [minZoom=1]
   * @param {number}                     [maxZoom=100]
   */
  function autoFit(points, canvas, map, padding, minZoom, maxZoom) {
    if (!points || !points.length) return;
    padding  = padding  !== undefined ? padding  : 60;
    minZoom  = minZoom  !== undefined ? minZoom  : 1;
    maxZoom  = maxZoom  !== undefined ? maxZoom  : 100;

    var W = canvas.width, H = canvas.height;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(function (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });

    var rX = maxX - minX || 30;
    var rY = maxY - minY || 30;
    map.zoom = Math.max(minZoom, Math.min(maxZoom,
      Math.min((W - padding * 2) / rX, (H - padding * 2) / rY)
    ));
    map.offset.x = W / 2 - (minX + rX / 2) * map.zoom;
    map.offset.y = H / 2 - (minY + rY / 2) * map.zoom;
  }

  // ── Canvas interaction (pan, pinch-zoom, wheel) ────────────────────────────

  /**
   * Wire up touch-pan, pinch-zoom and mouse-wheel zoom on a canvas element.
   * Call `redrawFn` whenever the viewport changes.
   *
   * Returns a teardown function that removes all listeners.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {object}            map       — state from createState()
   * @param {function}          redrawFn
   * @param {object}            [opts]
   * @param {number}            [opts.minZoom=1]
   * @param {number}            [opts.maxZoom=100]
   */
  function addInteraction(canvas, map, redrawFn, opts) {
    opts = opts || {};
    var minZoom = opts.minZoom || 1;
    var maxZoom = opts.maxZoom || 100;
    var _lastPinchDist = null;

    function onTouchStart(e) {
      if (e.touches.length === 1) {
        map.dragging  = true;
        map.autoFit   = false;
        map.lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }

    function onTouchMove(e) {
      if (e.touches.length === 2) {
        var d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (_lastPinchDist) {
          map.zoom = Math.max(minZoom, Math.min(maxZoom, map.zoom * d / _lastPinchDist));
          redrawFn();
        }
        _lastPinchDist = d;
        return;
      }
      _lastPinchDist = null;
      if (!map.dragging || !map.lastTouch) return;
      map.offset.x += e.touches[0].clientX - map.lastTouch.x;
      map.offset.y += e.touches[0].clientY - map.lastTouch.y;
      map.lastTouch  = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      redrawFn();
    }

    function onTouchEnd() {
      map.dragging   = false;
      map.lastTouch  = null;
      _lastPinchDist = null;
    }

    function onWheel(e) {
      e.preventDefault();
      map.zoom    = Math.max(minZoom, Math.min(maxZoom, map.zoom * (e.deltaY > 0 ? 0.85 : 1.18)));
      map.autoFit = false;
      redrawFn();
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: true });
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: true });
    canvas.addEventListener('wheel',      onWheel,      { passive: false });

    return function teardown() {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
      canvas.removeEventListener('touchend',   onTouchEnd);
      canvas.removeEventListener('wheel',      onWheel);
    };
  }

  /**
   * Resize a canvas to fill its wrapper element.
   * Call on window resize and on init.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {HTMLElement}       wrapper  — parent element whose size the canvas should match
   * @param {function}          [redrawFn]
   */
  function resizeToWrapper(canvas, wrapper, redrawFn) {
    canvas.width  = wrapper.offsetWidth;
    canvas.height = wrapper.offsetHeight;
    if (redrawFn) redrawFn();
  }

  // ── Drawing utilities ──────────────────────────────────────────────────────

  /**
   * Clear the canvas and fill with a solid background colour.
   */
  function clearCanvas(ctx, canvas, bgColor) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (bgColor) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  /**
   * Draw a GPS path (array of world-space {x, y} points) on the canvas.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<{x,y}>}            points      — world coords
   * @param {object}                  map
   * @param {string}                  [strokeStyle='rgba(0,255,136,0.5)']
   * @param {number}                  [lineWidth=2]
   */
  function drawPath(ctx, points, map, strokeStyle, lineWidth) {
    if (!points || points.length < 2) return;
    ctx.beginPath();
    var p0 = worldToScreen(points[0], map);
    ctx.moveTo(p0.x, p0.y);
    for (var i = 1; i < points.length; i++) {
      var pi = worldToScreen(points[i], map);
      ctx.lineTo(pi.x, pi.y);
    }
    ctx.strokeStyle = strokeStyle || 'rgba(0,255,136,0.5)';
    ctx.lineWidth   = lineWidth   || 2;
    ctx.lineJoin    = 'round';
    ctx.stroke();
  }

  /**
   * Draw a glowing filled circle.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} sx         — screen x
   * @param {number} sy         — screen y
   * @param {number} radius
   * @param {string} fillColor
   * @param {string} [glowColor] — defaults to fillColor
   * @param {number} [glowBlur=16]
   */
  function drawGlowDot(ctx, sx, sy, radius, fillColor, glowColor, glowBlur) {
    ctx.save();
    ctx.shadowBlur  = glowBlur  || 16;
    ctx.shadowColor = glowColor || fillColor;
    ctx.fillStyle   = fillColor;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw the player position dot with optional heading arrow.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number}      sx          — screen x (centre of dot)
   * @param {number}      sy          — screen y
   * @param {number|null} headingDeg  — compass heading (0=N, 90=E); null = no arrow
   * @param {string}      [dotColor='#00ccff']
   * @param {number}      [dotRadius=8]
   */
  function drawPlayerDot(ctx, sx, sy, headingDeg, dotColor, dotRadius) {
    dotColor  = dotColor  || '#00ccff';
    dotRadius = dotRadius || 8;

    // Outer glow dot
    ctx.save();
    ctx.shadowBlur  = 20;
    ctx.shadowColor = dotColor;
    ctx.fillStyle   = dotColor;
    ctx.beginPath();
    ctx.arc(sx, sy, dotRadius, 0, Math.PI * 2);
    ctx.fill();
    // White centre
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(2, dotRadius * 0.45), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Heading arrow
    if (headingDeg !== null && headingDeg !== undefined && !isNaN(headingDeg)) {
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate((headingDeg - 90) * Math.PI / 180);
      ctx.beginPath();
      ctx.moveTo(dotRadius + 12, 0);
      ctx.lineTo(dotRadius + 1, -7);
      ctx.lineTo(dotRadius + 3, 0);
      ctx.lineTo(dotRadius + 1, 7);
      ctx.closePath();
      ctx.fillStyle   = 'rgba(255,255,255,0.92)';
      ctx.shadowBlur  = 8;
      ctx.shadowColor = '#ffffff';
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Draw a compass arrow pointing in the given bearing.
   * Useful for a HUD arrow indicating direction to a target.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} sx         — screen x (pivot)
   * @param {number} sy         — screen y (pivot)
   * @param {number} bearingDeg — 0=North, 90=East
   * @param {string} [color='#00ff88']
   * @param {number} [length=28]
   */
  function drawCompassArrow(ctx, sx, sy, bearingDeg, color, length) {
    color  = color  || '#00ff88';
    length = length || 28;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(bearingDeg * Math.PI / 180);
    ctx.beginPath();
    ctx.moveTo(0, -length);
    ctx.lineTo(-5, -length + 10);
    ctx.lineTo(0, -length + 6);
    ctx.lineTo(5, -length + 10);
    ctx.closePath();
    ctx.fillStyle   = color;
    ctx.shadowBlur  = 10;
    ctx.shadowColor = color;
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw the N↑ north indicator in the top-right corner.
   */
  function drawNorth(ctx, canvas) {
    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,0.55)';
    ctx.font         = 'bold 11px sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('N↑', canvas.width - 8, 8);
    ctx.restore();
  }

  /**
   * Draw a simple scale label (e.g. "12m scale") in the bottom-right corner.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLCanvasElement}        canvas
   * @param {object}                   map        — needs map.zoom
   * @param {string}                   [color='rgba(255,255,255,0.4)']
   * @param {number}                   [refPixels=50] — reference pixel width for scale
   */
  function drawScale(ctx, canvas, map, color, refPixels) {
    refPixels = refPixels || 50;
    var metres = Math.round(refPixels / map.zoom);
    ctx.save();
    ctx.fillStyle    = color || 'rgba(255,255,255,0.4)';
    ctx.font         = '9px monospace';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(metres + 'm scale', canvas.width - 8, canvas.height - 8);
    ctx.restore();
  }

  /**
   * Draw a paw-print shape at the given screen position.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} sx       — screen x (centre of main pad)
   * @param {number} sy       — screen y
   * @param {number} angleDeg — rotation in degrees (heading direction)
   * @param {string} color
   * @param {number} size     — radius of main pad
   */
  function drawPaw(ctx, sx, sy, angleDeg, color, size) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angleDeg * Math.PI / 180);
    ctx.fillStyle = color;
    // Main pad
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.7, size, 0, 0, Math.PI * 2);
    ctx.fill();
    // Four toe pads
    var toes = [
      { x: -size * 0.65, y: -size * 0.9 },
      { x: -size * 0.2,  y: -size * 1.1 },
      { x:  size * 0.2,  y: -size * 1.1 },
      { x:  size * 0.65, y: -size * 0.9 }
    ];
    toes.forEach(function (t) {
      ctx.beginPath();
      ctx.arc(t.x, t.y, size * 0.32, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  /**
   * Draw a collection-radius ring + glow dot for a pickup item.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} sx           — screen x
   * @param {number} sy           — screen y
   * @param {number} radiusPx     — pick-up radius in screen pixels
   * @param {string} color        — e.g. '#ffcc44'
   * @param {string} [emoji]      — optional emoji label above the dot
   */
  function drawPickup(ctx, sx, sy, radiusPx, color, emoji) {
    // Glow ring
    ctx.save();
    ctx.shadowBlur  = 18;
    ctx.shadowColor = color;
    ctx.fillStyle   = color.replace(')', ', 0.12)').replace('rgb', 'rgba') || 'rgba(255,204,68,0.12)';
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(8, radiusPx), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Centre dot
    drawGlowDot(ctx, sx, sy, Math.max(5, Math.min(14, radiusPx * 0.25)), color, color);
    // Emoji label
    if (emoji && radiusPx > 8) {
      ctx.save();
      ctx.fillStyle    = 'rgba(255,255,255,0.85)';
      ctx.font         = '11px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, sx, sy - Math.max(12, radiusPx * 0.6));
      ctx.restore();
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  global.CanvasMap = {
    createState:      createState,
    worldToScreen:    worldToScreen,
    screenToWorld:    screenToWorld,
    autoFit:          autoFit,
    addInteraction:   addInteraction,
    resizeToWrapper:  resizeToWrapper,
    clearCanvas:      clearCanvas,
    drawPath:         drawPath,
    drawGlowDot:      drawGlowDot,
    drawPlayerDot:    drawPlayerDot,
    drawCompassArrow: drawCompassArrow,
    drawNorth:        drawNorth,
    drawScale:        drawScale,
    drawPaw:          drawPaw,
    drawPickup:       drawPickup
  };

}(typeof window !== 'undefined' ? window : this));
