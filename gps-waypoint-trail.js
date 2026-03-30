'use strict';

/**
 * gps-waypoint-trail.js  –  BrowserGpsWaypointTrail
 *
 * A self-contained GPS waypoint trail class for browser-based WebXR /
 * Three.js scenes.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  WHY GPS PLACEMENT AND HEADING ALIGNMENT MUST STAY SEPARATE            │
 * │  ─────────────────────────────────────────────────────────────────────  │
 * │  The classic drift bug:                                                  │
 * │  When the compass heading used to rotate GPS coords is stored inside     │
 * │  each waypoint's world-space position, any later change to that heading  │
 * │  (e.g. after motion-based calibration, sensor warm-up, or a manual       │
 * │  recalibration) forces every previously-placed waypoint to be            │
 * │  recomputed and re-positioned.  The trail "jumps" or bends, and         │
 * │  the drift is permanent because the old heading is baked into world      │
 * │  coordinates.                                                             │
 * │                                                                           │
 * │  The fix applied here:                                                   │
 * │                                                                           │
 * │  1.  GPS PLACEMENT  (geoToLocalMeters + addWaypoint)                    │
 * │      Each GPS fix is converted to a heading-independent offset from a   │
 * │      fixed reference origin — metres east / north of the session         │
 * │      origin.  The resulting position is placed in waypointRoot and       │
 * │      NEVER changed again.                                                 │
 * │                                                                           │
 * │  2.  HEADING ALIGNMENT  (updateHeadingAlignment)                        │
 * │      Only xrRoot.rotation.y is updated.  Because every waypoint lives   │
 * │      inside waypointRoot (a child of xrRoot), rotating xrRoot turns the │
 * │      entire GPS trail together — no individual waypoint ever moves.      │
 * │      Smoothing (shortest-angle LERP) prevents compass jitter from        │
 * │      causing visible world-shake.                                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * COORDINATE CONVENTIONS
 * ──────────────────────
 *  geoToLocalMeters returns:
 *    x  = east  metres  (positive = east of origin)
 *    y  = up    metres  (positive = above origin; zero when useAltitude=false)
 *    z  = north metres  (positive = north of origin)           ← geographic
 *
 *  Three.js world space:
 *    camera looks at  -Z  (forward = −Z)
 *    +X  = to the right of the initial camera orientation
 *    +Y  = up
 *    North must map to  -Z  (in front when heading = 0°)
 *
 *  Therefore addWaypoint places each mesh at  (local.x, local.y, -local.z)
 *  — the z sign is flipped from geographic convention to Three.js convention.
 *
 * HEADING ROTATION FORMULA
 * ────────────────────────
 *  xrRoot.rotation.y = heading * Math.PI / 180  (POSITIVE heading in radians)
 *
 *  Verification:
 *    heading = 0° (facing North):
 *      rotation = 0.  North waypoint at local (0, 0, -N) → world (0, 0, -N)
 *      = Three.js −Z = in front of camera.  ✓
 *
 *    heading = 90° (facing East):
 *      rotation = π/2.  North waypoint (0, 0, -N):
 *        x′ = 0·cos(π/2) + (−N)·sin(π/2) = −N
 *        z′ = −0·sin(π/2) + (−N)·cos(π/2) = 0
 *      → world (−N, 0, 0) = Three.js −X.
 *      When facing East the camera's left direction is geographic North = −X. ✓
 *
 *    heading = 180° (facing South):
 *      rotation = π.  North waypoint (0, 0, -N):
 *        x′ = 0, z′ = N  → world (0, 0, N) = Three.js +Z = behind the camera.
 *      When facing South, North IS behind you.  ✓
 *
 *    heading = 270° (facing West):
 *      rotation = 3π/2.  North waypoint → world (N, 0, 0) = +X = camera right.
 *      When facing West, North is to your right.  ✓
 */
class BrowserGpsWaypointTrail {
  /**
   * @param {object} options
   * @param {THREE.Object3D}  options.xrRoot              – root to rotate for heading
   * @param {THREE.Object3D}  options.waypointRoot        – child of xrRoot; holds all waypoints
   * @param {THREE.Camera}    [options.camera]            – WebXR camera (unused internally, kept for caller convenience)
   * @param {function}        options.createWaypointObject – factory → returns a THREE.Object3D
   * @param {number}          [options.minWaypointSpacingMeters=2]
   * @param {boolean}         [options.useAltitude=false]
   * @param {number}          [options.headingLerpFactor=0.12] – 0..1 smoothing factor per update
   */
  constructor(options) {
    this.xrRoot              = options.xrRoot;
    this.waypointRoot        = options.waypointRoot;
    this.camera              = options.camera || null;
    this.createWaypointObject = options.createWaypointObject;
    this.minWaypointSpacingMeters = options.minWaypointSpacingMeters ?? 2;
    this.useAltitude         = options.useAltitude ?? false;
    this.headingLerpFactor   = options.headingLerpFactor ?? 0.12;

    this.reference         = null;  // { lat, lon, alt }
    this.lastWaypointLocal = null;  // { x, y, z } in metres — last placed waypoint

    this.smoothedHeading   = null;  // current smoothed compass heading (degrees)
    this.latestHeading     = null;  // most recent raw heading sample (degrees)
    this.latestPosition    = null;  // most recent GPS fix { lat, lon, alt, accuracy }

    this.watchId           = null;  // navigator.geolocation watch ID
    this.orientationHandler = null; // reference kept for removeEventListener
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Request any required permissions then begin GPS and orientation watching.
   * Must be called from (or after) a user gesture on iOS Safari.
   */
  async start() {
    await this.enableOrientationIfNeeded();
    this.startGpsWatch();
    this.startOrientationWatch();
  }

  /**
   * Request DeviceOrientation permission on iOS 13+.
   * Throws if the user denies.
   */
  async enableOrientationIfNeeded() {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        throw new Error('Device orientation permission denied.');
      }
    }
  }

  /** Begin watching GPS position. */
  startGpsWatch() {
    if (!('geolocation' in navigator)) {
      throw new Error('Geolocation API not supported.');
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, altitude, accuracy } = pos.coords;

        this.latestPosition = {
          lat:      latitude,
          lon:      longitude,
          alt:      altitude  ?? 0,
          accuracy: accuracy  ?? Infinity,
        };

        if (!this.reference) {
          this.setReferenceOrigin(latitude, longitude, altitude ?? 0);
        }

        this.addWaypoint(latitude, longitude, altitude ?? 0);
      },
      (err) => { console.error('GPS watchPosition error:', err); },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }

  /** Begin watching device orientation for compass heading. */
  startOrientationWatch() {
    this.orientationHandler = (event) => {
      const heading = this.extractCompassHeading(event);
      if (heading == null || Number.isNaN(heading)) return;

      this.latestHeading = heading;
      this.updateHeadingAlignment(heading);
    };

    // deviceorientationabsolute fires on Android with reliable magnetic North.
    // deviceorientation fires on iOS (webkitCompassHeading) and as a fallback.
    window.addEventListener('deviceorientationabsolute', this.orientationHandler, true);
    window.addEventListener('deviceorientation',         this.orientationHandler, true);
  }

  /** Stop GPS and orientation watching and release all listeners. */
  stop() {
    if (this.watchId != null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.orientationHandler) {
      window.removeEventListener('deviceorientationabsolute', this.orientationHandler, true);
      window.removeEventListener('deviceorientation',         this.orientationHandler, true);
      this.orientationHandler = null;
    }
  }

  // ── GPS reference ─────────────────────────────────────────────────────────

  /**
   * Fix the session's GPS reference origin.  All subsequent geoToLocalMeters
   * calls produce offsets relative to this point.
   * Called automatically on the first GPS fix from startGpsWatch; can also be
   * called manually to reset the origin.
   */
  setReferenceOrigin(lat, lon, alt = 0) {
    this.reference = { lat, lon, alt };
    console.log('[BrowserGpsWaypointTrail] Reference origin set:', this.reference);
  }

  // ── Waypoint placement ────────────────────────────────────────────────────

  /**
   * Convert a GPS fix to a local-metres position and place a waypoint mesh in
   * waypointRoot if it is far enough from the previous waypoint.
   *
   * GPS determines the waypoint's local position — heading is NOT used here.
   * Separating GPS placement from heading alignment is what prevents cardinal-
   * direction drift: the waypoint's position inside waypointRoot never changes
   * after it is created.  Only xrRoot.rotation.y (set in updateHeadingAlignment)
   * orients the whole trail.
   */
  addWaypoint(lat, lon, alt = 0) {
    if (!this.reference) return;

    const local = this.geoToLocalMeters(lat, lon, alt);

    // Enforce minimum spacing to avoid redundant markers from GPS jitter.
    if (this.lastWaypointLocal) {
      const dx = local.x - this.lastWaypointLocal.x;
      const dy = local.y - this.lastWaypointLocal.y;
      const dz = local.z - this.lastWaypointLocal.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < this.minWaypointSpacingMeters) {
        return;
      }
    }

    const waypoint = this.createWaypointObject();

    // local.x = east metres  → Three.js +X  (no change needed)
    // local.y = up metres    → Three.js +Y  (no change needed)
    // local.z = north metres → Three.js -Z  (negate: Three.js camera looks at
    //   -Z, so geographic North must be at negative Z in world space.
    //   geoToLocalMeters uses the standard geographic sign where +z = North;
    //   Three.js has the opposite sign where +Z = South / behind camera.)
    waypoint.position.set(local.x, local.y, -local.z);
    waypoint.rotation.set(0, 0, 0); // never apply heading rotation to individual waypoints

    this.waypointRoot.add(waypoint);
    this.lastWaypointLocal = { ...local };

    console.log('[BrowserGpsWaypointTrail] Waypoint placed (x=E, y=up, z=N):', local);
  }

  // ── Coordinate conversion ─────────────────────────────────────────────────

  /**
   * Convert a GPS latitude / longitude / altitude into local tangent-plane
   * metres relative to the fixed reference origin set at session start.
   *
   * Uses the WGS84 local approximation valid for walking distances (< ~10 km):
   *   east  = Δlon · R · cos(lat_ref)
   *   north = Δlat · R
   *
   * @returns {{ x: number, y: number, z: number }}
   *   x = east  metres  (positive = east)
   *   y = up    metres  (positive = up;  0 when useAltitude = false)
   *   z = north metres  (positive = north)
   */
  geoToLocalMeters(lat, lon, alt = 0) {
    if (!this.reference) {
      throw new Error('[BrowserGpsWaypointTrail] Reference origin not set.');
    }

    const R        = 6378137.0;           // WGS84 semi-major axis (metres)
    const DEG2RAD  = Math.PI / 180;

    const refLatRad = this.reference.lat * DEG2RAD;
    const dLat      = (lat - this.reference.lat) * DEG2RAD;
    const dLon      = (lon - this.reference.lon) * DEG2RAD;

    // East offset: lon difference scaled by cos(lat) for meridian convergence.
    const east  = dLon * R * Math.cos(refLatRad);

    // North offset: lat difference (1° ≈ 111 km everywhere).
    const north = dLat * R;

    const up = this.useAltitude ? (alt - this.reference.alt) : 0;

    // Geographic convention: x = east, y = up, z = north.
    // Callers that place objects in a Three.js scene must negate z
    // (see addWaypoint) because Three.js uses -Z for forward / North.
    return { x: east, y: up, z: north };
  }

  // ── Heading alignment ─────────────────────────────────────────────────────

  /**
   * Accept a new raw compass heading, smooth it, and rotate xrRoot.
   *
   * Only xrRoot.rotation.y is modified — individual waypoints are NEVER
   * rotated.  Because all waypoints live inside waypointRoot (child of xrRoot),
   * rotating xrRoot aligns the entire GPS trail with geographic North without
   * moving any single waypoint in its parent's local space.
   *
   * Rotation formula:
   *   xrRoot.rotation.y = smoothedHeading * Math.PI / 180  (positive)
   *
   * @param {number} rawHeadingDeg – degrees clockwise from geographic North (0–360)
   */
  updateHeadingAlignment(rawHeadingDeg) {
    if (!this.xrRoot) return;

    // Reject obviously invalid samples.
    if (rawHeadingDeg < 0 || rawHeadingDeg >= 360) return;

    if (this.smoothedHeading == null) {
      // First sample: accept immediately without interpolation.
      this.smoothedHeading = rawHeadingDeg;
    } else {
      this.smoothedHeading = this.lerpAngleDeg(
        this.smoothedHeading,
        rawHeadingDeg,
        this.headingLerpFactor
      );
    }

    // Rotate only the world root.  Waypoints inside waypointRoot inherit this
    // rotation automatically and are never individually modified.
    this.xrRoot.rotation.y = this.smoothedHeading * Math.PI / 180;
  }

  /**
   * Instantly snap heading to rawHeadingDeg, bypassing the smoothing filter.
   * Use this when the user explicitly triggers a compass recalibration so the
   * world aligns immediately instead of lerping over many frames.
   *
   * @param {number} rawHeadingDeg – degrees clockwise from geographic North (0–360)
   */
  recalibrateNorth(rawHeadingDeg) {
    this.smoothedHeading   = rawHeadingDeg;
    this.xrRoot.rotation.y = rawHeadingDeg * Math.PI / 180;
    console.log('[BrowserGpsWaypointTrail] North recalibrated to', rawHeadingDeg.toFixed(1), '°');
  }

  // ── Heading math helpers ──────────────────────────────────────────────────

  /**
   * Shortest-angle linear interpolation for degree angles.
   * Always takes the arc < 180° from `a` toward `b`, so a heading that wraps
   * from 359° → 1° takes a 2° step rather than a 358° step.
   *
   * @param {number} a   – current angle (degrees)
   * @param {number} b   – target  angle (degrees)
   * @param {number} t   – interpolation factor (0 = keep a, 1 = snap to b)
   * @returns {number}   – interpolated angle (degrees)
   */
  lerpAngleDeg(a, b, t) {
    // +540 = +180 (shift range) + +360 (guarantee positive before %):
    // ensures (b-a+540)%360 is always in [0,360), then -180 maps to [-180,+180).
    const delta = ((b - a + 540) % 360) - 180;  // shortest-arc delta, −180…+180
    return ((a + delta * t) % 360 + 360) % 360;  // normalise result to [0, 360)
  }

  // ── Device orientation helpers ────────────────────────────────────────────

  /**
   * Extract a reliable compass heading (degrees CW from geographic North) from
   * a DeviceOrientationEvent, handling both iOS Safari and Android.
   *
   * iOS Safari:  event.webkitCompassHeading  — degrees CW from North (direct).
   * Android:     event.absolute === true and event.alpha — degrees CCW from
   *              North (spec), so heading = (360 − alpha) % 360.
   *
   * Non-absolute `alpha` values (event.absolute === false) are intentionally
   * ignored: they are relative to an arbitrary reference and cannot be
   * converted to geographic bearing without extra calibration.
   *
   * @param {DeviceOrientationEvent} event
   * @returns {number|null} compass heading in degrees, or null if unavailable
   */
  extractCompassHeading(event) {
    // iOS Safari: webkitCompassHeading is the most reliable source on Apple devices.
    if (typeof event.webkitCompassHeading === 'number' &&
        !isNaN(event.webkitCompassHeading)) {
      return this.normalizeDeg(event.webkitCompassHeading);
    }

    // Android / Chrome: deviceorientationabsolute provides alpha relative to
    // geographic North (CCW).  Convert to CW-from-North heading.
    // Only accepted when event.absolute === true.
    if (event.absolute === true &&
        typeof event.alpha === 'number' &&
        !isNaN(event.alpha)) {
      return this.normalizeDeg(360 - event.alpha);
    }

    // No usable heading in this event.
    return null;
  }

  /**
   * Normalise an angle to [0, 360).
   * @param {number} deg
   * @returns {number}
   */
  normalizeDeg(deg) {
    return ((deg % 360) + 360) % 360;
  }
}

/* ===========================================================================
 * EXAMPLE USAGE
 *
 * Copy and adapt the snippet below into your own Three.js / WebXR project.
 * =========================================================================== */

/*

// ── Three.js scene setup ──────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
renderer.xr.enabled = true;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 200);

// xrRoot: the parent that gets rotated for heading alignment.
// Rotating ONLY this keeps all waypoints' relative positions stable.
const xrRoot = new THREE.Object3D();
scene.add(xrRoot);

// waypointRoot: child of xrRoot that holds all waypoint meshes.
// Its local coordinate axes match the GPS local tangent plane:
//   +X = East,  -Z = North  (Three.js convention after z-negation in addWaypoint)
const waypointRoot = new THREE.Object3D();
xrRoot.add(waypointRoot);

// ── Waypoint visual factory ───────────────────────────────────────────────────
function createWaypointObject() {
  const geo = new THREE.CylinderGeometry(0.03, 0.07, 1.5, 8);
  const mat = new THREE.MeshStandardMaterial({
    color:    0x00ff88,
    emissive: 0x004422,
    emissiveIntensity: 1.5,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  return mesh;
}

// ── Instantiate ───────────────────────────────────────────────────────────────
const trail = new BrowserGpsWaypointTrail({
  xrRoot,
  waypointRoot,
  camera,
  createWaypointObject,
  minWaypointSpacingMeters: 3,     // drop a new pillar every 3 m walked
  useAltitude:              false, // keep everything at ground level
  headingLerpFactor:        0.12,  // 0 = frozen, 1 = instant (no smoothing)
});

// ── Start on user gesture ─────────────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', async () => {
  try {
    await trail.start();
  } catch (err) {
    console.error('Trail start failed:', err);
  }
});

// ── Manual north recalibration button (optional) ──────────────────────────────
document.getElementById('recalibrate-btn').addEventListener('click', () => {
  if (trail.latestHeading != null) {
    trail.recalibrateNorth(trail.latestHeading);
  }
});

// ── Render loop ───────────────────────────────────────────────────────────────
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});

*/
