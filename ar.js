/**
 * ar.js — AR Experiment
 *
 * Uses Three.js + WebXR (immersive-ar + hit-test + plane-detection) to:
 *   • Stream the real-world camera as the scene background
 *   • Detect surfaces via the hit-test API and show a reticle
 *   • Detect floors and walls via the plane-detection API
 *   • Place random 3D objects on detected surfaces with a tap/click
 *   • Fall back to a simulation mode on non-XR browsers
 *
 * Debug panel (toggle with the ⚙ Debug button) exposes:
 *   Axes helper, ground grid, plane overlays (floors + walls),
 *   bounding boxes, wireframe, FPS counter, camera-world-matrix,
 *   XR session state, and live hit-test pose readout.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
 * TRAIL TREASURE HUNT
 * ═══════════════════════════════════════════════════════════════════════════
 * GPS-powered real-world adventure:
 *   • Your path is traced as a dotted line on the mini-map + AR footprints
 *   • A treasure is buried nearby when the game starts
 *   • Walk to collect 3 directional clues — each narrows the location
 *   • After all clues: an AR compass arrow guides you to the spot
 *   • When close enough a glowing chest appears — tap to dig it up!
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Trail Hunt constants ────────────────────────────────────────────────── */
const CLUE_INTERVAL_M    = 40;    // metres walked per clue
const CLUES_NEEDED       = 3;     // clues needed before compass fully unlocked
const TREASURE_SPAWN_M   = 8;     // GPS metres before AR chest appears
const TREASURE_MIN_M     = 40;    // min metres from start to bury
const TREASURE_MAX_M     = 120;   // max metres from start to bury
const FOOTPRINT_DIST_M   = 6;     // metres between footprint drops
const FOOTPRINT_LIFE_S   = 90;    // seconds before a footprint fades away
const MAX_FOOTPRINTS     = 40;    // max trail markers
const MAX_GPS_PTS        = 200;   // max GPS waypoints stored
const GPS_MIN_MOVE_M     = 2;     // minimum GPS movement (m) to register (filters jitter)
const SIM_MOVEMENT_SCALE = 15;    // multiply sim-mode camera distance for virtual metres
const MINIMAP_SIZE       = 160;   // mini-map canvas px
const MINIMAP_PADDING    = 1.4;   // extra scale padding around the GPS path bounds
const MINIMAP_UPDATE_PROB = 0.03; // probability per sim-frame of redrawing the mini-map

/* ─── Game state ──────────────────────────────────────────────────────────── */
const GAME = {
  phase:            'idle',  // 'idle' | 'explore' | 'hunt' | 'found'
  score:            0,
  highScore:        0,

  /* exploration */
  gpsPath:          [],      // [{lat, lng, mx, mz}]  mx/mz = metres from origin
  totalDistM:       0,       // total metres walked
  clues:            [],      // collected clue strings
  clueAccumM:       0,       // metres since last clue
  footAccumM:       0,       // metres since last footprint

  /* GPS watch */
  watchId:          null,
  lastGPS:          null,    // {lat, lng}
  gpsReady:         false,

  /* treasure */
  treasureGPS:      null,    // {lat, lng}
  distToTreasure:   Infinity,
  bearingToTreasure: 0,
  arChestSpawned:   false,
  treasureEntry:    null,    // {mesh, light, baseY}

  /* sim fallback (no GPS) */
  _noGPS:           false,
  _simLastCamPos:   null,

  /* AR trail markers */
  footprints:       [],      // [{mesh, age}]
};

let lastReticlePos = null;  // world-space position of reticle, updated each frame

/* ─── Debug state ─────────────────────────────────────────────────────────── */
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

/* ─── Three.js objects ────────────────────────────────────────────────────── */
let renderer, scene, camera, clock;
let axesHelper, gridHelper, shadowPlane;
let reticle, reticleRing;

/* ─── WebXR state ─────────────────────────────────────────────────────────── */
let xrSession        = null;
let hitTestSource    = null;
let htSourcePending  = false;
let isARActive       = false;
let simulationMode   = false;

/* ─── Placed objects ──────────────────────────────────────────────────────── */
let placedObjects = [];   // [{ mesh, bboxHelper, material }]

/* ─── Plane detection state ──────────────────────────────────────────────── */
// Map from XRPlane → { mesh, lastChanged }
const planeOverlays = new Map();

/* ─── FPS tracking ────────────────────────────────────────────────────────── */
let fpsFrames = 0, fpsLast = 0, fpsCurrent = 0;

/* ─── Simulation orbit state ─────────────────────────────────────────────── */
let orbitTheta = 0, orbitPhi = Math.PI / 4;
let isDragging = false, dragX = 0, dragY = 0;
let simPreviewMesh = null;    // the rotating torus-knot in sim preview

/* ═══════════════════════════════════════════════════════════════════════════
 * INIT
 * ═══════════════════════════════════════════════════════════════════════════ */
async function init() {
  setupThreeJS();
  setupDebugPanel();
  setupResizeHandler();
  setupOrbitControls();
  setupGameUI();

  /* Check WebXR AR support */
  let arSupported = false;
  if (navigator.xr) {
    try { arSupported = await navigator.xr.isSessionSupported('immersive-ar'); }
    catch (_) { arSupported = false; }
  }

  if (arSupported) {
    document.getElementById('start-ar-btn').disabled = false;
    updateStatus('AR ready — tap "Start AR" to begin.');
  } else {
    document.getElementById('start-ar-btn').disabled = false;
    simulationMode = true;
    updateStatus('Simulation mode (WebXR AR not available on this device).');
    startSimulation();
  }

  document.getElementById('start-ar-btn').addEventListener('click', toggleAR);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THREE.JS SETUP
 * ═══════════════════════════════════════════════════════════════════════════ */
function setupThreeJS() {
  /* Renderer */
  renderer = new THREE.WebGLRenderer({
    canvas:    document.getElementById('ar-canvas'),
    antialias: true,
    alpha:     true,   // transparent so the camera feed shows through in AR
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.xr.enabled        = true;

  /* Scene */
  scene = new THREE.Scene();

  /* Camera */
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 200);
  camera.position.set(0, 1.2, 2.5);
  camera.lookAt(0, 0, 0);

  /* Clock */
  clock = new THREE.Clock();

  /* Lighting */
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

  /* Axes helper (debug) */
  axesHelper = new THREE.AxesHelper(0.5);
  axesHelper.visible = DEBUG.showAxes;
  scene.add(axesHelper);

  /* Grid helper (debug) */
  gridHelper = new THREE.GridHelper(6, 30, 0x444444, 0x222222);
  gridHelper.position.y = 0;
  gridHelper.visible = DEBUG.showGrid;
  scene.add(gridHelper);

  /* Shadow-receiving ground (invisible but casts shadows from placed objects) */
  const shadowGeo = new THREE.PlaneGeometry(20, 20);
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.35 });
  shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.receiveShadow = true;
  shadowPlane.visible = false;   // shown in simulation, hidden in AR (AR has real floor)
  scene.add(shadowPlane);

  /* Reticle — ring that snaps to detected surfaces */
  const reticleGeo = new THREE.RingGeometry(0.06, 0.10, 36).rotateX(-Math.PI / 2);
  const reticleMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide });
  reticle = new THREE.Mesh(reticleGeo, reticleMat);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  /* Outer pulsing ring */
  const outerRingGeo = new THREE.RingGeometry(0.11, 0.135, 36).rotateX(-Math.PI / 2);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.4
  });
  reticleRing = new THREE.Mesh(outerRingGeo, outerRingMat);
  reticleRing.matrixAutoUpdate = false;
  reticleRing.visible = false;
  scene.add(reticleRing);

  /* Start render loop */
  renderer.setAnimationLoop(renderLoop);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SIMULATION MODE
 * ═══════════════════════════════════════════════════════════════════════════ */
function startSimulation() {
  /* Show shadow plane / grid in simulation */
  shadowPlane.visible = true;
  gridHelper.visible  = true;

  /* Environment — subtle gradient sky colour */
  scene.background = new THREE.Color(0x0a0e1a);
  scene.fog = new THREE.Fog(0x0a0e1a, 8, 20);

  /* Preview object: torus-knot */
  const geo = new THREE.TorusKnotGeometry(0.38, 0.14, 120, 18);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x00ff88, roughness: 0.3, metalness: 0.55,
    emissive: 0x003322, emissiveIntensity: 0.4,
  });
  simPreviewMesh = new THREE.Mesh(geo, mat);
  simPreviewMesh.castShadow = true;
  simPreviewMesh.position.set(0, 0.5, 0);
  scene.add(simPreviewMesh);

  /* Click / tap interaction in simulation mode */
  const canvas = document.getElementById('ar-canvas');
  canvas.addEventListener('click',      onSimClick);
  canvas.addEventListener('touchstart', onSimTouch, { passive: true });

  document.getElementById('start-ar-btn').textContent = '↺ Restart';
  document.getElementById('start-ar-btn').disabled    = false;
  document.getElementById('reticle-hint').style.display = '';
  document.getElementById('reticle-hint').textContent   = 'Walk to collect clues — find the buried treasure!';

  document.getElementById('no-ar-banner').style.display = 'block';
  setTimeout(() => { document.getElementById('no-ar-banner').style.display = 'none'; }, 4500);

  /* Override start button for simulation: restart game */
  document.getElementById('start-ar-btn').removeEventListener('click', toggleAR);
  document.getElementById('start-ar-btn').addEventListener('click', () => {
    if (GAME.phase !== 'idle') {
      /* Restart */
      stopGPS();
      clearGameObjects();
      GAME.phase = 'idle';
    }
    startGame();
  });

  /* Auto-start game in sim mode */
  startGame();
}

function onSimClick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc  = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1
  );
  const target = groundPositionFromNDC(ndc);
  if (!target) return;

  if (GAME.phase === 'hunt' || GAME.phase === 'explore') {
    /* Try to tap the AR treasure chest */
    if (GAME.treasureEntry) {
      const d = target.distanceTo(GAME.treasureEntry.mesh.position);
      if (d < 0.8) { collectARTreasure(); return; }
    }
  }
}

function onSimTouch(e) {
  if (e.touches.length !== 1) return;
  const touch = e.touches[0];
  const rect  = renderer.domElement.getBoundingClientRect();
  const ndc   = new THREE.Vector2(
    ((touch.clientX - rect.left) / rect.width)  * 2 - 1,
    -((touch.clientY - rect.top)  / rect.height) * 2 + 1
  );
  const target = groundPositionFromNDC(ndc);
  if (!target) return;

  if (GAME.phase === 'hunt' || GAME.phase === 'explore') {
    if (GAME.treasureEntry) {
      const d = target.distanceTo(GAME.treasureEntry.mesh.position);
      if (d < 0.8) { collectARTreasure(); return; }
    }
  }
}

function groundPositionFromNDC(ndc) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const target = new THREE.Vector3();
  return raycaster.ray.intersectPlane(ground, target) ? target : null;
}

function rayCastToGround(ndc) {
  const target = groundPositionFromNDC(ndc);
  if (target) placeObjectAtPosition(target);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * AR SESSION
 * ═══════════════════════════════════════════════════════════════════════════ */
async function toggleAR() {
  if (isARActive) { stopAR(); } else { startAR(); }
}

async function startAR() {
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

  isARActive   = true;
  htSourcePending = false;
  hitTestSource   = null;

  document.getElementById('start-ar-btn').textContent = 'Stop AR';
  document.getElementById('start-ar-btn').classList.add('active');
  document.getElementById('reticle-hint').style.display = '';
  document.getElementById('plane-count').style.display  = '';

  updateStatus('AR active — walk to collect clues and find the treasure!');
  updateXRInfoDisplay('Session started\nMode: immersive-ar\nFeatures: hit-test');

  /* Auto-start game immediately — no overlay required */
  startGame();
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

  /* Stop any running game */
  if (GAME.phase === 'explore' || GAME.phase === 'hunt') {
    stopGPS();
    clearGameObjects();
    GAME.phase = 'idle';
    document.getElementById('game-hud').style.display     = 'none';
    document.getElementById('hunt-hud').style.display     = 'none';
    document.getElementById('minimap-canvas').style.display = 'none';
    document.getElementById('status-bar').style.display   = '';
  }

  document.getElementById('start-ar-btn').textContent = 'Start AR';
  document.getElementById('start-ar-btn').classList.remove('active');
  document.getElementById('reticle-hint').style.display = 'none';
  document.getElementById('plane-count').style.display  = 'none';

  updateStatus('AR session ended.');
  updateXRInfoDisplay('No active session');
}

function onXRSelect() {
  /* Try to collect the AR treasure chest (hunt / explore phase) */
  if ((GAME.phase === 'hunt' || GAME.phase === 'explore') && GAME.treasureEntry) {
    if (lastReticlePos) {
      const d = lastReticlePos.distanceTo(GAME.treasureEntry.mesh.position);
      if (d < 1.0) { collectARTreasure(); return; }
    } else {
      /* No reticle — collect if chest has spawned */
      collectARTreasure(); return;
    }
  }
  /* Outside game: place a debug object */
  if (GAME.phase === 'idle' && reticle.visible) {
    const pos  = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    reticle.matrix.decompose(pos, quat, new THREE.Vector3());
    placeObjectAtPosition(pos, quat);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RENDER LOOP
 * ═══════════════════════════════════════════════════════════════════════════ */
function renderLoop(timestamp, frame) {
  const delta = clock.getDelta();

  /* FPS */
  if (DEBUG.showFPS) {
    fpsFrames++;
    if (timestamp - fpsLast >= 1000) {
      fpsCurrent = Math.round(fpsFrames * 1000 / (timestamp - fpsLast));
      fpsFrames  = 0;
      fpsLast    = timestamp;
      document.getElementById('fps-counter').textContent = `${fpsCurrent} FPS`;
    }
  }

  /* Simulation: rotate preview mesh, pulse reticle ring */
  if (simulationMode && simPreviewMesh) {
    simPreviewMesh.rotation.x += delta * 0.4;
    simPreviewMesh.rotation.y += delta * 0.7;
  }

  /* Reticle ring pulse */
  if (reticleRing.visible) {
    const pulse = 0.4 + 0.3 * Math.sin(timestamp * 0.003);
    reticleRing.material.opacity = pulse;
  }

  /* WebXR per-frame work */
  if (frame) {
    const refSpace = renderer.xr.getReferenceSpace();
    const session  = renderer.xr.getSession();

    /* Request hit-test source once */
    if (!htSourcePending && !hitTestSource) {
      htSourcePending = true;
      session.requestReferenceSpace('viewer').then(viewerSpace => {
        session.requestHitTestSource({ space: viewerSpace })
          .then(src => { hitTestSource = src; })
          .catch(err => console.warn('hitTestSource failed:', err));
      });
    }

    /* Process hit-test results */
    if (hitTestSource) {
      const results = frame.getHitTestResults(hitTestSource);
      if (results.length > 0) {
        const pose = results[0].getPose(refSpace);
        if (pose) {
          const show = DEBUG.showReticle;
          reticle.visible     = show;
          reticleRing.visible = show;
          reticle.matrix.fromArray(pose.transform.matrix);
          reticleRing.matrix.fromArray(pose.transform.matrix);

          if (DEBUG.showHitInfo) {
            const m = pose.transform.matrix;
            const pos = `pos: (${m[12].toFixed(3)}, ${m[13].toFixed(3)}, ${m[14].toFixed(3)})`;
            updateHitInfoDisplay(pos);
          }

          /* Track reticle world position for game collection */
          const _p = new THREE.Vector3();
          reticle.matrix.decompose(_p, new THREE.Quaternion(), new THREE.Vector3());
          lastReticlePos = _p;
        }
      } else {
        reticle.visible     = false;
        reticleRing.visible = false;
        if (DEBUG.showHitInfo) updateHitInfoDisplay('No surface detected');
      }
    }

    /* Camera world matrix debug */
    if (DEBUG.showCamMatrix) {
      const viewerPose = frame.getViewerPose(refSpace);
      if (viewerPose && viewerPose.views.length > 0) {
        const v = viewerPose.views[0];
        updateCamMatrixDisplay(v.transform.matrix);
      }
    }

    /* XR session state */
    if (DEBUG.showXRInfo) {
      updateXRInfoDisplay(
        `Mode:        immersive-ar\n` +
        `renderState: ${JSON.stringify({ baseLayer: session.renderState.baseLayer ? 'set' : 'none' })}\n` +
        `visibilityState: ${session.visibilityState || '—'}`
      );
    }

    /* Plane detection — floors and walls */
    if (frame.detectedPlanes) {
      updatePlaneOverlays(frame, refSpace);
    }
  }

  /* ── Game per-frame update ──────────────────────────────────────────────── */
  tickGame(delta, timestamp);

  renderer.render(scene, camera);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PLACE OBJECT
 * ═══════════════════════════════════════════════════════════════════════════ */
const SHAPE_NAMES = ['box', 'sphere', 'cone', 'cylinder', 'torus', 'dodecahedron', 'octahedron'];

function placeObjectAtPosition(position, quaternion) {
  const shape = SHAPE_NAMES[Math.floor(Math.random() * SHAPE_NAMES.length)];
  const geo   = buildGeometry(shape);

  const hue  = Math.random();
  const col  = new THREE.Color().setHSL(hue, 0.9, 0.55);
  const mat  = new THREE.MeshStandardMaterial({
    color:     col,
    roughness: 0.45,
    metalness: 0.35,
    wireframe: DEBUG.wireframe,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  if (quaternion) mesh.quaternion.copy(quaternion);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  /* Bounding box helper (debug) */
  const bboxHelper = new THREE.BoxHelper(mesh, 0xffff00);
  bboxHelper.visible = DEBUG.showBBox;
  scene.add(bboxHelper);

  placedObjects.push({ mesh, bboxHelper, material: mat });
  updatePlacedCount();

  /* Pop-in scale animation */
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
  const start = performance.now();
  const dur   = 420;
  const target = new THREE.Vector3(1, 1, 1);

  function tick() {
    const t    = Math.min((performance.now() - start) / dur, 1);
    const ease = 1 - Math.pow(1 - t, 3);  // ease-out cubic
    mesh.scale.setScalar(ease);
    if (t < 1) requestAnimationFrame(tick);
    else mesh.scale.copy(target);
  }
  requestAnimationFrame(tick);
}

function clearObjects() {
  placedObjects.forEach(({ mesh, bboxHelper }) => {
    scene.remove(mesh);
    scene.remove(bboxHelper);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
  placedObjects = [];
  clearGameObjects();
  updatePlacedCount();
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PLANE DETECTION (walls + floors via WebXR Plane Detection API)
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build a BufferGeometry from an XRPlane polygon.
 * Polygon vertices are in the plane's local coordinate system where y = 0
 * and the surface spans the XZ plane.  A simple fan triangulation is used
 * (works correctly for the convex polygons XR returns).
 */
function buildPlaneGeometry(polygon) {
  if (!polygon || polygon.length < 3) {
    return new THREE.PlaneGeometry(0.1, 0.1);
  }
  const n = polygon.length;
  const verts = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    verts[i * 3]     = polygon[i].x;
    verts[i * 3 + 1] = 0;
    verts[i * 3 + 2] = polygon[i].z;
  }
  const idx = [];
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Called every AR frame.  Syncs Three.js overlay meshes with the set of
 * XRPlane objects tracked by the device.
 *
 *   • Vertical planes  (walls)  → orange overlay
 *   • Horizontal planes (floors/ceilings) → blue overlay
 *
 * Meshes are only visible when the "Detected-plane overlays" debug toggle
 * is enabled, but the poses are always updated so the overlay is ready
 * the moment the toggle is switched on.
 */
function updatePlaneOverlays(frame, refSpace) {
  const currentPlanes = frame.detectedPlanes;

  /* Remove overlays for planes no longer tracked */
  for (const [plane, data] of planeOverlays) {
    if (!currentPlanes.has(plane)) {
      scene.remove(data.mesh);
      data.mesh.geometry.dispose();
      data.mesh.material.dispose();
      planeOverlays.delete(plane);
    }
  }

  let wallCount = 0, floorCount = 0;

  for (const plane of currentPlanes) {
    const isWall = plane.orientation === 'vertical';
    if (isWall) wallCount++; else floorCount++;

    let data = planeOverlays.get(plane);

    /* (Re-)build geometry when the device updates the polygon */
    const needsRebuild = !data || data.lastChanged !== plane.lastChangedTime;
    if (needsRebuild) {
      const geo   = buildPlaneGeometry(plane.polygon);
      const color = isWall ? 0xff6600 : 0x0066ff;

      if (!data) {
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity:     0.25,
          side:        THREE.DoubleSide,
          depthWrite:  false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        mesh.visible = DEBUG.showPlanes;
        scene.add(mesh);
        data = { mesh, lastChanged: plane.lastChangedTime };
        planeOverlays.set(plane, data);
      } else {
        data.mesh.geometry.dispose();
        data.mesh.geometry = geo;
        data.lastChanged   = plane.lastChangedTime;
      }
    }

    /* Update world pose every frame */
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (pose) {
      data.mesh.matrix.fromArray(pose.transform.matrix);
    }
  }

  updatePlaneCount(wallCount, floorCount);
}

/** Remove all plane overlay meshes (called when AR session ends). */
function clearPlaneOverlays() {
  for (const [, data] of planeOverlays) {
    scene.remove(data.mesh);
    data.mesh.geometry.dispose();
    data.mesh.material.dispose();
  }
  planeOverlays.clear();
  updatePlaneCount(0, 0);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ORBIT CONTROLS (simulation mode only — mouse / touch drag)
 * ═══════════════════════════════════════════════════════════════════════════ */
function setupOrbitControls() {
  const canvas = document.getElementById('ar-canvas');
  const R = 3.5;

  function applyOrbit() {
    orbitPhi = Math.max(0.1, Math.min(Math.PI / 2.2, orbitPhi));
    camera.position.set(
      R * Math.sin(orbitPhi) * Math.sin(orbitTheta),
      R * Math.cos(orbitPhi),
      R * Math.sin(orbitPhi) * Math.cos(orbitTheta)
    );
    camera.lookAt(0, 0.3, 0);
  }

  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (!simulationMode) return;
    isDragging = true; dragX = e.clientX; dragY = e.clientY;
  });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    orbitTheta -= (e.clientX - dragX) * 0.006;
    orbitPhi   += (e.clientY - dragY) * 0.006;
    dragX = e.clientX; dragY = e.clientY;
    applyOrbit();
  });
  window.addEventListener('mouseup', () => { isDragging = false; });

  let pinchDist = 0;
  canvas.addEventListener('touchmove', e => {
    if (!simulationMode) return;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (pinchDist) {
        const ratio = d / pinchDist;
        camera.position.multiplyScalar(1 / ratio);
      }
      pinchDist = d;
    } else if (e.touches.length === 1) {
      pinchDist = 0;
    }
  }, { passive: true });
  canvas.addEventListener('touchend', () => { pinchDist = 0; });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * DEBUG PANEL
 * ═══════════════════════════════════════════════════════════════════════════ */
function setupDebugPanel() {
  /* Toggle panel visibility */
  document.getElementById('debug-toggle-btn').addEventListener('click', () => {
    const panel = document.getElementById('debug-panel');
    panel.classList.toggle('hidden');
    document.getElementById('debug-toggle-btn').classList.toggle('active', !panel.classList.contains('hidden'));
  });
  document.getElementById('close-debug-btn').addEventListener('click', () => {
    document.getElementById('debug-panel').classList.add('hidden');
    document.getElementById('debug-toggle-btn').classList.remove('active');
  });

  /* Clear button */
  document.getElementById('clear-btn').addEventListener('click', clearObjects);

  /* Bind all toggles */
  bindToggle('dbg-axes',      'showAxes',      v => { axesHelper.visible  = v; });
  bindToggle('dbg-grid',      'showGrid',      v => { gridHelper.visible  = v; });
  bindToggle('dbg-planes',    'showPlanes',    v => {
    for (const [, data] of planeOverlays) data.mesh.visible = v;
  });
  bindToggle('dbg-reticle',   'showReticle',   v => {
    reticle.visible     = isARActive && v;
    reticleRing.visible = isARActive && v;
  });
  bindToggle('dbg-bbox',      'showBBox',      v => {
    placedObjects.forEach(o => { o.bboxHelper.visible = v; });
  });
  bindToggle('dbg-wireframe', 'wireframe',     v => {
    placedObjects.forEach(o => { o.material.wireframe = v; });
  });
  bindToggle('dbg-fps',       'showFPS',       v => {
    document.getElementById('fps-counter').style.display = v ? '' : 'none';
    if (!v) document.getElementById('fps-counter').textContent = '';
  });
  bindToggle('dbg-cam-matrix','showCamMatrix', v => {
    document.getElementById('section-cam-matrix').style.display = v ? '' : 'none';
    if (!v) document.getElementById('cam-matrix-display').textContent = '—';
  });
  bindToggle('dbg-xr-info',   'showXRInfo',    v => {
    document.getElementById('section-xr-info').style.display = v ? '' : 'none';
    if (!v) document.getElementById('xr-info-display').textContent = '—';
  });
  bindToggle('dbg-hit-info',  'showHitInfo',   v => {
    document.getElementById('section-hit-info').style.display = v ? '' : 'none';
    if (!v) document.getElementById('hit-info-display').textContent = '—';
  });

  /* Sync checked state with initial DEBUG values */
  document.getElementById('dbg-reticle').checked = DEBUG.showReticle;
  document.getElementById('dbg-fps').checked      = DEBUG.showFPS;
}

function bindToggle(id, key, callback) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', e => {
    DEBUG[key] = e.target.checked;
    callback(e.target.checked);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RESIZE
 * ═══════════════════════════════════════════════════════════════════════════ */
function setupResizeHandler() {
  window.addEventListener('resize', () => {
    if (isARActive) return;   // AR handles its own viewport
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * UI HELPERS
 * ═══════════════════════════════════════════════════════════════════════════ */
function updateStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

function updatePlacedCount() {
  const phase = GAME.phase;
  if (phase === 'explore' || phase === 'hunt') {
    document.getElementById('placed-count').textContent =
      `${Math.round(GAME.totalDistM)}m · Clues: ${GAME.clues.length}/${CLUES_NEEDED}`;
  } else {
    document.getElementById('placed-count').textContent = `Objects: ${placedObjects.length}`;
  }
}

function updatePlaneCount(walls, floors) {
  const el = document.getElementById('plane-count');
  if (!el) return;
  el.textContent = `Walls: ${walls} · Floors: ${floors}`;
}

function updateCamMatrixDisplay(matrix) {
  const m = Array.from(matrix).map(v => v.toFixed(3).padStart(7));
  document.getElementById('cam-matrix-display').textContent =
    `[${m[0]},${m[4]},${m[8]},${m[12]}]\n` +
    `[${m[1]},${m[5]},${m[9]},${m[13]}]\n` +
    `[${m[2]},${m[6]},${m[10]},${m[14]}]\n` +
    `[${m[3]},${m[7]},${m[11]},${m[15]}]`;
}

function updateXRInfoDisplay(text) {
  document.getElementById('xr-info-display').textContent = text;
}

function updateHitInfoDisplay(text) {
  document.getElementById('hit-info-display').textContent = text;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * BOOT
 * ═══════════════════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', init);

/* ═══════════════════════════════════════════════════════════════════════════
 * GAME FUNCTIONS — Trail Treasure Hunt
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Wire up game overlay buttons ───────────────────────────────────────── */
function setupGameUI() {
  GAME.highScore = parseInt(localStorage.getItem('arHuntHighScore') || '0', 10);
  if (GAME.highScore > 0) {
    document.getElementById('game-highscore').textContent = GAME.highScore.toLocaleString();
    document.getElementById('game-highscore-display').style.display = '';
  }

  document.getElementById('play-btn').addEventListener('click', () => {
    document.getElementById('game-overlay').classList.add('hidden');
    startGame();
  });

  document.getElementById('play-again-btn').addEventListener('click', () => {
    document.getElementById('game-overlay').classList.add('hidden');
    startGame();
  });
}

/* ─── Start a new game ────────────────────────────────────────────────────── */
function startGame() {
  stopGPS();
  clearGameObjects();

  GAME.phase            = 'explore';
  GAME.score            = 0;
  GAME.gpsPath          = [];
  GAME.totalDistM       = 0;
  GAME.clues            = [];
  GAME.clueAccumM       = 0;
  GAME.footAccumM       = 0;
  GAME.watchId          = null;
  GAME.lastGPS          = null;
  GAME.gpsReady         = false;
  GAME.treasureGPS      = null;
  GAME.distToTreasure   = Infinity;
  GAME.bearingToTreasure = 0;
  GAME.arChestSpawned   = false;
  GAME.treasureEntry    = null;
  GAME._noGPS           = false;
  GAME._simLastCamPos   = null;
  GAME.footprints       = [];

  document.getElementById('status-bar').style.display   = 'none';
  document.getElementById('game-hud').style.display     = '';
  document.getElementById('hunt-hud').style.display     = 'none';
  document.getElementById('game-overlay').classList.add('hidden');
  document.getElementById('minimap-canvas').style.display = '';

  updateExploreHUD();
  updatePlacedCount();
  drawMiniMap();

  startGPS();
  updateStatus('Exploring… walk to collect clues and find the buried treasure!');
}

/* ─── End game ────────────────────────────────────────────────────────────── */
function endGame(won) {
  GAME.phase = 'found';
  stopGPS();

  const isNewRecord = GAME.score > GAME.highScore;
  if (isNewRecord) {
    GAME.highScore = GAME.score;
    localStorage.setItem('arHuntHighScore', String(GAME.highScore));
    document.getElementById('game-highscore').textContent = GAME.highScore.toLocaleString();
    document.getElementById('game-highscore-display').style.display = '';
  }

  clearFootprints();

  document.getElementById('game-hud').style.display     = 'none';
  document.getElementById('hunt-hud').style.display     = 'none';
  document.getElementById('minimap-canvas').style.display = 'none';

  /* Populate game-over screen */
  document.getElementById('final-score').textContent    = GAME.score.toLocaleString();
  document.getElementById('stat-collected').textContent = `${Math.round(GAME.totalDistM)}m walked`;
  document.getElementById('stat-streak').textContent    = `${GAME.clues.length} clue${GAME.clues.length !== 1 ? 's' : ''}`;
  document.getElementById('stat-mult').textContent      = won ? '🎉 Found it!' : '💀 Gave up';
  document.getElementById('game-over-best').textContent = GAME.highScore.toLocaleString();
  document.getElementById('new-record-badge').style.display = isNewRecord ? '' : 'none';

  setTimeout(() => {
    document.getElementById('game-start-screen').style.display = 'none';
    document.getElementById('game-over-screen').style.display  = '';
    document.getElementById('game-overlay').classList.remove('hidden');
    document.getElementById('status-bar').style.display = '';
  }, 1400);

  updateStatus(won ? '🏆 Treasure found! Amazing!' : 'Adventure over — try again!');
}

/* ─── GPS: start watching ─────────────────────────────────────────────────── */
function startGPS() {
  if (!navigator.geolocation) { onGPSError({ message: 'not supported' }); return; }
  GAME.watchId = navigator.geolocation.watchPosition(
    onGPSUpdate, onGPSError,
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 }
  );
}

/* ─── GPS: stop watching ──────────────────────────────────────────────────── */
function stopGPS() {
  if (GAME.watchId !== null) {
    navigator.geolocation.clearWatch(GAME.watchId);
    GAME.watchId = null;
  }
}

/* ─── GPS update ──────────────────────────────────────────────────────────── */
function onGPSUpdate(pos) {
  if (GAME.phase === 'idle' || GAME.phase === 'found') return;

  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;

  /* First fix — set origin and bury treasure */
  if (!GAME.gpsReady) {
    GAME.gpsReady = true;
    GAME.lastGPS  = { lat, lng };
    GAME.gpsPath.push({ lat, lng, mx: 0, mz: 0 });
    buryTreasure(lat, lng);
    showToast('🛰️ GPS locked! Walk to collect clues.', 3000);
    drawMiniMap();
    return;
  }

  const distFromLast = haversineM(GAME.lastGPS.lat, GAME.lastGPS.lng, lat, lng);
  if (distFromLast < GPS_MIN_MOVE_M) return;  // filter sub-2m GPS jitter

  GAME.totalDistM += distFromLast;
  GAME.lastGPS = { lat, lng };

  const origin = GAME.gpsPath[0];
  const { mx, mz } = gpsToLocal(origin.lat, origin.lng, lat, lng);
  if (GAME.gpsPath.length < MAX_GPS_PTS) GAME.gpsPath.push({ lat, lng, mx, mz });

  /* Footprints */
  GAME.footAccumM += distFromLast;
  if (GAME.footAccumM >= FOOTPRINT_DIST_M) { GAME.footAccumM = 0; placeFootprint(); }

  /* Clues (explore phase) */
  if (GAME.phase === 'explore') {
    GAME.clueAccumM += distFromLast;
    if (GAME.clueAccumM >= CLUE_INTERVAL_M) { GAME.clueAccumM = 0; collectClue({ lat, lng }); }
  }

  /* Treasure bearing + distance */
  if (GAME.treasureGPS) {
    GAME.distToTreasure    = haversineM(lat, lng, GAME.treasureGPS.lat, GAME.treasureGPS.lng);
    GAME.bearingToTreasure = bearingDeg(lat, lng, GAME.treasureGPS.lat, GAME.treasureGPS.lng);
    if (!GAME.arChestSpawned && GAME.distToTreasure <= TREASURE_SPAWN_M) {
      spawnARTreasureChest();
    }
    updateHuntHUD();
  }

  updateExploreHUD();
  updatePlacedCount();
  drawMiniMap();
}

/* ─── GPS error / unavailable ─────────────────────────────────────────────── */
function onGPSError(err) {
  if (GAME._noGPS) return;
  GAME._noGPS = true;
  console.warn('GPS error:', err);
  showToast('🎮 No GPS — sim mode: move the camera to explore!', 4000);
  burySimTreasure();
}

/* ─── Bury treasure at random GPS position from start ────────────────────── */
function buryTreasure(originLat, originLng) {
  const dist    = TREASURE_MIN_M + Math.random() * (TREASURE_MAX_M - TREASURE_MIN_M);
  const bearing = Math.random() * 360;
  GAME.treasureGPS       = gpsDestination(originLat, originLng, bearing, dist);
  GAME.distToTreasure    = dist;
  GAME.bearingToTreasure = bearing;
  showToast('💰 Treasure buried nearby! Collect clues to find it.', 3500);
  drawMiniMap();
}

/* ─── Simulation fallback: no GPS treasure placement ─────────────────────── */
function burySimTreasure() {
  GAME.treasureGPS    = null;
  GAME.distToTreasure = 60;  // virtual metres
  showToast('💰 Treasure buried 60m away — walk in sim to find it!', 3500);
}

/* ─── Collect a directional clue ─────────────────────────────────────────── */
function collectClue(currentGPS) {
  const num = GAME.clues.length + 1;
  let text;

  if (GAME.treasureGPS && currentGPS) {
    const dist = haversineM(currentGPS.lat, currentGPS.lng,
                            GAME.treasureGPS.lat, GAME.treasureGPS.lng);
    const bear = bearingDeg(currentGPS.lat, currentGPS.lng,
                            GAME.treasureGPS.lat, GAME.treasureGPS.lng);
    text = makeClueText(num, dist, bear);
  } else {
    text = SIM_CLUES[(num - 1) % SIM_CLUES.length];
  }

  GAME.clues.push(text);
  GAME.score += 100;
  showClueToast(num, text);
  updateExploreHUD();
  updatePlacedCount();

  if (GAME.clues.length >= CLUES_NEEDED && GAME.phase === 'explore') {
    GAME.phase = 'hunt';
    document.getElementById('hunt-hud').style.display = '';
    showToast('🗺️ All clues collected! Use the compass to find the treasure!', 4000);
    drawMiniMap();
  }
}

/* ─── Generate directional clue text ─────────────────────────────────────── */
const CARDINALS = ['north','north-east','east','south-east','south','south-west','west','north-west'];
function makeClueText(num, distM, bear) {
  const cardinal = CARDINALS[Math.round(bear / 45) % 8];
  const paces    = Math.round(distM / 0.76);
  const opts = [
    `${num}. The treasure is ~${paces} paces to the ${cardinal}.`,
    `${num}. Head ${cardinal} — about ${Math.round(distM)}m away.`,
    `${num}. A glimmer to the ${cardinal}… roughly ${paces} paces.`,
    `${num}. Face ${cardinal} and walk about ${Math.round(distM)} metres.`,
  ];
  return opts[(num - 1) % opts.length];
}
const SIM_CLUES = [
  '1. Something shiny lies to the north-east…',
  '2. You feel warmer heading east.',
  '3. You\'re very close — the treasure glows ahead!',
];

/* ─── Spawn AR treasure chest when player is near ─────────────────────────── */
function spawnARTreasureChest() {
  if (GAME.arChestSpawned || GAME.treasureEntry) return;
  GAME.arChestSpawned = true;

  let pos;
  if (lastReticlePos) {
    pos = lastReticlePos.clone();
    pos.x += (Math.random() - 0.5) * 0.4;
    pos.z += (Math.random() - 0.5) * 0.4;
  } else {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0; dir.normalize();
    pos = new THREE.Vector3();
    camera.getWorldPosition(pos);
    pos.addScaledVector(dir, 1.5);
    pos.y = 0;
  }

  /* Chest body */
  const geo = new THREE.BoxGeometry(0.40, 0.30, 0.30);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xCC7722, emissive: 0x663300, emissiveIntensity: 1.0,
    roughness: 0.2, metalness: 0.8,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  mesh.castShadow = true;
  scene.add(mesh);

  /* Gold glow */
  const light = new THREE.PointLight(0xFFAA00, 3.0, 3.0);
  light.position.copy(pos);
  scene.add(light);

  GAME.treasureEntry = { mesh, light, baseY: pos.y };
  popIn(mesh);
  showToast('💰 TAP THE GLOWING CHEST to dig up the treasure!', 6000);
  updateStatus('Treasure chest spotted — tap it!');
}

/* ─── Collect the AR treasure chest ──────────────────────────────────────── */
function collectARTreasure() {
  if (!GAME.treasureEntry) return;
  const { mesh, light } = GAME.treasureEntry;

  /* Score: 500 base + distance bonus (closer start = bigger bonus) */
  const distBonus = Math.max(0, Math.round(300 - GAME.distToTreasure * 2));
  GAME.score += 500 + distBonus;

  scene.remove(light);
  animateCollection(mesh);
  GAME.treasureEntry = null;

  showToast(`🏆 TREASURE FOUND! +${500 + distBonus} pts!`, 4000);
  setTimeout(() => endGame(true), 1800);
}

/* ─── Per-frame game tick ─────────────────────────────────────────────────── */
function tickGame(delta, timestamp) {
  if (GAME.phase === 'idle' || GAME.phase === 'found') return;

  /* Simulation: derive virtual GPS from camera movement */
  if (GAME._noGPS) simTickGPS(delta);

  /* Animate treasure chest */
  if (GAME.treasureEntry) {
    const { mesh, light, baseY } = GAME.treasureEntry;
    mesh.position.y = baseY + 0.09 * Math.sin(timestamp * 0.002);
    mesh.rotation.y += delta * 1.8;
    if (light) light.position.copy(mesh.position);
  }

  /* Footprint fade */
  tickFootprints(delta);

  /* Compass arrow */
  updateCompassArrow();

  /* Score display */
  document.getElementById('game-score').textContent = GAME.score.toLocaleString();
}

/* ─── Simulation: derive distance from camera position ───────────────────── */
function simTickGPS(delta) {
  const camPos = new THREE.Vector3();
  camera.getWorldPosition(camPos);

  if (GAME._simLastCamPos) {
    const moved = camPos.distanceTo(GAME._simLastCamPos);
    if (moved > 0.005) {
      const scale = SIM_MOVEMENT_SCALE;  // multiply real-world sim movement
      const effective = moved * scale;
      GAME.totalDistM += effective;
      GAME.footAccumM += effective;
      GAME.clueAccumM += effective;

      if (GAME.footAccumM >= FOOTPRINT_DIST_M) { GAME.footAccumM = 0; placeFootprint(); }

      if (GAME.phase === 'explore' && GAME.clueAccumM >= CLUE_INTERVAL_M) {
        GAME.clueAccumM = 0;
        collectClue(null);
      }

      if (GAME.distToTreasure < Infinity) {
        GAME.distToTreasure = Math.max(0, GAME.distToTreasure - effective);
        if (!GAME.arChestSpawned && GAME.distToTreasure <= TREASURE_SPAWN_M) {
          spawnARTreasureChest();
        }
      }

      updateExploreHUD();
      updateHuntHUD();
      updatePlacedCount();

      /* Redraw mini-map occasionally */
      if (Math.random() < MINIMAP_UPDATE_PROB) {
        /* Simulate a fake GPS path for the map */
        const lastPt = GAME.gpsPath[GAME.gpsPath.length - 1] || { lat: 0, lng: 0, mx: 0, mz: 0 };
        GAME.gpsPath.push({
          lat: lastPt.lat, lng: lastPt.lng,
          mx: lastPt.mx + (camPos.x - (GAME._simLastCamPos ? GAME._simLastCamPos.x : camPos.x)) * scale * 0.1,
          mz: lastPt.mz + (camPos.z - (GAME._simLastCamPos ? GAME._simLastCamPos.z : camPos.z)) * scale * 0.1,
        });
        if (GAME.gpsPath.length > MAX_GPS_PTS) GAME.gpsPath.shift();
        drawMiniMap();
      }
    }
  }
  GAME._simLastCamPos = camPos.clone();
}

/* ─── Footprint trail ────────────────────────────────────────────────────── */
function placeFootprint() {
  if (GAME.footprints.length >= MAX_FOOTPRINTS) {
    const old = GAME.footprints.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
  const geo  = new THREE.CircleGeometry(0.06, 12).rotateX(-Math.PI / 2);
  const mat  = new THREE.MeshBasicMaterial({
    color: 0x00ff88, transparent: true, opacity: 0.38,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const cam  = new THREE.Vector3();
  camera.getWorldPosition(cam);
  const groundY = lastReticlePos ? lastReticlePos.y : 0;
  mesh.position.set(cam.x, groundY + 0.004, cam.z);
  scene.add(mesh);
  GAME.footprints.push({ mesh, age: 0 });
}

function tickFootprints(delta) {
  for (let i = GAME.footprints.length - 1; i >= 0; i--) {
    const fp = GAME.footprints[i];
    fp.age += delta;
    fp.mesh.material.opacity = Math.max(0, 0.38 * (1 - fp.age / FOOTPRINT_LIFE_S));
    if (fp.age >= FOOTPRINT_LIFE_S) {
      scene.remove(fp.mesh);
      fp.mesh.geometry.dispose();
      fp.mesh.material.dispose();
      GAME.footprints.splice(i, 1);
    }
  }
}

/* ─── Clear game objects ─────────────────────────────────────────────────── */
function clearGameObjects() {
  if (GAME.treasureEntry) {
    const { mesh, light } = GAME.treasureEntry;
    scene.remove(mesh); scene.remove(light);
    mesh.geometry.dispose(); mesh.material.dispose();
    GAME.treasureEntry = null;
  }
  clearFootprints();
  GAME.arChestSpawned = false;
}

function clearFootprints() {
  for (const fp of GAME.footprints) {
    scene.remove(fp.mesh);
    fp.mesh.geometry.dispose();
    fp.mesh.material.dispose();
  }
  GAME.footprints = [];
}

/* ─── Mini-map ───────────────────────────────────────────────────────────── */
function drawMiniMap() {
  const canvas = document.getElementById('minimap-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = canvas.height;
  ctx.clearRect(0, 0, W, H);

  /* Background */
  ctx.fillStyle = 'rgba(4,8,18,0.90)';
  mmRoundRect(ctx, 0, 0, W, H, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(0,255,136,0.30)';
  ctx.lineWidth   = 1;
  mmRoundRect(ctx, 0, 0, W, H, 10); ctx.stroke();

  if (GAME.gpsPath.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font      = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(GAME._noGPS ? 'Sim mode' : 'Searching GPS…', W / 2, H / 2 - 4);
    ctx.fillText(`${Math.round(GAME.totalDistM)}m walked`, W / 2, H / 2 + 10);
    drawNorthDot(ctx, W - 12, 12);
    return;
  }

  /* Bounds */
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (const pt of GAME.gpsPath) {
    minX = Math.min(minX, pt.mx); maxX = Math.max(maxX, pt.mx);
    minZ = Math.min(minZ, pt.mz); maxZ = Math.max(maxZ, pt.mz);
  }
  /* Include treasure */
  if (GAME.treasureGPS && GAME.gpsPath.length > 0) {
    const o  = GAME.gpsPath[0];
    const tl = gpsToLocal(o.lat, o.lng, GAME.treasureGPS.lat, GAME.treasureGPS.lng);
    minX = Math.min(minX, tl.mx); maxX = Math.max(maxX, tl.mx);
    minZ = Math.min(minZ, tl.mz); maxZ = Math.max(maxZ, tl.mz);
  }
  const rangeX = Math.max(maxX - minX, 20) * MINIMAP_PADDING;
  const rangeZ = Math.max(maxZ - minZ, 20) * MINIMAP_PADDING;
  const scale  = Math.min((W - 20) / rangeX, (H - 22) / rangeZ);
  const cx     = (minX + maxX) / 2;
  const cz     = (minZ + maxZ) / 2;
  const toC    = (mx, mz) => ({ x: W / 2 + (mx - cx) * scale, y: H / 2 + (mz - cz) * scale });

  /* Dotted trail */
  if (GAME.gpsPath.length >= 2) {
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    const p0 = toC(GAME.gpsPath[0].mx, GAME.gpsPath[0].mz);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < GAME.gpsPath.length; i++) {
      const p = toC(GAME.gpsPath[i].mx, GAME.gpsPath[i].mz);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Start marker */
  const sp = toC(0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath(); ctx.arc(sp.x, sp.y, 2.5, 0, Math.PI * 2); ctx.fill();

  /* Treasure marker */
  if (GAME.treasureGPS && GAME.gpsPath.length > 0) {
    const o  = GAME.gpsPath[0];
    const tl = gpsToLocal(o.lat, o.lng, GAME.treasureGPS.lat, GAME.treasureGPS.lng);
    const tp = toC(tl.mx, tl.mz);
    if (GAME.phase === 'hunt' || GAME.phase === 'found') {
      ctx.font = '13px serif'; ctx.textAlign = 'center';
      ctx.fillText('💰', tp.x, tp.y + 5);
    } else {
      ctx.fillStyle = '#ffaa00'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('?', tp.x, tp.y + 4);
    }
  }

  /* Player dot */
  const lp = GAME.gpsPath[GAME.gpsPath.length - 1];
  const pp = toC(lp.mx, lp.mz);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(pp.x, pp.y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#00ff88';
  ctx.beginPath(); ctx.arc(pp.x, pp.y, 3.5, 0, Math.PI * 2); ctx.fill();

  /* Footer stats */
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(GAME.totalDistM)}m`, 5, H - 4);
  if (GAME.distToTreasure < Infinity) {
    ctx.textAlign = 'right';
    ctx.fillText(`💰 ${Math.round(GAME.distToTreasure)}m`, W - 5, H - 4);
  }

  drawNorthDot(ctx, W - 12, 12);
}

function mmRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);     ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);     ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
  ctx.lineTo(x, y + r);         ctx.quadraticCurveTo(x, y,         x + r, y);
  ctx.closePath();
}

function drawNorthDot(ctx, cx, cy) {
  ctx.strokeStyle = 'rgba(255,170,0,0.5)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle   = '#ffaa00';
  ctx.font        = 'bold 8px sans-serif';
  ctx.textAlign   = 'center';
  ctx.fillText('N', cx, cy + 3);
}

/* ─── Compass arrow ──────────────────────────────────────────────────────── */
function updateCompassArrow() {
  const el = document.getElementById('compass-arrow');
  if (!el) return;
  if (GAME.distToTreasure === Infinity || GAME.phase === 'explore') {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  el.style.transform = `rotate(${GAME.bearingToTreasure}deg)`;
  const ratio = Math.min(1, GAME.distToTreasure / 80);
  const r = Math.round(255 * ratio);
  const g = Math.round(220 * (1 - ratio));
  el.style.color = `rgb(${r},${g},40)`;
}

/* ─── Explore HUD ────────────────────────────────────────────────────────── */
function updateExploreHUD() {
  const distEl  = document.getElementById('explore-dist');
  const clueEl  = document.getElementById('explore-clues');
  if (distEl) distEl.textContent = `${Math.round(GAME.totalDistM)}m`;
  if (clueEl) clueEl.textContent = `${GAME.clues.length}/${CLUES_NEEDED}`;
}

/* ─── Hunt HUD ───────────────────────────────────────────────────────────── */
function updateHuntHUD() {
  const el = document.getElementById('hunt-dist');
  if (el && GAME.distToTreasure < Infinity) {
    el.textContent = `${Math.round(GAME.distToTreasure)}m`;
  }
}

/* ─── Toast helper ───────────────────────────────────────────────────────── */
let _toastTimer = null;
function showToast(html, durationMs) {
  durationMs = durationMs || 2500;
  const el = document.getElementById('collect-toast');
  el.innerHTML         = html;
  el.style.display     = '';
  el.style.opacity     = '1';
  el.style.transform   = 'translateX(-50%) translateY(0)';
  el.style.borderColor = 'rgba(0,255,136,0.45)';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateX(-50%) translateY(-20px)';
    setTimeout(() => { el.style.display = 'none'; }, 420);
  }, durationMs);
}

function showClueToast(num, text) {
  showToast(`🗝️ <strong>Clue ${num} collected!</strong><br><small style="color:#ccc">${text}</small>`, 6000);
}

/* ─── Pop-out collection animation (reused for treasure) ─────────────────── */
function animateCollection(mesh) {
  const start      = performance.now();
  const dur        = 420;
  const startScale = mesh.scale.x;
  mesh.material.transparent = true;

  (function tick() {
    const t    = Math.min((performance.now() - start) / dur, 1);
    const rise = Math.sin(t * Math.PI);
    mesh.scale.setScalar(startScale * (1 + rise * 0.7));
    mesh.material.opacity = 1 - t;
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }());
}

/* ─── Haversine distance (metres) ────────────────────────────────────────── */
function haversineM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ─── Compass bearing (degrees, 0=N 90=E …) ─────────────────────────────── */
function bearingDeg(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const la1  = lat1 * Math.PI / 180;
  const la2  = lat2 * Math.PI / 180;
  const y    = Math.sin(dLng) * Math.cos(la2);
  const x    = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/* ─── GPS delta → local XZ metres ───────────────────────────────────────── */
function gpsToLocal(originLat, originLng, lat, lng) {
  const mx = haversineM(originLat, originLng, originLat, lng) * (lng >= originLng ? 1 : -1);
  const mz = haversineM(originLat, originLng, lat, originLng) * (lat >= originLat ? -1 : 1);
  return { mx, mz };
}

/* ─── Destination GPS from origin + bearing + distance ──────────────────── */
function gpsDestination(lat, lng, bearingDegrees, distMetres) {
  const R  = 6371000;
  const δ  = distMetres / R;
  const θ  = bearingDegrees * Math.PI / 180;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lng * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
                              Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * 180 / Math.PI, lng: λ2 * 180 / Math.PI };
}
