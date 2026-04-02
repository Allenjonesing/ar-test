/**
 * DebugHUD — standalone IIFE, sets window.DebugHUD
 * No ES-module syntax; safe to load with a plain <script> tag.
 *
 * Usage:
 *   DebugHUD.create('my-container-id');
 *   DebugHUD.update({ gpsAccuracy: '8 m', trackingState: 'tracking', ... });
 *   DebugHUD.show(); DebugHUD.hide(); DebugHUD.toggle();
 */
(function (global) {
  'use strict';

  var _el = null;  // root HUD element
  var _fields = {};

  var FIELD_LABELS = {
    trackingState:        'Tracking',
    localizationState:    'Localiz.',
    anchorSource:         'Anchor Src',
    gpsAccuracy:          'GPS Acc.',
    headingConfidence:    'Heading',
    relocalizationCount:  'Relocaliz.',
    driftWarning:         'Drift',
    userPositionSource:   'Pos. Source',
    experimentMode:       'Mode',
    fps:                  'FPS',
    anchorCount:          'Anchors'
  };

  var STATUS_COLORS = {
    tracking: '#00ff88',
    limited:  '#ffaa00',
    lost:     '#ff4455',
    none:     '#888888',
    true:     '#ff4455',
    false:    '#00ff88'
  };

  // ── Build DOM ──────────────────────────────────────────────────────────────

  function _buildHUD() {
    var wrap = document.createElement('div');
    wrap.id = 'debug-hud';
    wrap.style.cssText = [
      'position:absolute',
      'top:12px',
      'right:12px',
      'z-index:9999',
      'background:rgba(0,0,0,0.72)',
      'border:1px solid rgba(0,255,136,0.3)',
      'border-radius:8px',
      'padding:10px 14px',
      'min-width:210px',
      'max-width:260px',
      'font-family:monospace',
      'font-size:11px',
      'color:#ccffdd',
      'line-height:1.7',
      'pointer-events:none',
      'backdrop-filter:blur(4px)',
      '-webkit-backdrop-filter:blur(4px)'
    ].join(';');

    var title = document.createElement('div');
    title.style.cssText = 'font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#00ff88;margin-bottom:6px;border-bottom:1px solid rgba(0,255,136,0.2);padding-bottom:4px;';
    title.textContent = '◈ Debug HUD';
    wrap.appendChild(title);

    var table = document.createElement('div');
    table.id = 'debug-hud-table';

    Object.keys(FIELD_LABELS).forEach(function (key) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
      row.id = 'debug-row-' + key;

      var label = document.createElement('span');
      label.style.cssText = 'color:rgba(180,255,210,0.5);white-space:nowrap;';
      label.textContent = FIELD_LABELS[key] + ':';

      var val = document.createElement('span');
      val.id = 'debug-val-' + key;
      val.style.cssText = 'color:#fff;text-align:right;word-break:break-all;';
      val.textContent = '—';

      row.appendChild(label);
      row.appendChild(val);
      table.appendChild(row);
      _fields[key] = val;
    });

    wrap.appendChild(table);
    return wrap;
  }

  // ── Public: create ─────────────────────────────────────────────────────────

  function create(containerId) {
    var container = containerId
      ? document.getElementById(containerId)
      : document.body;

    if (!container) {
      console.warn('DebugHUD.create: container #' + containerId + ' not found, appending to body');
      container = document.body;
    }

    if (_el) {
      _el.remove();
      _fields = {};
    }

    _el = _buildHUD();
    container.appendChild(_el);
    return _el;
  }

  // ── Public: update ─────────────────────────────────────────────────────────

  function update(data) {
    if (!_el) return;
    Object.keys(data).forEach(function (key) {
      var valEl = _fields[key] || document.getElementById('debug-val-' + key);
      if (!valEl) return;

      var raw = data[key];
      var text = (raw === null || raw === undefined) ? '—' : String(raw);
      valEl.textContent = text;

      // Colour cues
      var lc = text.toLowerCase();
      if (STATUS_COLORS[lc] !== undefined) {
        valEl.style.color = STATUS_COLORS[lc];
      } else if (key === 'driftWarning') {
        valEl.style.color = raw ? STATUS_COLORS['true'] : STATUS_COLORS['false'];
      } else {
        valEl.style.color = '#ffffff';
      }
    });
  }

  // ── Public: show / hide / toggle ───────────────────────────────────────────

  function show() {
    if (_el) _el.style.display = '';
  }

  function hide() {
    if (_el) _el.style.display = 'none';
  }

  function toggle() {
    if (!_el) return;
    _el.style.display = (_el.style.display === 'none') ? '' : 'none';
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  global.DebugHUD = { create: create, update: update, show: show, hide: hide, toggle: toggle };

}(typeof window !== 'undefined' ? window : this));
