/**
 * ar.js - GPS AR Trail
 *
 * Uses Three.js + WebXR (immersive-ar + hit-test + plane-detection) to:
 *   - Stream the real-world camera as the scene background (top half)
 *   - Place waypoint pillars anchored to GPS coordinates in XR space
 *   - Show an accurate GPS map in the bottom half
 *
 * GPS PLACEMENT VS HEADING ALIGNMENT — kept strictly separate
 * ─────────────────────────────────────────────────────────────
 * The previous approach baked the compass heading into each waypoint's
 * world-space position via gpsLocalToXR().  When the heading estimate changed
 * (e.g. after motion-based calibration) every waypoint had to be recomputed
 * via resyncWaypointsToGPS(), causing the trail to jump or drift in the wrong
 * cardinal direction.
 *
 * The fix (v0.5):
 *   1. GPS PLACEMENT  (gpsToLocal + placeWaypoint)
 *      Each GPS fix is converted to heading-independent local metres (mx=East,
 *      mz=South relative to the session origin) and the resulting position is
 *      placed directly in waypointRoot.  These positions never change.
 *
 *   2. HEADING ALIGNMENT  (setupCompass / motion calibration)
 *      Only xrRoot.rotation.y is updated.  Because waypointRoot is a child of
 *      xrRoot, all waypoints rotate together — no individual waypoint is
 *      repositioned.  resyncWaypointsToGPS() is therefore a no-op.
 *
 * Coordinate convention (East=+X, South=+Z in GPS local / xrRoot local):
 *   xrRoot.rotation.y = compassHeading * π/180
 *
 *   Verification (camera initially looks at −Z = geographic North):
 *     H=0  (North): rot=0,   South (0,0,+1) stays +Z (behind);
 *                            North (0,0,−1) stays −Z (forward)         ✓
 *     H=90 (East):  rot=π/2, East  (+1,0,0)  →  (0,0,−1) = forward    ✓
 *                            North (0,0,−1)  → (−1,0,0) = camera-left  ✓
 */

'use strict';

/* ===========================================================================
 * TRAIL MODE  (selected via URL parameter ?mode=v1…v6)
 *
 *  v1  Live Compass    – continuous heading from device orientation (default)
 *  v2  Locked Compass  – freeze heading at session start, never update
 *  v3  GPS Bearing     – derive heading from GPS movement only, no compass
 *  v4  Camera Anchored – place waypoints at XR camera position, no heading
 *  v5  Smoothed Heading– LERP compass updates slowly to reduce tilt jitter
 *  v6  No Heading      – zero rotation always, raw GPS local coords
 * =========================================================================== */
const TRAIL_MODE = (function () {
  var modeParam = new URLSearchParams(window.location.search).get('mode');
  return (modeParam && /^v[1-6]$/.test(modeParam)) ? modeParam : 'v1';
}());

const TRAIL_MODE_NAMES = {
  v1: 'Live Compass',
  v2: 'Locked Compass',
  v3: 'GPS Bearing',
  v4: 'Camera Anchored',
  v5: 'Smoothed Heading',
  v6: 'No Heading',
};

/* ===========================================================================
 * TRAIL CONSTANTS
 * =========================================================================== */
const WAYPOINT_DIST_M        = 4;     // metres walked between automatic waypoint drops
const WAYPOINT_LIFE_S        = 3600;  // seconds before a waypoint fades (1 hour)
const MAX_WAYPOINTS          = 300;   // max waypoints kept in scene simultaneously
const MIN_GPS_CALIB_DIST_M   = 5;     // min GPS travel (m) before motion-based heading calibration
const MIN_XR_CALIB_DIST_M    = 0.5;   // min XR camera travel (m) required for calibration
const MAX_GPS_PTS        = 2000;   // max GPS path points stored
const GPS_MIN_MOVE_M     = 2;      // minimum GPS movement (m) to register (filters jitter)
const SIM_MOVEMENT_SCALE = 15;     // sim-mode: multiply camera metres to virtual metres
const MINIMAP_ZOOM_M     = 80;     // metres radius visible in player-centred map
const MINIMAP_UPDATE_PROB= 0.04;   // probability per sim-frame of redrawing the map

/* Waypoint colour - single hue that shifts gradually with total distance walked */
const HUE_CYCLE_M   = 600;   // metres for one full hue rotation
const WAYPOINT_SAT  = 0.85;
const WAYPOINT_LIT  = 0.55;

function waypointHue() {
  return (GAME.totalDistM / HUE_CYCLE_M) % 1.0;
}

/* ===========================================================================
 * GAME / TRACKING STATE
 * =========================================================================== */
const GAME = {
  phase:          'idle',   // 'idle' | 'tracking'

  /* GPS path */
  gpsPath:        [],       // [{lat, lng, mx, mz}]
  totalDistM:     0,
  waypointAccumM: 0,        // metres since last waypoint drop

  /* GPS watch */
  watchId:        null,
  lastGPS:        null,
  gpsReady:       false,

  /* Sim fallback (no GPS) */
  _noGPS:         false,
  _simLastCamPos: null,

  /* AR waypoint markers */
  waypoints:      [],       // [{mesh, light, age, gpsLat, gpsLng, hue}]

  /* Compass heading - degrees clockwise from geographic North.
     This is the compass bearing the XR world's -Z axis is pointing at session
     start.  All GPS local coords are rotated by this angle before use as XR
     coordinates.  Frozen at tracking start so it never changes mid-session.  */
  compassHeading: 0,
  compassLocked:  false,

  /* Live heading - always updated from the device orientation sensor, even
     during tracking.  Used for HUD display only; never used for coordinate
     transforms.                                                              */
  liveHeading:    0,

  /* XR camera position (x, z) when the first GPS fix arrives.
     Used to offset GPS-computed XR positions so that waypoints appear at the
     correct physical location even if the player moved between AR session start
     and the first GPS fix.                                                    */
  gpsOriginXR:    null,

  /* XR camera position (x, z) captured at the same moment as the first GPS
     fix.  Together with gpsOriginXR it forms the "before" sample used by the
     motion-based heading calibration below.                                  */
  xrPosAtFirstGPS:  null,

  /* True once the GPS→XR rotation angle has been auto-calibrated from real
     movement.  Before calibration the device compass heading is used; after
     ≥5 m of GPS movement the heading is recomputed from the GPS+XR delta
     vectors and used for all subsequent transforms and re-sync operations.   */
  headingCalibrated: false,
};

let lastReticlePos = null;  // world-space reticle position, updated each frame

/* ===========================================================================
 * DEBUG STATE
 * =========================================================================== */
const DEBUG = {
  showAxes:       false,
  showGrid:       false,
  showPlanes:     false,
  showReticle:    true,
  showBBox:       false,
  wireframe:      false,
  showFPS:        true,
  showCamMatrix:  false,
  showXRInfo:     false,
  showHitInfo:    false,
};

/* ===========================================================================
 * THREE.JS OBJECTS
 * =========================================================================== */
let renderer, scene, camera, clock;
let axesHelper, gridHelper, shadowPlane;
let reticle, reticleRing;

/* xrRoot: rotated around Y for heading alignment (heading = compassHeading).
 * waypointRoot: child of xrRoot; all waypoint meshes and lights live here.
 * Rotating xrRoot re-aligns the entire GPS trail without touching individual
 * waypoints — this is what prevents cardinal-direction drift.             */
let xrRoot = null, waypointRoot = null;

/* ===========================================================================
 * WEBXR STATE
 * =========================================================================== */
let xrSession        = null;
let hitTestSource    = null;
let htSourcePending  = false;
let isARActive       = false;
let simulationMode   = false;

/* Placed objects in idle/debug mode */
let placedObjects = [];

/* Plane detection */
const planeOverlays = new Map();

/* FPS tracking */
let fpsFrames = 0, fpsLast = 0, fpsCurrent = 0;

/* Simulation orbit state */
let orbitTheta = 0, orbitPhi = Math.PI / 4;
let isDragging = false, dragX = 0, dragY = 0;
let simPreviewMesh = null;

/* Split-screen state */
let isSplitScreen = false;

/* ===========================================================================
 * INIT
 * =========================================================================== */
async function init() {
  setupThreeJS();
  setupDebugPanel();
  setupResizeHandler();
  setupOrbitControls();
  setupCompass();

  /* Show active mode in UI */
  var modeName = TRAIL_MODE_NAMES[TRAIL_MODE] || TRAIL_MODE;
  document.getElementById('version-badge').textContent = 'v0.5 · ' + modeName;
  document.title = 'GPS AR Trail · ' + modeName;

  let arSupported = false;
  if (navigator.xr) {
    try { arSupported = await navigator.xr.isSessionSupported('immersive-ar'); }
    catch (_) { arSupported = false; }
  }

  if (arSupported) {
    document.getElementById('start-ar-btn').disabled = false;
    updateStatus('AR ready - tap "Start AR" to begin tracking.');
  } else {
    document.getElementById('start-ar-btn').disabled = false;
    simulationMode = true;
    updateStatus('Simulation mode (WebXR AR not available on this device).');
    startSimulation();
  }

  document.getElementById('start-ar-btn').addEventListener('click', toggleAR);
}

/* ===========================================================================
 * COMPASS HEADING
 *
 * We listen for deviceorientationabsolute (Android) and deviceorientation
 * (iOS).  The heading is stored in GAME.compassHeading and immediately applied
 * to xrRoot.rotation.y so the GPS trail stays aligned with geographic North.
 *
 * During tracking the heading is still updated — because heading only rotates
 * xrRoot (it is no longer baked into individual waypoint positions), updating
 * it at any time is safe and does not cause waypoints to jump.
 * ===========================================================================  */
function setupCompass() {
  function handleOrientation(e) {
    let heading = null;

    /* iOS Safari: webkitCompassHeading is degrees CW from geographic North   */
    if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) {
      heading = e.webkitCompassHeading;

    /* Android absolute orientation: alpha is CCW from North, so
       compass heading = (360 - alpha) % 360                                  */
    } else if (e.absolute && e.alpha != null && !isNaN(e.alpha)) {
      heading = (360 - e.alpha) % 360;
    }

    if (heading !== null) {
      /* Always keep the live heading up-to-date for HUD display. */
      GAME.liveHeading = heading;

      /* Mode-specific compass handling:
         v1 – always update (default)
         v2 – only update before tracking starts (locked at session start)
         v3 – compass ignored; heading comes from GPS motion calibration
         v4 – no heading rotation needed
         v5 – slow LERP toward new value (reduces tilt jitter)
         v6 – always zero; compass ignored                                   */
      if (TRAIL_MODE === 'v1') {
        GAME.compassHeading = heading;
        if (xrRoot) xrRoot.rotation.y = heading * Math.PI / 180;

      } else if (TRAIL_MODE === 'v2') {
        /* Only update heading before tracking — lock it at session start */
        if (GAME.phase !== 'tracking') {
          GAME.compassHeading = heading;
          if (xrRoot) xrRoot.rotation.y = heading * Math.PI / 180;
        }

      } else if (TRAIL_MODE === 'v5') {
        /* Exponential smoothing: lerp at 5 % per event toward new value */
        var headingDiff = heading - GAME.compassHeading;
        while (headingDiff >  180) headingDiff -= 360;
        while (headingDiff < -180) headingDiff += 360;
        GAME.compassHeading = (((GAME.compassHeading + headingDiff * 0.05) % 360) + 360) % 360;
        if (xrRoot) xrRoot.rotation.y = GAME.compassHeading * Math.PI / 180;

      }
      /* v3, v4, v6 – compass not applied to xrRoot */

      if (!GAME.compassLocked) {
        GAME.compassLocked = true;
        updateGPSDebugDisplay();
      }
    }
  }

  window.addEventListener('deviceorientationabsolute', handleOrientation, true);
  window.addEventListener('deviceorientation', function(e) {
    if (!e.absolute) handleOrientation(e);
  }, true);
}

/* Request iOS 13+ orientation permission (must be called from a user gesture) */
async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        console.warn('DeviceOrientation permission denied - compass alignment unavailable.');
      }
    } catch (err) {
      console.warn('DeviceOrientation requestPermission error:', err);
    }
  }
}

/* ---------------------------------------------------------------------------
 * gpsLocalToXR — retained for reference / legacy callers only.
 *
 * In v0.5 this function is no longer used for placing waypoints.  Waypoints
 * are placed directly at (mx, y, mz) in waypointRoot (child of xrRoot) and
 * the compass rotation is applied by xrRoot.rotation.y = compassHeading*π/180.
 * --------------------------------------------------------------------------- */
function gpsLocalToXR(mx, mz) {
  const H  = GAME.compassHeading * Math.PI / 180;
  const ox = GAME.gpsOriginXR ? GAME.gpsOriginXR.x : 0;
  const oz = GAME.gpsOriginXR ? GAME.gpsOriginXR.z : 0;
  return {
    x:  mx * Math.cos(H) + mz * Math.sin(H) + ox,
    z: -mx * Math.sin(H) + mz * Math.cos(H) + oz,
  };
}

/* ===========================================================================
 * THREE.JS SETUP
 * =========================================================================== */
function setupThreeJS() {
  renderer = new THREE.WebGLRenderer({
    canvas:    document.getElementById('ar-canvas'),
    antialias: true,
    alpha:     true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.xr.enabled        = true;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 200);
  camera.position.set(0, 1.2, 2.5);
  camera.lookAt(0, 0, 0);

  clock = new THREE.Clock();

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(4, 8, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far  = 30;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -5;
  sun.shadow.camera.right = sun.shadow.camera.top   = 5;
  scene.add(sun);

  axesHelper = new THREE.AxesHelper(0.5);
  axesHelper.visible = DEBUG.showAxes;
  scene.add(axesHelper);

  gridHelper = new THREE.GridHelper(6, 30, 0x444444, 0x222222);
  gridHelper.visible = DEBUG.showGrid;
  scene.add(gridHelper);

  const shadowGeo = new THREE.PlaneGeometry(20, 20);
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.35 });
  shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.receiveShadow = true;
  shadowPlane.visible = false;
  scene.add(shadowPlane);

  /* xrRoot / waypointRoot — GPS world hierarchy.
   * xrRoot.rotation.y = compassHeading * π/180 keeps the GPS local frame
   * (East=+X, South=+Z) aligned with the XR world frame at all times.
   * waypointRoot is a child of xrRoot so all waypoints rotate in sync.    */
  xrRoot      = new THREE.Object3D();
  waypointRoot = new THREE.Object3D();
  xrRoot.add(waypointRoot);
  scene.add(xrRoot);

  /* Reticle ring */
  const reticleGeo = new THREE.RingGeometry(0.06, 0.10, 36).rotateX(-Math.PI / 2);
  const reticleMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide });
  reticle = new THREE.Mesh(reticleGeo, reticleMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const outerRingGeo = new THREE.RingGeometry(0.11, 0.135, 36).rotateX(-Math.PI / 2);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.4,
  });
  reticleRing = new THREE.Mesh(outerRingGeo, outerRingMat);
  reticleRing.matrixAutoUpdate = false;
  reticleRing.visible = false;
  scene.add(reticleRing);

  renderer.setAnimationLoop(renderLoop);
}

/* ---------------------------------------------------------------------------
 * Apply or remove split-screen (XR view top half, map bottom half)
 * --------------------------------------------------------------------------- */
function setSplitScreen(enabled) {
  isSplitScreen = enabled;
  const mapH = Math.round(window.innerHeight / 2);
  const arH  = window.innerHeight - mapH;

  if (enabled) {
    /* Three.js renders only into the top half via viewport + scissor.
       The canvas itself remains full-screen so the AR camera feed fills the
       whole screen (the bottom half camera feed is covered by the map).      */
    renderer.setViewport(0, mapH, window.innerWidth, arH);
    renderer.setScissor(0, mapH, window.innerWidth, arH);
    renderer.setScissorTest(true);
    camera.aspect = window.innerWidth / arH;
    camera.updateProjectionMatrix();

    document.getElementById('map-divider').style.display    = '';
    document.getElementById('minimap-canvas').style.display = '';
    document.getElementById('controls').classList.remove('no-split');
    document.getElementById('placed-count').classList.remove('no-split');
    updateMapCanvas();
  } else {
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissorTest(false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    document.getElementById('map-divider').style.display    = 'none';
    document.getElementById('minimap-canvas').style.display = 'none';
    document.getElementById('controls').classList.add('no-split');
    document.getElementById('placed-count').classList.add('no-split');
  }
}

/* Resize minimap canvas to exactly fill the bottom half */
function updateMapCanvas() {
  const mc  = document.getElementById('minimap-canvas');
  mc.width  = window.innerWidth;
  mc.height = Math.round(window.innerHeight / 2);
}

/* ===========================================================================
 * SIMULATION MODE
 * =========================================================================== */
function startSimulation() {
  shadowPlane.visible = true;
  gridHelper.visible  = true;

  scene.background = new THREE.Color(0x0a0e1a);
  scene.fog        = new THREE.Fog(0x0a0e1a, 8, 20);

  const geo = new THREE.TorusKnotGeometry(0.38, 0.14, 120, 18);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x00ff88, roughness: 0.3, metalness: 0.55,
    emissive: 0x003322, emissiveIntensity: 0.4,
  });
  simPreviewMesh = new THREE.Mesh(geo, mat);
  simPreviewMesh.castShadow = true;
  simPreviewMesh.position.set(0, 0.5, 0);
  scene.add(simPreviewMesh);

  document.getElementById('start-ar-btn').textContent = '\u21ba Restart';
  document.getElementById('start-ar-btn').disabled    = false;

  document.getElementById('no-ar-banner').style.display = 'block';
  setTimeout(function() { document.getElementById('no-ar-banner').style.display = 'none'; }, 4500);

  document.getElementById('start-ar-btn').removeEventListener('click', toggleAR);
  document.getElementById('start-ar-btn').addEventListener('click', function() {
    if (GAME.phase !== 'idle') {
      stopTracking();
    }
    startTracking();
  });

  /* Attach idle-mode click handlers */
  var canvas = document.getElementById('ar-canvas');
  canvas.addEventListener('click', onSimClick);
  canvas.addEventListener('touchstart', onSimTouch, { passive: true });

  startTracking();
}

function onSimClick(e) {
  if (GAME.phase !== 'idle') return;
  var rect = renderer.domElement.getBoundingClientRect();
  var ndc  = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1
  );
  var target = groundPositionFromNDC(ndc);
  if (target) placeObjectAtPosition(target);
}

function onSimTouch(e) {
  if (GAME.phase !== 'idle') return;
  if (e.touches.length !== 1) return;
  var touch = e.touches[0];
  var rect  = renderer.domElement.getBoundingClientRect();
  var ndc   = new THREE.Vector2(
    ((touch.clientX - rect.left) / rect.width)  * 2 - 1,
    -((touch.clientY - rect.top)  / rect.height) * 2 + 1
  );
  var target = groundPositionFromNDC(ndc);
  if (target) placeObjectAtPosition(target);
}

function groundPositionFromNDC(ndc) {
  var raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  var ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var target = new THREE.Vector3();
  return raycaster.ray.intersectPlane(ground, target) ? target : null;
}

/* ===========================================================================
 * AR SESSION
 * =========================================================================== */
async function toggleAR() {
  if (isARActive) { stopAR(); } else { startAR(); }
}

async function startAR() {
  /* Request iOS orientation permission before session so compass works */
  await requestOrientationPermission();

  try {
    xrSession = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'plane-detection', 'anchors'],
      domOverlay: { root: document.getElementById('ui-overlay') },
    });
  } catch (err) {
    updateStatus('Could not start AR: ' + err.message);
    console.error(err);
    return;
  }

  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(xrSession);

  xrSession.addEventListener('end', onXREnd);
  xrSession.addEventListener('select', onXRSelect);

  isARActive      = true;
  htSourcePending = false;
  hitTestSource   = null;

  document.getElementById('start-ar-btn').textContent = 'Stop AR';
  document.getElementById('start-ar-btn').classList.add('active');
  document.getElementById('plane-count').style.display  = '';

  updateStatus('AR active - walk to place GPS waypoints along your path.');
  updateXRInfoDisplay('Session started\nMode: immersive-ar\nFeatures: hit-test');

  startTracking();
}

async function stopAR() {
  if (xrSession) { try { await xrSession.end(); } catch (_) {} }
}

function onXREnd() {
  if (hitTestSource) { hitTestSource.cancel(); hitTestSource = null; }
  htSourcePending = false;
  xrSession   = null;
  isARActive  = false;
  reticle.visible     = false;
  reticleRing.visible = false;
  lastReticlePos = null;

  clearPlaneOverlays();

  if (GAME.phase === 'tracking') stopTracking();

  document.getElementById('start-ar-btn').textContent = 'Start AR';
  document.getElementById('start-ar-btn').classList.remove('active');
  document.getElementById('plane-count').style.display  = 'none';

  updateStatus('AR session ended.');
  updateXRInfoDisplay('No active session');
}

function onXRSelect() {
  /* Only place debug objects when not tracking */
  if (GAME.phase === 'idle' && reticle.visible) {
    var pos  = new THREE.Vector3();
    var quat = new THREE.Quaternion();
    reticle.matrix.decompose(pos, quat, new THREE.Vector3());
    placeObjectAtPosition(pos, quat);
  }
}

/* ===========================================================================
 * RENDER LOOP
 * =========================================================================== */
function renderLoop(timestamp, frame) {
  var delta = clock.getDelta();

  /* FPS counter */
  if (DEBUG.showFPS) {
    fpsFrames++;
    if (timestamp - fpsLast >= 1000) {
      fpsCurrent = Math.round(fpsFrames * 1000 / (timestamp - fpsLast));
      fpsFrames  = 0;
      fpsLast    = timestamp;
      document.getElementById('fps-counter').textContent = fpsCurrent + ' FPS';
    }
  }

  if (simulationMode && simPreviewMesh) {
    simPreviewMesh.rotation.x += delta * 0.4;
    simPreviewMesh.rotation.y += delta * 0.7;
  }

  if (reticleRing.visible) {
    reticleRing.material.opacity = 0.4 + 0.3 * Math.sin(timestamp * 0.003);
  }

  /* WebXR per-frame work */
  if (frame) {
    var refSpace = renderer.xr.getReferenceSpace();
    var session  = renderer.xr.getSession();

    if (!htSourcePending && !hitTestSource) {
      htSourcePending = true;
      session.requestReferenceSpace('viewer').then(function(viewerSpace) {
        session.requestHitTestSource({ space: viewerSpace })
          .then(function(src) { hitTestSource = src; })
          .catch(function(err) { console.warn('hitTestSource failed:', err); });
      });
    }

    if (hitTestSource) {
      var results = frame.getHitTestResults(hitTestSource);
      if (results.length > 0) {
        var pose = results[0].getPose(refSpace);
        if (pose) {
          var show = DEBUG.showReticle;
          reticle.visible     = show;
          reticleRing.visible = show;
          reticle.matrix.fromArray(pose.transform.matrix);
          reticleRing.matrix.fromArray(pose.transform.matrix);

          if (DEBUG.showHitInfo) {
            var m = pose.transform.matrix;
            updateHitInfoDisplay('pos: (' + m[12].toFixed(3) + ', ' + m[13].toFixed(3) + ', ' + m[14].toFixed(3) + ')');
          }

          var _p = new THREE.Vector3();
          reticle.matrix.decompose(_p, new THREE.Quaternion(), new THREE.Vector3());
          lastReticlePos = _p;
        }
      } else {
        reticle.visible     = false;
        reticleRing.visible = false;
        if (DEBUG.showHitInfo) updateHitInfoDisplay('No surface detected');
      }
    }

    if (DEBUG.showCamMatrix) {
      var viewerPose = frame.getViewerPose(refSpace);
      if (viewerPose && viewerPose.views.length > 0) {
        updateCamMatrixDisplay(viewerPose.views[0].transform.matrix);
      }
    }

    if (DEBUG.showXRInfo) {
      updateXRInfoDisplay(
        'Mode:        immersive-ar\n' +
        'renderState: ' + JSON.stringify({ baseLayer: session.renderState.baseLayer ? 'set' : 'none' }) + '\n' +
        'visibilityState: ' + (session.visibilityState || '-')
      );
    }

    if (frame.detectedPlanes) {
      updatePlaneOverlays(frame, refSpace);
    }
  }

  tickGame(delta, timestamp);

  renderer.render(scene, camera);
}

/* ===========================================================================
 * PLACE OBJECT (idle / debug mode)
 * =========================================================================== */
var SHAPE_NAMES = ['box', 'sphere', 'cone', 'cylinder', 'torus', 'dodecahedron', 'octahedron'];

function placeObjectAtPosition(position, quaternion) {
  var shape = SHAPE_NAMES[Math.floor(Math.random() * SHAPE_NAMES.length)];
  var geo   = buildGeometry(shape);

  var hue  = Math.random();
  var col  = new THREE.Color().setHSL(hue, 0.9, 0.55);
  var mat  = new THREE.MeshStandardMaterial({
    color:     col,
    roughness: 0.45,
    metalness: 0.35,
    wireframe: DEBUG.wireframe,
  });

  var mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  if (quaternion) mesh.quaternion.copy(quaternion);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  var bboxHelper = new THREE.BoxHelper(mesh, 0xffff00);
  bboxHelper.visible = DEBUG.showBBox;
  scene.add(bboxHelper);

  placedObjects.push({ mesh: mesh, bboxHelper: bboxHelper, material: mat });
  updatePlacedCount();
  popIn(mesh);
}

function buildGeometry(shape) {
  switch (shape) {
    case 'box':          return new THREE.BoxGeometry(0.18, 0.18, 0.18);
    case 'sphere':       return new THREE.SphereGeometry(0.1, 32, 32);
    case 'cone':         return new THREE.ConeGeometry(0.09, 0.2, 32);
    case 'cylinder':     return new THREE.CylinderGeometry(0.06, 0.1, 0.2, 32);
    case 'torus':        return new THREE.TorusGeometry(0.09, 0.035, 16, 64);
    case 'dodecahedron': return new THREE.DodecahedronGeometry(0.1);
    case 'octahedron':   return new THREE.OctahedronGeometry(0.12);
    default:             return new THREE.BoxGeometry(0.18, 0.18, 0.18);
  }
}

function popIn(mesh) {
  mesh.scale.set(0.001, 0.001, 0.001);
  var start = performance.now();
  var dur   = 420;

  function tick() {
    var t    = Math.min((performance.now() - start) / dur, 1);
    var ease = 1 - Math.pow(1 - t, 3);
    mesh.scale.setScalar(ease);
    if (t < 1) requestAnimationFrame(tick);
    else mesh.scale.set(1, 1, 1);
  }
  requestAnimationFrame(tick);
}

function clearObjects() {
  placedObjects.forEach(function(obj) {
    scene.remove(obj.mesh);
    scene.remove(obj.bboxHelper);
    obj.mesh.geometry.dispose();
    obj.mesh.material.dispose();
  });
  placedObjects = [];
  clearWaypoints();
  updatePlacedCount();
}

/* ===========================================================================
 * PLANE DETECTION
 * =========================================================================== */
function buildPlaneGeometry(polygon) {
  if (!polygon || polygon.length < 3) return new THREE.PlaneGeometry(0.1, 0.1);
  var n = polygon.length;
  var verts = new Float32Array(n * 3);
  for (var i = 0; i < n; i++) {
    verts[i * 3]     = polygon[i].x;
    verts[i * 3 + 1] = 0;
    verts[i * 3 + 2] = polygon[i].z;
  }
  var idx = [];
  for (var i2 = 1; i2 < n - 1; i2++) idx.push(0, i2, i2 + 1);

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function updatePlaneOverlays(frame, refSpace) {
  var currentPlanes = frame.detectedPlanes;

  for (var entry of planeOverlays) {
    if (!currentPlanes.has(entry[0])) {
      scene.remove(entry[1].mesh);
      entry[1].mesh.geometry.dispose();
      entry[1].mesh.material.dispose();
      planeOverlays.delete(entry[0]);
    }
  }

  var wallCount = 0, floorCount = 0;

  for (var plane of currentPlanes) {
    var isWall = plane.orientation === 'vertical';
    if (isWall) wallCount++; else floorCount++;

    var data = planeOverlays.get(plane);
    var needsRebuild = !data || data.lastChanged !== plane.lastChangedTime;

    if (needsRebuild) {
      var geo   = buildPlaneGeometry(plane.polygon);
      var color = isWall ? 0xff6600 : 0x0066ff;

      if (!data) {
        var mat = new THREE.MeshBasicMaterial({
          color: color, transparent: true, opacity: 0.25,
          side: THREE.DoubleSide, depthWrite: false,
        });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        mesh.visible = DEBUG.showPlanes;
        scene.add(mesh);
        data = { mesh: mesh, lastChanged: plane.lastChangedTime };
        planeOverlays.set(plane, data);
      } else {
        data.mesh.geometry.dispose();
        data.mesh.geometry = geo;
        data.lastChanged   = plane.lastChangedTime;
      }
    }

    var pose = frame.getPose(plane.planeSpace, refSpace);
    if (pose) data.mesh.matrix.fromArray(pose.transform.matrix);
  }

  updatePlaneCount(wallCount, floorCount);
}

function clearPlaneOverlays() {
  for (var entry of planeOverlays) {
    scene.remove(entry[1].mesh);
    entry[1].mesh.geometry.dispose();
    entry[1].mesh.material.dispose();
  }
  planeOverlays.clear();
  updatePlaneCount(0, 0);
}

/* ===========================================================================
 * ORBIT CONTROLS (simulation only)
 * =========================================================================== */
function setupOrbitControls() {
  var canvas = document.getElementById('ar-canvas');
  var R = 3.5;

  function applyOrbit() {
    orbitPhi = Math.max(0.1, Math.min(Math.PI / 2.2, orbitPhi));
    camera.position.set(
      R * Math.sin(orbitPhi) * Math.sin(orbitTheta),
      R * Math.cos(orbitPhi),
      R * Math.sin(orbitPhi) * Math.cos(orbitTheta)
    );
    camera.lookAt(0, 0.3, 0);
  }

  canvas.addEventListener('mousedown', function(e) {
    if (e.button !== 0 || !simulationMode) return;
    isDragging = true; dragX = e.clientX; dragY = e.clientY;
  });
  window.addEventListener('mousemove', function(e) {
    if (!isDragging) return;
    orbitTheta -= (e.clientX - dragX) * 0.006;
    orbitPhi   += (e.clientY - dragY) * 0.006;
    dragX = e.clientX; dragY = e.clientY;
    applyOrbit();
  });
  window.addEventListener('mouseup', function() { isDragging = false; });

  var pinchDist = 0;
  canvas.addEventListener('touchmove', function(e) {
    if (!simulationMode) return;
    if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var d  = Math.sqrt(dx * dx + dy * dy);
      if (pinchDist) camera.position.multiplyScalar(1 / (d / pinchDist));
      pinchDist = d;
    } else if (e.touches.length === 1) {
      pinchDist = 0;
    }
  }, { passive: true });
  canvas.addEventListener('touchend', function() { pinchDist = 0; });
}

/* ===========================================================================
 * DEBUG PANEL
 * =========================================================================== */
function setupDebugPanel() {
  document.getElementById('debug-toggle-btn').addEventListener('click', function() {
    var panel = document.getElementById('debug-panel');
    panel.classList.toggle('hidden');
    document.getElementById('debug-toggle-btn').classList.toggle('active', !panel.classList.contains('hidden'));
  });
  document.getElementById('close-debug-btn').addEventListener('click', function() {
    document.getElementById('debug-panel').classList.add('hidden');
    document.getElementById('debug-toggle-btn').classList.remove('active');
  });
  document.getElementById('clear-btn').addEventListener('click', clearObjects);

  bindToggle('dbg-axes',      'showAxes',      function(v) { axesHelper.visible  = v; });
  bindToggle('dbg-grid',      'showGrid',      function(v) { gridHelper.visible  = v; });
  bindToggle('dbg-planes',    'showPlanes',    function(v) {
    for (var e of planeOverlays) e[1].mesh.visible = v;
  });
  bindToggle('dbg-reticle',   'showReticle',   function(v) {
    reticle.visible     = isARActive && v;
    reticleRing.visible = isARActive && v;
  });
  bindToggle('dbg-bbox',      'showBBox',      function(v) {
    placedObjects.forEach(function(o) { o.bboxHelper.visible = v; });
  });
  bindToggle('dbg-wireframe', 'wireframe',     function(v) {
    placedObjects.forEach(function(o) { o.material.wireframe = v; });
  });
  bindToggle('dbg-fps',       'showFPS',       function(v) {
    document.getElementById('fps-counter').style.display = v ? '' : 'none';
    if (!v) document.getElementById('fps-counter').textContent = '';
  });
  bindToggle('dbg-cam-matrix','showCamMatrix', function(v) {
    document.getElementById('section-cam-matrix').style.display = v ? '' : 'none';
    if (!v) document.getElementById('cam-matrix-display').textContent = '-';
  });
  bindToggle('dbg-xr-info',   'showXRInfo',    function(v) {
    document.getElementById('section-xr-info').style.display = v ? '' : 'none';
    if (!v) document.getElementById('xr-info-display').textContent = '-';
  });
  bindToggle('dbg-hit-info',  'showHitInfo',   function(v) {
    document.getElementById('section-hit-info').style.display = v ? '' : 'none';
    if (!v) document.getElementById('hit-info-display').textContent = '-';
  });

  document.getElementById('dbg-reticle').checked = DEBUG.showReticle;
  document.getElementById('dbg-fps').checked      = DEBUG.showFPS;
}

function bindToggle(id, key, callback) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', function(e) {
    DEBUG[key] = e.target.checked;
    callback(e.target.checked);
  });
}

/* ===========================================================================
 * RESIZE
 * =========================================================================== */
function setupResizeHandler() {
  window.addEventListener('resize', function() {
    if (isARActive) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (isSplitScreen) {
      var mapH = Math.round(window.innerHeight / 2);
      var arH  = window.innerHeight - mapH;
      renderer.setViewport(0, mapH, window.innerWidth, arH);
      renderer.setScissor(0, mapH, window.innerWidth, arH);
      camera.aspect = window.innerWidth / arH;
      updateMapCanvas();
    } else {
      camera.aspect = window.innerWidth / window.innerHeight;
    }
    camera.updateProjectionMatrix();
    drawMap();
  });
}

/* ===========================================================================
 * UI HELPERS
 * =========================================================================== */
function updateStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

function updatePlacedCount() {
  var el = document.getElementById('placed-count');
  if (!el) return;
  if (GAME.phase === 'tracking') {
    el.textContent = Math.round(GAME.totalDistM) + 'm \u00b7 Pts: ' + GAME.waypoints.length;
  } else {
    el.textContent = 'Objects: ' + placedObjects.length;
  }
}

function updatePlaneCount(walls, floors) {
  var el = document.getElementById('plane-count');
  if (el) el.textContent = 'Walls: ' + walls + ' \u00b7 Floors: ' + floors;
}

function updateCamMatrixDisplay(matrix) {
  var m = Array.from(matrix).map(function(v) { return v.toFixed(3).padStart(7); });
  document.getElementById('cam-matrix-display').textContent =
    '[' + m[0] + ',' + m[4] + ',' + m[8]  + ',' + m[12] + ']\n' +
    '[' + m[1] + ',' + m[5] + ',' + m[9]  + ',' + m[13] + ']\n' +
    '[' + m[2] + ',' + m[6] + ',' + m[10] + ',' + m[14] + ']\n' +
    '[' + m[3] + ',' + m[7] + ',' + m[11] + ',' + m[15] + ']';
}

function updateXRInfoDisplay(text) {
  document.getElementById('xr-info-display').textContent = text;
}

function updateHitInfoDisplay(text) {
  document.getElementById('hit-info-display').textContent = text;
}

function updateGPSDebugDisplay() {
  var el = document.getElementById('gps-debug-display');
  if (!el) return;
  var lp = GAME.gpsPath.length > 0 ? GAME.gpsPath[GAME.gpsPath.length - 1] : null;
  el.textContent =
    'mode:           ' + TRAIL_MODE + ' (' + (TRAIL_MODE_NAMES[TRAIL_MODE] || '?') + ')\n' +
    'compassHeading: ' + GAME.compassHeading.toFixed(1) + '\u00b0\n' +
    'compassLocked:  ' + GAME.compassLocked + '\n' +
    'headingCalib:   ' + GAME.headingCalibrated + '\n' +
    'gpsReady:       ' + GAME.gpsReady + '\n' +
    'totalDistM:     ' + GAME.totalDistM.toFixed(1) + 'm\n' +
    'waypoints:      ' + GAME.waypoints.length + '\n' +
    (lp ? 'lastPos: (' + lp.mx.toFixed(1) + ', ' + lp.mz.toFixed(1) + ')' : 'lastPos: -');
}

function updateTrailHUD() {
  var distEl    = document.getElementById('trail-dist');
  var ptsEl     = document.getElementById('trail-pts');
  var headingEl = document.getElementById('trail-heading');
  if (distEl)    distEl.textContent    = Math.round(GAME.totalDistM) + 'm';
  if (ptsEl)     ptsEl.textContent     = String(GAME.waypoints.length);
  if (headingEl) headingEl.textContent = Math.round(GAME.liveHeading) + '\u00b0';
}

/* ===========================================================================
 * BOOT
 * =========================================================================== */
window.addEventListener('DOMContentLoaded', init);

/* ===========================================================================
 * GPS TRAIL TRACKING
 * =========================================================================== */

function startTracking() {
  stopGPS();
  clearWaypoints();

  GAME.phase          = 'tracking';
  GAME.gpsPath        = [];
  GAME.totalDistM     = 0;
  GAME.waypointAccumM = 0;
  GAME.watchId        = null;
  GAME.lastGPS        = null;
  GAME.gpsReady       = false;
  GAME._noGPS         = false;
  GAME._simLastCamPos = null;
  GAME.waypoints      = [];
  GAME.gpsOriginXR    = null;
  GAME.xrPosAtFirstGPS  = null;
  GAME.headingCalibrated = false;

  /* Reset the GPS world root so the new session starts at the XR origin.
     The position will be re-anchored to the first GPS fix in onGPSUpdate.   */
  if (xrRoot) {
    xrRoot.position.set(0, 0, 0);
    /* v4/v6 use zero rotation; all others start with current compass heading */
    xrRoot.rotation.y = (TRAIL_MODE === 'v4' || TRAIL_MODE === 'v6')
      ? 0
      : GAME.compassHeading * Math.PI / 180;
  }

  document.getElementById('status-bar').style.display = 'none';
  document.getElementById('trail-hud').style.display  = '';

  setSplitScreen(true);
  updateTrailHUD();
  updatePlacedCount();
  drawMap();
  startGPS();

  updateStatus('GPS tracking started - walk to place waypoints.');
}

function stopTracking() {
  GAME.phase = 'idle';
  stopGPS();
  document.getElementById('trail-hud').style.display  = 'none';
  document.getElementById('status-bar').style.display = '';
  setSplitScreen(false);
  updateStatus('Tracking stopped.');
}

function startGPS() {
  if (!navigator.geolocation) { onGPSError({ message: 'not supported' }); return; }
  GAME.watchId = navigator.geolocation.watchPosition(
    onGPSUpdate, onGPSError,
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 }
  );
}

function stopGPS() {
  if (GAME.watchId !== null) {
    navigator.geolocation.clearWatch(GAME.watchId);
    GAME.watchId = null;
  }
}

function onGPSUpdate(pos) {
  if (GAME.phase !== 'tracking') return;

  var lat = pos.coords.latitude;
  var lng = pos.coords.longitude;

  /* Use GPS heading to bootstrap compass if device orientation not yet locked.
     Skipped for v4 (no heading) and v6 (zero heading always).               */
  if (!GAME.compassLocked &&
      pos.coords.heading != null && !isNaN(pos.coords.heading) &&
      TRAIL_MODE !== 'v4' && TRAIL_MODE !== 'v6') {
    GAME.compassHeading = pos.coords.heading;
    GAME.compassLocked  = true;
    if (xrRoot) xrRoot.rotation.y = GAME.compassHeading * Math.PI / 180;
  }

  /* First fix: anchor the GPS world root to the player's current XR position.
     In v4 (camera-anchored) the xrRoot stays at origin — no GPS anchoring.  */
  if (!GAME.gpsReady) {
    GAME.gpsReady = true;
    GAME.lastGPS  = { lat: lat, lng: lng };

    if (TRAIL_MODE !== 'v4') {
      /* Move xrRoot so that the GPS local origin (0,0,0) coincides with the XR
         camera position.  This corrects for any player movement between AR
         session start and the first GPS fix.                                  */
      const _camOrigin = new THREE.Vector3();
      camera.getWorldPosition(_camOrigin);
      if (xrRoot) xrRoot.position.set(_camOrigin.x, 0, _camOrigin.z);

      /* Keep gpsOriginXR for legacy/debug display purposes only. */
      GAME.gpsOriginXR     = { x: _camOrigin.x, z: _camOrigin.z };
      GAME.xrPosAtFirstGPS = { x: _camOrigin.x, z: _camOrigin.z };
    }

    GAME.gpsPath.push({ lat: lat, lng: lng, mx: 0, mz: 0 });

    /* Drop an origin waypoint exactly at the player's current position.     */
    placeWaypoint(lat, lng);

    showToast('\ud83d\udee0\ufe0f GPS locked! Walk to place waypoints.', 3000);
    drawMap();
    updateGPSDebugDisplay();
    return;
  }

  var distFromLast = haversineM(GAME.lastGPS.lat, GAME.lastGPS.lng, lat, lng);
  if (distFromLast < GPS_MIN_MOVE_M) return;

  GAME.totalDistM += distFromLast;
  GAME.lastGPS = { lat: lat, lng: lng };

  var origin = GAME.gpsPath[0];
  var local  = gpsToLocal(origin.lat, origin.lng, lat, lng);
  if (GAME.gpsPath.length < MAX_GPS_PTS) {
    GAME.gpsPath.push({ lat: lat, lng: lng, mx: local.mx, mz: local.mz });
  }

  /* Drop a waypoint pillar */
  GAME.waypointAccumM += distFromLast;
  if (GAME.waypointAccumM >= WAYPOINT_DIST_M) {
    GAME.waypointAccumM = 0;
    placeWaypoint(lat, lng);
  }

  /* -----------------------------------------------------------------------
   * Motion-based heading auto-calibration.
   *
   * Derives compass heading from GPS + XR camera travel vectors after 5 m.
   * Applies to v1 (live compass — refines it), v3 (GPS-only — primary
   * source), and v5 (smoothed — overrides the smoothed value).
   * Skipped for v2 (locked at start), v4 (no heading), v6 (zero heading).
   * ----------------------------------------------------------------------- */
  if (!GAME.headingCalibrated && GAME.xrPosAtFirstGPS && isARActive &&
      TRAIL_MODE !== 'v2' && TRAIL_MODE !== 'v4' && TRAIL_MODE !== 'v6') {
    var gpsOrigin = GAME.gpsPath[0];
    var gpsMove = gpsToLocal(gpsOrigin.lat, gpsOrigin.lng, lat, lng);
    var gpsDist = Math.sqrt(gpsMove.mx * gpsMove.mx + gpsMove.mz * gpsMove.mz);

    if (gpsDist >= MIN_GPS_CALIB_DIST_M) {
      var camNow = new THREE.Vector3();
      camera.getWorldPosition(camNow);
      var xrDx   = camNow.x - GAME.xrPosAtFirstGPS.x;
      var xrDz   = camNow.z - GAME.xrPosAtFirstGPS.z;
      var xrDist = Math.sqrt(xrDx * xrDx + xrDz * xrDz);

      if (xrDist >= MIN_XR_CALIB_DIST_M) {
        var gpsBear = Math.atan2(gpsMove.mx, -gpsMove.mz) * 180 / Math.PI;
        var xrBear  = Math.atan2(xrDx, -xrDz) * 180 / Math.PI;
        var calibrated = ((gpsBear - xrBear) + 360) % 360;

        GAME.compassHeading    = calibrated;
        GAME.headingCalibrated = true;

        /* Apply the calibrated heading to xrRoot only — individual waypoints
           are at stable GPS local coords and do NOT need to be repositioned. */
        if (xrRoot) xrRoot.rotation.y = calibrated * Math.PI / 180;

        showToast('\ud83e\uddad Heading auto-calibrated from movement', 2500);
        updateGPSDebugDisplay();
      }
    }
  }

  updateTrailHUD();
  updatePlacedCount();
  drawMap();
  updateGPSDebugDisplay();
}

function onGPSError(err) {
  if (GAME._noGPS) return;
  GAME._noGPS = true;
  console.warn('GPS error:', err);
  showToast('\ud83c\udfae No GPS - sim mode: move the camera to explore!', 4000);
  drawMap();  /* Immediately show the "Sim mode" message on the map */
}

/* ===========================================================================
 * WAYPOINT PILLARS
 *
 * Each waypoint is a tall glowing cylinder anchored to GPS coordinates.
 * All waypoints use the same hue at any given moment; the hue shifts
 * gradually as more distance is walked so older waypoints have a slightly
 * different tint - making them visually distinguishable by time/distance.
 * The same hue value is stored with each waypoint and used in both XR and
 * the map so the colours always match.
 * ===========================================================================  */

var WAYPOINT_HEIGHT = 1.5;   /* metres tall */

function placeWaypoint(gpsLat, gpsLng) {
  if (!waypointRoot) return;  // guard: setupThreeJS not yet called

  /* Evict oldest if at capacity */
  if (GAME.waypoints.length >= MAX_WAYPOINTS) {
    var old = GAME.waypoints.shift();
    waypointRoot.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
    if (old.light) waypointRoot.remove(old.light);
  }

  /* Current hue for this waypoint */
  var hue    = waypointHue();
  var col    = new THREE.Color().setHSL(hue, WAYPOINT_SAT, WAYPOINT_LIT);
  var colHex = col.getHex();

  var geo = new THREE.CylinderGeometry(0.025, 0.06, WAYPOINT_HEIGHT, 8);
  var mat = new THREE.MeshStandardMaterial({
    color:             colHex,
    emissive:          colHex,
    emissiveIntensity: 1.8,
    transparent:       true,
    opacity:           1.0,
  });
  var mesh = new THREE.Mesh(geo, mat);

  /* Place the waypoint mesh inside waypointRoot.
   *
   * v4 (Camera Anchored): use the XR camera's current world position —
   *   no GPS→XR coordinate transform, no heading needed.
   *
   * All other modes: convert GPS lat/lng to local metres (East=+mx,
   *   South=+mz) and place directly in waypointRoot; heading is applied
   *   globally via xrRoot.rotation.y.                                       */
  var groundY = lastReticlePos ? lastReticlePos.y : 0;
  if (TRAIL_MODE === 'v4') {
    /* Camera-anchored: place at the XR camera's current world position.
       The XR runtime's VIO tracking gives accurate relative positions.     */
    var camWorld4 = new THREE.Vector3();
    camera.getWorldPosition(camWorld4);
    var camLocal4 = waypointRoot.worldToLocal(camWorld4.clone());
    mesh.position.set(camLocal4.x, groundY + WAYPOINT_HEIGHT / 2, camLocal4.z);
  } else if (gpsLat !== null && GAME.gpsPath.length > 0) {
    var origin = GAME.gpsPath[0];
    var lc     = gpsToLocal(origin.lat, origin.lng, gpsLat, gpsLng);
    /* lc.mx = East metres, lc.mz = South metres (South=+mz convention).
       These are placed directly — xrRoot handles the heading rotation.      */
    mesh.position.set(lc.mx, groundY + WAYPOINT_HEIGHT / 2, lc.mz);
  } else {
    /* Sim / no-GPS fallback: place at camera position in xrRoot local space */
    var camWorld = new THREE.Vector3();
    camera.getWorldPosition(camWorld);
    /* Convert camera world position to xrRoot local space */
    var camLocal = xrRoot ? xrRoot.worldToLocal(camWorld.clone()) : camWorld;
    mesh.position.set(camLocal.x, groundY + WAYPOINT_HEIGHT / 2, camLocal.z);
  }

  mesh.castShadow = false;
  waypointRoot.add(mesh);

  /* Point light at top of pillar — added to waypointRoot so it rotates with
     xrRoot and always stays above the pillar it belongs to.                 */
  var light = new THREE.PointLight(colHex, 2.5, 5.0);
  light.position.set(
    mesh.position.x,
    groundY + WAYPOINT_HEIGHT + 0.15,
    mesh.position.z
  );
  waypointRoot.add(light);

  GAME.waypoints.push({
    mesh: mesh, light: light,
    age: 0,
    gpsLat: gpsLat, gpsLng: gpsLng,
    hue: hue,
  });
  popIn(mesh);
}

function tickWaypoints(delta) {
  if (!waypointRoot) return;
  for (var i = GAME.waypoints.length - 1; i >= 0; i--) {
    var wp = GAME.waypoints[i];
    wp.age += delta;
    var opacity = Math.max(0, 1 - wp.age / WAYPOINT_LIFE_S);
    wp.mesh.material.opacity = opacity;
    if (wp.light) wp.light.intensity = opacity * 2.5;

    if (wp.age >= WAYPOINT_LIFE_S) {
      waypointRoot.remove(wp.mesh);
      wp.mesh.geometry.dispose();
      wp.mesh.material.dispose();
      if (wp.light) waypointRoot.remove(wp.light);
      GAME.waypoints.splice(i, 1);
    }
  }
}

function clearWaypoints() {
  if (waypointRoot) {
    for (var i = 0; i < GAME.waypoints.length; i++) {
      var wp = GAME.waypoints[i];
      waypointRoot.remove(wp.mesh);
      wp.mesh.geometry.dispose();
      wp.mesh.material.dispose();
      if (wp.light) waypointRoot.remove(wp.light);
    }
  }
  GAME.waypoints = [];
}

/* ---------------------------------------------------------------------------
 * resyncWaypointsToGPS — no longer repositions individual waypoints.
 *
 * In v0.5 waypoints are placed at stable GPS local coords in waypointRoot.
 * Heading changes are reflected by updating xrRoot.rotation.y only.
 * This function is retained so existing call-sites compile; the actual
 * xrRoot rotation update is handled in setupCompass / onGPSUpdate.
 * --------------------------------------------------------------------------- */
function resyncWaypointsToGPS() {
  /* Intentionally empty — xrRoot.rotation.y keeps the trail aligned. */
}

/* ===========================================================================
 * PER-FRAME GAME TICK
 * =========================================================================== */
function tickGame(delta, timestamp) {
  if (GAME.phase === 'idle') return;
  if (GAME._noGPS) simTickGPS(delta);
  tickWaypoints(delta);

  /* Always refresh the heading HUD so the live compass bearing is responsive
     regardless of whether the player is moving or GPS has fired recently.   */
  updateTrailHUD();

  /* Redraw the minimap often enough for the heading arrow to feel responsive,
     but throttled to avoid unnecessary canvas work on every frame.           */
  if (!GAME._lastMapDraw || timestamp - GAME._lastMapDraw >= 200) {
    drawMap();
    GAME._lastMapDraw = timestamp;
  }
}

function simTickGPS(delta) {
  var camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);

  if (GAME._simLastCamPos) {
    var moved = camPos.distanceTo(GAME._simLastCamPos);
    if (moved > 0.005) {
      var effective = moved * SIM_MOVEMENT_SCALE;
      GAME.totalDistM      += effective;
      GAME.waypointAccumM  += effective;

      if (GAME.waypointAccumM >= WAYPOINT_DIST_M) {
        GAME.waypointAccumM = 0;
        placeWaypoint(null, null);
      }

      updateTrailHUD();
      updatePlacedCount();

      if (Math.random() < MINIMAP_UPDATE_PROB) {
        var lastPt = GAME.gpsPath[GAME.gpsPath.length - 1] || { lat: 0, lng: 0, mx: 0, mz: 0 };
        var sc     = SIM_MOVEMENT_SCALE * 0.1;
        GAME.gpsPath.push({
          lat: lastPt.lat, lng: lastPt.lng,
          mx: lastPt.mx + (camPos.x - GAME._simLastCamPos.x) * sc,
          mz: lastPt.mz + (camPos.z - GAME._simLastCamPos.z) * sc,
        });
        if (GAME.gpsPath.length > MAX_GPS_PTS) GAME.gpsPath.shift();
        drawMap();
      }
    }
  }
  GAME._simLastCamPos = camPos.clone();
}

/* ===========================================================================
 * GPS MAP  (rendered into the bottom-half canvas)
 *
 * Player-centred, fixed zoom, North-up.
 * Waypoints are drawn with their stored hue so their map colour always
 * matches their XR pillar colour.
 * ===========================================================================  */
function drawMap() {
  var canvas = document.getElementById('minimap-canvas');
  if (!canvas || canvas.style.display === 'none') return;
  var ctx = canvas.getContext('2d');
  var W   = canvas.width;
  var H   = canvas.height;
  ctx.clearRect(0, 0, W, H);

  /* Background */
  ctx.fillStyle = 'rgba(4,8,20,0.97)';
  ctx.fillRect(0, 0, W, H);

  /* Top border */
  ctx.strokeStyle = 'rgba(0,255,136,0.35)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(W, 1); ctx.stroke();

  if (GAME.gpsPath.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font      = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(GAME._noGPS ? 'Sim mode - move camera to explore' : 'Searching GPS\u2026', W / 2, H / 2 - 6);
    ctx.font      = '11px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillText(Math.round(GAME.totalDistM) + 'm walked', W / 2, H / 2 + 14);
    drawNorthIndicator(ctx, W - 18, 18);
    return;
  }

  /* Player-centred projection.
     mx = East (+right on map), mz = South (+down on map) -> North is UP. */
  var lp    = GAME.gpsPath[GAME.gpsPath.length - 1];
  var cx    = lp.mx;
  var cz    = lp.mz;
  var scale = (Math.min(W, H) / 2 - 20) / MINIMAP_ZOOM_M;
  function toC(mx, mz) {
    return {
      x: W / 2 + (mx - cx) * scale,
      y: H / 2 + (mz - cz) * scale,
    };
  }

  /* GPS trail */
  if (GAME.gpsPath.length >= 2) {
    ctx.strokeStyle = 'rgba(0,220,80,0.6)';
    ctx.lineWidth   = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    var p0 = toC(GAME.gpsPath[0].mx, GAME.gpsPath[0].mz);
    ctx.moveTo(p0.x, p0.y);
    for (var i = 1; i < GAME.gpsPath.length; i++) {
      var p = toC(GAME.gpsPath[i].mx, GAME.gpsPath[i].mz);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Origin marker */
  var sp = toC(0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2); ctx.fill();

  /* Waypoint dots - each uses its stored hue to match the XR pillar */
  var origin = GAME.gpsPath[0];
  for (var i = 0; i < GAME.waypoints.length; i++) {
    var wp = GAME.waypoints[i];
    if (wp.gpsLat == null) continue;
    var lc  = gpsToLocal(origin.lat, origin.lng, wp.gpsLat, wp.gpsLng);
    var cp  = toC(lc.mx, lc.mz);
    var col = new THREE.Color().setHSL(wp.hue, WAYPOINT_SAT, WAYPOINT_LIT);
    var opac = Math.max(0.2, 1 - wp.age / WAYPOINT_LIFE_S);

    ctx.globalAlpha = opac;
    ctx.fillStyle   = '#' + col.getHexString();
    ctx.beginPath(); ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(cp.x, cp.y, 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* Player dot at centre */
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#00ff88';
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 4, 0, Math.PI * 2); ctx.fill();

  /* Heading arrow from player dot */
  if (GAME.compassLocked) {
    var hr = GAME.liveHeading * Math.PI / 180;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(W / 2, H / 2);
    ctx.lineTo(W / 2 + 10 * Math.sin(hr), H / 2 - 10 * Math.cos(hr));
    ctx.stroke();
  }

  /* Stats */
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(Math.round(GAME.totalDistM) + 'm', 8, H - 6);
  ctx.textAlign = 'right';
  ctx.fillText(GAME.waypoints.length + ' waypoints', W - 8, H - 6);

  /* Scale bar (20 m) */
  var barM  = 20;
  var barPx = barM * scale;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - barPx / 2, H - 14);
  ctx.lineTo(W / 2 + barPx / 2, H - 14);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(barM + 'm', W / 2, H - 4);

  drawNorthIndicator(ctx, W - 18, 18);
}

function drawNorthIndicator(ctx, cx, cy) {
  ctx.strokeStyle = 'rgba(255,170,0,0.55)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle   = '#ffaa00';
  ctx.font        = 'bold 9px sans-serif';
  ctx.textAlign   = 'center';
  ctx.fillText('N', cx, cy + 3.5);
}

/* ===========================================================================
 * TOAST NOTIFICATIONS
 * =========================================================================== */
var _toastEl    = null;
var _toastTimer = null;

function showToast(html, durationMs) {
  durationMs = durationMs || 2500;
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.style.cssText = [
      'position:fixed',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.72)',
      'border:1px solid rgba(0,255,136,0.45)',
      'border-radius:24px',
      'padding:10px 22px',
      'font-size:0.95rem',
      'font-weight:600',
      'pointer-events:none',
      'z-index:15',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
      'text-align:center',
      'max-width:88vw',
      'white-space:pre-wrap',
      'display:none',
      'transition:opacity 0.4s,transform 0.4s',
    ].join(';');
    document.body.appendChild(_toastEl);
  }
  _toastEl.style.bottom   = isSplitScreen ? 'calc(50% + 56px)' : '120px';
  _toastEl.innerHTML      = html;
  _toastEl.style.display  = '';
  _toastEl.style.opacity  = '1';
  _toastEl.style.transform = 'translateX(-50%) translateY(0)';

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() {
    _toastEl.style.opacity   = '0';
    _toastEl.style.transform = 'translateX(-50%) translateY(-20px)';
    setTimeout(function() { _toastEl.style.display = 'none'; }, 420);
  }, durationMs);
}

/* ===========================================================================
 * HAVERSINE / GPS MATH
 * =========================================================================== */
function haversineM(lat1, lng1, lat2, lng2) {
  var R    = 6371000;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a    = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
             Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ---------------------------------------------------------------------------
 * GPS delta -> local XZ metres
 *   mx > 0 = East of origin
 *   mx < 0 = West of origin
 *   mz > 0 = South of origin  (latitude decreasing)
 *   mz < 0 = North of origin  (latitude increasing)
 * --------------------------------------------------------------------------- */
function gpsToLocal(originLat, originLng, lat, lng) {
  var mx = haversineM(originLat, originLng, originLat, lng) * (lng >= originLng ? 1 : -1);
  var mz = haversineM(originLat, originLng, lat, originLng) * (lat >= originLat ? -1 : 1);
  return { mx: mx, mz: mz };
}

/* Local XZ metres -> GPS coordinates (inverse of gpsToLocal) */
const METERS_PER_DEG_LAT = 111111;
function localToGPS(originLat, originLng, mx, mz) {
  var metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(originLat * Math.PI / 180);
  return {
    lat: originLat - mz / METERS_PER_DEG_LAT,
    lng: originLng + mx / metersPerDegLng,
  };
}
