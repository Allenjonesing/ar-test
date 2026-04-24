/**
 * GPS Utility Library — shared/gps.js
 *
 * Standalone IIFE; sets window.GPS.
 * No external dependencies. Safe to load with a plain <script> tag.
 *
 * Conventions:
 *   lat / lng — WGS-84 decimal degrees
 *   Local coordinate system: x = East (metres), y = South (metres)
 *   Heading: 0 = North, 90 = East, 180 = South, 270 = West (GPS standard)
 *
 * Usage:
 *   var dist = GPS.haversine(lat1, lng1, lat2, lng2);   // metres
 *   var brng = GPS.bearing(lat1, lng1, lat2, lng2);     // 0–360°
 *   var pt   = GPS.gpsToLocal(lat, lng, origin);        // {x, y} metres
 *   var ll   = GPS.localToGps(x, y, origin);            // {lat, lng}
 *   var lbl  = GPS.headingLabel(90);                    // "E · 90°"
 *   var col  = GPS.speedColor(5);                       // "#00ff88"
 *   GPS.fetchRoadNodes(lat, lng, { radiusM: 200 }, callback);
 *   var wid  = GPS.watch(onFix, onError, options);      // navigator.geolocation watchId
 *   GPS.stopWatch(wid);
 */
(function (global) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  var EARTH_R = 6371000; // metres

  // ── Haversine distance ─────────────────────────────────────────────────────

  /**
   * Distance in metres between two GPS coordinates.
   */
  function haversine(lat1, lng1, lat2, lng2) {
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ── Bearing ────────────────────────────────────────────────────────────────

  /**
   * Forward bearing in degrees (0–360) from point 1 to point 2.
   */
  function bearing(lat1, lng1, lat2, lng2) {
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // ── GPS ↔ local Cartesian ─────────────────────────────────────────────────

  /**
   * Convert GPS coordinates to local metres relative to an origin.
   * Returns { x: East, y: South }.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {{ lat: number, lng: number }} origin — reference point (e.g. first GPS fix)
   */
  function gpsToLocal(lat, lng, origin) {
    var x = (lng - origin.lng) * Math.cos(origin.lat * Math.PI / 180) * 111320;
    var y = -(lat - origin.lat) * 111111;
    return { x: x, y: y };
  }

  /**
   * Convert local Cartesian metres back to GPS.
   * Inverse of gpsToLocal.
   *
   * @param {number} x — East metres
   * @param {number} y — South metres
   * @param {{ lat: number, lng: number }} origin
   */
  function localToGps(x, y, origin) {
    return {
      lat: origin.lat + (-y / 111111),
      lng: origin.lng + (x / (111320 * Math.cos(origin.lat * Math.PI / 180)))
    };
  }

  // ── Heading ────────────────────────────────────────────────────────────────

  var CARDINAL_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  /**
   * Human-readable heading label.
   * Returns "---" if heading is null or NaN.
   * Examples: "N · 0°", "NE · 45°", "SE · 135°"
   */
  function headingLabel(deg) {
    if (deg === null || deg === undefined || isNaN(deg)) return '---';
    var dir = CARDINAL_DIRS[Math.round(deg / 45) % 8];
    return dir + ' · ' + Math.round(deg) + '°';
  }

  /**
   * Relative bearing from heading `from` to target bearing `to`.
   * Returns a value in (-180, 180]: negative = left, positive = right.
   */
  function relativeBearing(from, to) {
    return (to - from + 540) % 360 - 180;
  }

  // ── Speed colour ───────────────────────────────────────────────────────────

  /**
   * Returns a hex colour representing movement speed (km/h).
   *   < 1 km/h  → #ff88cc (pink)    standing still
   *   1–3 km/h  → #cc88ff (purple)  slow walk
   *   3–5 km/h  → #00ff88 (green)   brisk walk
   *   5–8 km/h  → #ffcc44 (amber)   jog
   *   ≥ 8 km/h  → #ff4455 (red)     run / sprint
   */
  function speedColor(kph) {
    if (kph < 1) return '#ff88cc';
    if (kph < 3) return '#cc88ff';
    if (kph < 5) return '#00ff88';
    if (kph < 8) return '#ffcc44';
    return '#ff4455';
  }

  // ── GPS watchPosition wrapper ──────────────────────────────────────────────

  /**
   * Start a GPS watch. Returns the watchId (pass to GPS.stopWatch to cancel).
   *
   * The `onFix` callback receives an enriched position object:
   * {
   *   lat, lng,         — WGS-84 degrees
   *   accuracy,         — metres (horizontal)
   *   altitude,         — metres or null
   *   speed,            — km/h (converted from m/s; 0 if unavailable)
   *   heading,          — degrees or null
   *   timestamp,        — ms (same as pos.timestamp)
   *   raw               — original GeolocationPosition
   * }
   *
   * @param {function} onFix
   * @param {function} [onError]
   * @param {object}   [options]  — passed to watchPosition; defaults to high-accuracy
   */
  function watch(onFix, onError, options) {
    if (!navigator.geolocation) {
      if (onError) onError(new Error('Geolocation API not available'));
      return null;
    }
    var opts = Object.assign(
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
      options || {}
    );
    return navigator.geolocation.watchPosition(
      function (pos) {
        var raw = pos.coords;
        onFix({
          lat:      raw.latitude,
          lng:      raw.longitude,
          accuracy: raw.accuracy,
          altitude: raw.altitude,
          speed:    (raw.speed !== null && raw.speed >= 0) ? raw.speed * 3.6 : 0,
          heading:  (raw.heading !== null && !isNaN(raw.heading)) ? raw.heading : null,
          timestamp: pos.timestamp,
          raw:      pos
        });
      },
      onError || function () {},
      opts
    );
  }

  /**
   * Cancel a GPS watch started with GPS.watch().
   */
  function stopWatch(watchId) {
    if (watchId !== null && watchId !== undefined && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
    }
  }

  /**
   * Get a single GPS fix (Promise-based).
   * Resolves with the same enriched object as `watch`, or rejects on error.
   */
  function getCurrentPosition(options) {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation API not available'));
        return;
      }
      var opts = Object.assign(
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
        options || {}
      );
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var raw = pos.coords;
          resolve({
            lat:      raw.latitude,
            lng:      raw.longitude,
            accuracy: raw.accuracy,
            altitude: raw.altitude,
            speed:    (raw.speed !== null && raw.speed >= 0) ? raw.speed * 3.6 : 0,
            heading:  (raw.heading !== null && !isNaN(raw.heading)) ? raw.heading : null,
            timestamp: pos.timestamp,
            raw:      pos
          });
        },
        reject,
        opts
      );
    });
  }

  // ── Overpass road-node fetcher ─────────────────────────────────────────────

  var _roadCache = {
    nodes:   [],
    lat:     0,
    lng:     0,
    ts:      0,
    loading: false,
    pending: []
  };

  var OVERPASS_URL   = 'https://overpass-api.de/api/interpreter';
  var ROAD_TTL_MS    = 90000;  // cache for 90 s
  var ROAD_MOVE_M    = 110;    // re-fetch if moved > 110 m

  /**
   * Fetch nearby walkable OSM road/path nodes via Overpass API.
   * Results are cached; callback(nodes) where nodes = [{lat, lng}].
   *
   * @param {number}   lat
   * @param {number}   lng
   * @param {object}   [opts]
   * @param {number}   [opts.radiusM=220]  — search radius in metres
   * @param {string}   [opts.overpassUrl]  — override Overpass endpoint
   * @param {function} callback(nodes)
   */
  function fetchRoadNodes(lat, lng, opts, callback) {
    if (typeof opts === 'function') { callback = opts; opts = {}; }
    opts = opts || {};
    var radiusM     = opts.radiusM     || 220;
    var overpassUrl = opts.overpassUrl || OVERPASS_URL;

    var now = Date.now();
    if (_roadCache.nodes.length &&
        haversine(lat, lng, _roadCache.lat, _roadCache.lng) < ROAD_MOVE_M &&
        now - _roadCache.ts < ROAD_TTL_MS) {
      callback(_roadCache.nodes);
      return;
    }

    if (_roadCache.loading) {
      _roadCache.pending.push(callback);
      return;
    }

    _roadCache.loading = true;
    _roadCache.pending = [callback];

    var cosLat   = Math.cos(lat * Math.PI / 180);
    var latDelta = radiusM / 111111;
    var lngDelta = radiusM / (111320 * cosLat);
    var bbox = [
      (lat - latDelta).toFixed(6),
      (lng - lngDelta).toFixed(6),
      (lat + latDelta).toFixed(6),
      (lng + lngDelta).toFixed(6)
    ].join(',');

    var query = '[out:json][timeout:12];' +
      'way[highway~"^(footway|path|pedestrian|sidewalk|cycleway|residential|' +
      'living_street|service|tertiary|secondary|primary|unclassified|track)$"]' +
      '(' + bbox + ');node(w);out body;';

    fetch(overpassUrl, { method: 'POST', body: 'data=' + encodeURIComponent(query) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        _roadCache.loading = false;
        _roadCache.ts  = Date.now();
        _roadCache.lat = lat;
        _roadCache.lng = lng;
        _roadCache.nodes = (data.elements || [])
          .filter(function (e) { return e.type === 'node'; })
          .map(function (e) { return { lat: e.lat, lng: e.lon }; });
        var cbs = _roadCache.pending;
        _roadCache.pending = [];
        cbs.forEach(function (cb) { cb(_roadCache.nodes); });
      })
      .catch(function (err) {
        console.warn('[GPS.fetchRoadNodes] Overpass error:', err);
        _roadCache.loading = false;
        var cbs = _roadCache.pending;
        _roadCache.pending = [];
        cbs.forEach(function (cb) { cb([]); });
      });
  }

  /**
   * Pick a random road node within a distance ring from a reference point.
   * Falls back to random polar placement if no nodes are in range.
   *
   * @param {number}             refLat
   * @param {number}             refLng
   * @param {Array<{lat,lng}>}   roadNodes
   * @param {number}             minM   — minimum spawn distance
   * @param {number}             maxM   — maximum spawn distance
   * @returns {{ lat: number, lng: number }}
   */
  function randomRoadPoint(refLat, refLng, roadNodes, minM, maxM) {
    var inRange = (roadNodes || []).filter(function (n) {
      var d = haversine(refLat, refLng, n.lat, n.lng);
      return d >= minM && d <= maxM;
    });

    if (inRange.length) {
      return inRange[Math.floor(Math.random() * inRange.length)];
    }

    // Fallback: random polar
    var dist  = minM + Math.random() * (maxM - minM);
    var angle = Math.random() * 2 * Math.PI;
    return {
      lat: refLat + (dist * Math.cos(angle)) / 111111,
      lng: refLng + (dist * Math.sin(angle)) / (111320 * Math.cos(refLat * Math.PI / 180))
    };
  }

  /**
   * Invalidate the road-node cache (e.g. after a large jump in position).
   */
  function clearRoadCache() {
    _roadCache.nodes   = [];
    _roadCache.ts      = 0;
    _roadCache.loading = false;
    _roadCache.pending = [];
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  global.GPS = {
    haversine:           haversine,
    bearing:             bearing,
    gpsToLocal:          gpsToLocal,
    localToGps:          localToGps,
    headingLabel:        headingLabel,
    relativeBearing:     relativeBearing,
    speedColor:          speedColor,
    watch:               watch,
    stopWatch:           stopWatch,
    getCurrentPosition:  getCurrentPosition,
    fetchRoadNodes:      fetchRoadNodes,
    randomRoadPoint:     randomRoadPoint,
    clearRoadCache:      clearRoadCache
  };

}(typeof window !== 'undefined' ? window : this));
