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
 * GAME — AR Adventure Hunt
 * ═══════════════════════════════════════════════════════════════════════════
 * Transforms the AR experiment into a real-world treasure-hunt game:
 *   • Virtual collectibles auto-spawn at detected AR surfaces
 *   • Tap to collect nearby items; build streaks for score multipliers
 *   • 3-minute timer with high-score persistence (localStorage)
 *   • 8 collectible types across 4 rarity tiers (common → legendary)
 *   • Floating / rotating animations; glow lights on rare+ items
 *   • Footprint trail markers left behind as you explore in AR
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Game constants ──────────────────────────────────────────────────────── */
const GAME_DURATION      = 180;    // seconds
const SPAWN_INTERVAL     = 3.5;    // seconds between auto-spawns
const COLLECT_RADIUS     = 1.5;    // metres — max distance to collect
const STREAK_WINDOW      = 4.0;    // seconds after collecting before streak resets
const MAX_COLLECTIBLES   = 25;     // max items on screen at once
const FOOTPRINT_INTERVAL = 5.0;    // seconds between footprint drops (AR only)
const MAX_FOOTPRINTS     = 20;     // max trail markers

/* ─── Collectible catalogue ───────────────────────────────────────────────── */
const COLLECTIBLE_DEFS = [
  { type:'coin',    emoji:'🪙', label:'Coin',    points:5,   rarity:'common',    weight:30, color:0xFFD700, emissive:0x553300 },
  { type:'gem',     emoji:'💎', label:'Gem',     points:15,  rarity:'common',    weight:22, color:null,     emissive:null     },
  { type:'potion',  emoji:'🧪', label:'Potion',  points:20,  rarity:'common',    weight:15, color:0x00FF88, emissive:0x003322 },
  { type:'crystal', emoji:'🔷', label:'Crystal', points:35,  rarity:'uncommon',  weight:12, color:0x44CCFF, emissive:0x001133 },
  { type:'chest',   emoji:'📦', label:'Chest',   points:50,  rarity:'uncommon',  weight:8,  color:0xCC7722, emissive:0x221100 },
  { type:'star',    emoji:'⭐', label:'Star',    points:75,  rarity:'rare',      weight:5,  color:0xFFEE44, emissive:0x332200 },
  { type:'relic',   emoji:'🏺', label:'Relic',   points:100, rarity:'rare',      weight:2,  color:0xBB44FF, emissive:0x220033 },
  { type:'orb',     emoji:'🔮', label:'Orb',     points:250, rarity:'legendary', weight:1,  color:0xFF7700, emissive:0x331100 },
];

/* Build cumulative weights once */
(function buildWeights() {
  let cum = 0;
  COLLECTIBLE_DEFS.forEach(d => { d._cumWeight = (cum += d.weight); });
}());
const TOTAL_WEIGHT = COLLECTIBLE_DEFS[COLLECTIBLE_DEFS.length - 1]._cumWeight;

const RARITY_STYLE = {
  common:    { textColor: '#cccccc', borderColor: 'rgba(180,180,180,0.35)' },
  uncommon:  { textColor: '#44ff88', borderColor: 'rgba(0,200,80,0.40)'   },
  rare:      { textColor: '#cc66ff', borderColor: 'rgba(160,50,240,0.45)' },
  legendary: { textColor: '#ffaa00', borderColor: 'rgba(255,150,0,0.50)'  },
};

/* ─── Game state ──────────────────────────────────────────────────────────── */
const GAME = {
  mode:           'idle',   // 'idle' | 'playing' | 'gameover'
  score:          0,
  highScore:      0,        // loaded from localStorage on init
  streak:         0,
  maxStreak:      0,
  multiplier:     1,
  maxMultiplier:  1,
  streakTimer:    0,
  timeLeft:       GAME_DURATION,
  spawnAccum:     0,
  footAccum:      0,
  totalCollected: 0,
  collectibles:   [],       // [{mesh, def, baseY, bobOffset, bobSpeed, light}]
  footprints:     [],       // [{mesh, age}]
  _clockInterval: null,
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
  document.getElementById('reticle-hint').textContent   = 'Tap near a treasure to collect it, or on open ground to spawn one.';

  document.getElementById('no-ar-banner').style.display = 'block';
  setTimeout(() => { document.getElementById('no-ar-banner').style.display = 'none'; }, 4500);

  /* Override start button for simulation: restart game */
  document.getElementById('start-ar-btn').removeEventListener('click', toggleAR);
  document.getElementById('start-ar-btn').addEventListener('click', () => {
    document.getElementById('game-start-screen').style.display = '';
    document.getElementById('game-over-screen').style.display  = 'none';
    document.getElementById('game-overlay').classList.remove('hidden');
  });

  /* Show game start overlay */
  document.getElementById('game-start-screen').style.display = '';
  document.getElementById('game-over-screen').style.display  = 'none';
  document.getElementById('game-overlay').classList.remove('hidden');
}

function onSimClick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc  = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1
  );
  const target = groundPositionFromNDC(ndc);
  if (!target) return;

  if (GAME.mode === 'playing') {
    /* Try to collect nearby treasure; if none, spawn one here */
    if (!tryCollectNear(target)) spawnCollectibleAt(target);
  } else {
    placeObjectAtPosition(target);
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

  if (GAME.mode === 'playing') {
    if (!tryCollectNear(target)) spawnCollectibleAt(target);
  } else {
    placeObjectAtPosition(target);
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

  updateStatus('AR active — point at a surface and tap to collect treasures.');
  updateXRInfoDisplay('Session started\nMode: immersive-ar\nFeatures: hit-test');

  /* Show game start screen */
  document.getElementById('game-start-screen').style.display = '';
  document.getElementById('game-over-screen').style.display  = 'none';
  document.getElementById('game-overlay').classList.remove('hidden');
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
  if (GAME.mode === 'playing') {
    clearInterval(GAME._clockInterval);
    GAME._clockInterval = null;
    GAME.mode = 'idle';
    clearGameCollectibles();
    document.getElementById('game-hud').style.display = 'none';
    document.getElementById('game-streak-bar').style.display = 'none';
    document.getElementById('status-bar').style.display = '';
  }

  document.getElementById('start-ar-btn').textContent = 'Start AR';
  document.getElementById('start-ar-btn').classList.remove('active');
  document.getElementById('reticle-hint').style.display = 'none';
  document.getElementById('plane-count').style.display  = 'none';

  updateStatus('AR session ended.');
  updateXRInfoDisplay('No active session');
}

function onXRSelect() {
  /* In game mode: try to collect a nearby treasure */
  if (GAME.mode === 'playing' && lastReticlePos) {
    if (!tryCollectNear(lastReticlePos)) {
      updateStatus('Move closer to a treasure to collect it!');
    }
    return;
  }
  /* Outside game mode: place a debug object */
  if (reticle.visible) {
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
  if (GAME.mode === 'playing') {
    /* Streak decay */
    if (GAME.streakTimer > 0) {
      GAME.streakTimer -= delta;
      if (GAME.streakTimer <= 0) resetStreak();
    }
    /* Auto-spawn */
    GAME.spawnAccum += delta;
    if (GAME.spawnAccum >= SPAWN_INTERVAL && GAME.collectibles.length < MAX_COLLECTIBLES) {
      GAME.spawnAccum = 0;
      autoSpawnCollectible();
    }
    /* Footprints (AR only) */
    if (isARActive) {
      GAME.footAccum += delta;
      if (GAME.footAccum >= FOOTPRINT_INTERVAL) {
        GAME.footAccum = 0;
        placeFootprint();
      }
    }
  }
  /* Animate collectibles every frame regardless of mode (for collection anim) */
  if (GAME.collectibles.length > 0 || GAME.footprints.length > 0) {
    tickGameAnimations(timestamp, delta);
  }

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
  clearGameCollectibles();
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
  if (GAME.mode === 'playing' || GAME.mode === 'gameover') {
    document.getElementById('placed-count').textContent = `Treasures: ${GAME.collectibles.length}`;
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
 * GAME FUNCTIONS — AR Adventure Hunt
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ─── Weighted random collectible definition ─────────────────────────────── */
function pickCollectibleDef() {
  const r = Math.random() * TOTAL_WEIGHT;
  return COLLECTIBLE_DEFS.find(d => r <= d._cumWeight) || COLLECTIBLE_DEFS[0];
}

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

/* ─── Start a new game ───────────────────────────────────────────────────── */
function startGame() {
  /* Clear any leftovers from previous game */
  clearGameCollectibles();

  GAME.score          = 0;
  GAME.streak         = 0;
  GAME.maxStreak      = 0;
  GAME.multiplier     = 1;
  GAME.maxMultiplier  = 1;
  GAME.streakTimer    = 0;
  GAME.timeLeft       = GAME_DURATION;
  GAME.spawnAccum     = 0;
  GAME.footAccum      = 0;
  GAME.totalCollected = 0;
  GAME.collectibles   = [];
  GAME.footprints     = [];
  GAME.mode           = 'playing';

  /* Start 1-second clock */
  if (GAME._clockInterval) clearInterval(GAME._clockInterval);
  GAME._clockInterval = setInterval(gameTick, 1000);

  /* Show game HUD, hide plain status bar */
  document.getElementById('status-bar').style.display   = 'none';
  document.getElementById('game-hud').style.display     = '';
  document.getElementById('game-streak-bar').style.display = '';

  updateGameHUD();
  updatePlacedCount();
  updateStatus('Hunt on! Explore and collect treasures!');

  /* Spawn first wave */
  for (let i = 0; i < 3; i++) {
    setTimeout(() => { if (GAME.mode === 'playing') autoSpawnCollectible(); }, i * 700);
  }
}

/* ─── 1-second clock tick ────────────────────────────────────────────────── */
function gameTick() {
  if (GAME.mode !== 'playing') return;
  GAME.timeLeft--;
  updateGameHUD();
  if (GAME.timeLeft <= 0) endGame();
}

/* ─── End the game ───────────────────────────────────────────────────────── */
function endGame() {
  GAME.mode = 'gameover';
  clearInterval(GAME._clockInterval);
  GAME._clockInterval = null;

  /* Persist high score */
  const isNewRecord = GAME.score > GAME.highScore;
  if (isNewRecord) {
    GAME.highScore = GAME.score;
    localStorage.setItem('arHuntHighScore', String(GAME.highScore));
    document.getElementById('game-highscore').textContent = GAME.highScore.toLocaleString();
    document.getElementById('game-highscore-display').style.display = '';
  }

  clearFootprints();
  updatePlacedCount();

  /* Populate game-over screen */
  document.getElementById('final-score').textContent    = GAME.score.toLocaleString();
  document.getElementById('stat-collected').textContent = GAME.totalCollected;
  document.getElementById('stat-streak').textContent    = GAME.maxStreak;
  document.getElementById('stat-mult').textContent      = '×' + GAME.maxMultiplier;
  document.getElementById('game-over-best').textContent = GAME.highScore.toLocaleString();
  document.getElementById('new-record-badge').style.display = isNewRecord ? '' : 'none';

  /* Show overlay after brief delay */
  setTimeout(() => {
    document.getElementById('game-start-screen').style.display = 'none';
    document.getElementById('game-over-screen').style.display  = '';
    document.getElementById('game-overlay').classList.remove('hidden');
    /* Restore status bar */
    document.getElementById('status-bar').style.display = '';
    document.getElementById('game-hud').style.display   = 'none';
    document.getElementById('game-streak-bar').style.display = 'none';
  }, 1200);

  updateStatus(`Time's up! Check your score!`);
}

/* ─── Auto-spawn a collectible near the current reticle/camera ───────────── */
function autoSpawnCollectible() {
  if (GAME.mode !== 'playing') return;
  if (GAME.collectibles.length >= MAX_COLLECTIBLES) return;

  let pos;
  if (lastReticlePos) {
    pos = lastReticlePos.clone();
    pos.x += (Math.random() - 0.5) * 1.4;
    pos.z += (Math.random() - 0.5) * 1.4;
  } else {
    const angle = (camera.rotation.y || 0) + (Math.random() - 0.5) * Math.PI;
    const dist  = 1.5 + Math.random() * 2.5;
    pos = new THREE.Vector3(
      camera.position.x + Math.sin(angle) * dist,
      0,
      camera.position.z - Math.cos(angle) * dist
    );
  }
  spawnCollectibleAt(pos);
}

/* ─── Spawn a collectible mesh at a world position ───────────────────────── */
function spawnCollectibleAt(pos) {
  if (GAME.collectibles.length >= MAX_COLLECTIBLES) return;
  const def   = pickCollectibleDef();
  const mesh  = buildCollectibleMesh(def);
  const baseY = pos.y + 0.18;
  mesh.position.set(pos.x, baseY, pos.z);
  mesh.castShadow = true;
  scene.add(mesh);

  /* Glow point light for rare / legendary */
  let light = null;
  if (def.rarity === 'legendary') {
    light = new THREE.PointLight(def.color || 0xFF7700, 1.2, 1.5);
    light.position.copy(mesh.position);
    scene.add(light);
  } else if (def.rarity === 'rare') {
    light = new THREE.PointLight(def.color || 0xBB44FF, 0.6, 1.0);
    light.position.copy(mesh.position);
    scene.add(light);
  }

  GAME.collectibles.push({
    mesh,
    def,
    baseY,
    bobOffset: Math.random() * Math.PI * 2,
    bobSpeed:  0.8 + Math.random() * 0.6,
    light,
  });

  popIn(mesh);
  updatePlacedCount();
}

/* ─── Build a Three.js mesh for a collectible type ───────────────────────── */
function buildCollectibleMesh(def) {
  let geo;
  switch (def.type) {
    case 'coin':    geo = new THREE.CylinderGeometry(0.09, 0.09, 0.018, 32); break;
    case 'gem':     geo = new THREE.OctahedronGeometry(0.10, 0);             break;
    case 'potion':  geo = new THREE.SphereGeometry(0.075, 20, 20);          break;
    case 'crystal': geo = new THREE.IcosahedronGeometry(0.095, 1);          break;
    case 'chest':   geo = new THREE.BoxGeometry(0.16, 0.12, 0.14);         break;
    case 'star':    geo = new THREE.OctahedronGeometry(0.12, 1);            break;
    case 'relic':   geo = new THREE.DodecahedronGeometry(0.10, 0);         break;
    case 'orb':     geo = new THREE.SphereGeometry(0.10, 28, 28);          break;
    default:        geo = new THREE.SphereGeometry(0.08, 16, 16);
  }

  /* Gems get a random hue */
  let color    = def.color;
  let emissive = def.emissive;
  if (def.type === 'gem') {
    const hue = Math.random();
    color    = new THREE.Color().setHSL(hue, 0.95, 0.55).getHex();
    emissive = new THREE.Color().setHSL(hue, 0.8, 0.15).getHex();
  }

  const emissiveIntensity = { common: 0.3, uncommon: 0.55, rare: 0.8, legendary: 1.2 }[def.rarity];

  const mat = new THREE.MeshStandardMaterial({
    color:             color !== null ? color : 0xffffff,
    emissive:          emissive !== null ? emissive : 0x000000,
    emissiveIntensity,
    roughness: def.rarity === 'legendary' ? 0.08 : 0.3,
    metalness: def.rarity === 'legendary' ? 0.95 : 0.55,
  });

  return new THREE.Mesh(geo, mat);
}

/* ─── Try to collect the nearest collectible within COLLECT_RADIUS ───────── */
function tryCollectNear(pos) {
  if (!GAME.collectibles.length) return false;

  let bestIdx  = -1;
  let bestDist = COLLECT_RADIUS;
  GAME.collectibles.forEach((entry, i) => {
    const d = pos.distanceTo(entry.mesh.position);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  });

  if (bestIdx >= 0) {
    collectItem(bestIdx);
    return true;
  }
  return false;
}

/* ─── Collect item at index ──────────────────────────────────────────────── */
function collectItem(idx) {
  const entry = GAME.collectibles.splice(idx, 1)[0];
  const { mesh, def, light } = entry;

  /* Streak */
  GAME.streak++;
  GAME.streakTimer = STREAK_WINDOW;
  if (GAME.streak > GAME.maxStreak) GAME.maxStreak = GAME.streak;
  GAME.multiplier = calcMultiplier(GAME.streak);
  if (GAME.multiplier > GAME.maxMultiplier) GAME.maxMultiplier = GAME.multiplier;

  /* Score */
  const pts = def.points * GAME.multiplier;
  GAME.score += pts;
  GAME.totalCollected++;

  /* Remove glow light */
  if (light) scene.remove(light);

  animateCollection(mesh);
  showCollectToast(def, pts);
  updateGameHUD();
  updatePlacedCount();
}

/* ─── Collection pop-out animation ──────────────────────────────────────── */
function animateCollection(mesh) {
  const start      = performance.now();
  const dur        = 380;
  const startScale = mesh.scale.x;
  mesh.material.transparent = true;

  (function tick() {
    const t    = Math.min((performance.now() - start) / dur, 1);
    const rise = Math.sin(t * Math.PI);           // arch: 0 → 1 → 0
    mesh.scale.setScalar(startScale * (1 + rise * 0.6));
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

/* ─── Show a +points toast ───────────────────────────────────────────────── */
let _toastTimer = null;
function showCollectToast(def, pts) {
  const el      = document.getElementById('collect-toast');
  const rStyle  = RARITY_STYLE[def.rarity];
  const multStr = GAME.multiplier > 1
    ? ` <span class="toast-mult">×${GAME.multiplier}</span>` : '';
  el.innerHTML = `<span style="color:${rStyle.textColor}">${def.emoji} ${def.label}</span>`
               + `  <strong>+${pts.toLocaleString()}</strong>${multStr}`;
  el.style.borderColor = rStyle.borderColor;
  el.style.display     = '';
  el.style.opacity     = '1';
  el.style.transform   = 'translateX(-50%) translateY(0)';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateX(-50%) translateY(-20px)';
    setTimeout(() => { el.style.display = 'none'; }, 420);
  }, 1800);
}

/* ─── Streak multiplier ──────────────────────────────────────────────────── */
function calcMultiplier(streak) {
  if (streak >= 10) return 5;
  if (streak >= 6)  return 3;
  if (streak >= 3)  return 2;
  return 1;
}

function resetStreak() {
  GAME.streak     = 0;
  GAME.multiplier = 1;
  GAME.streakTimer = 0;
  updateGameHUD();
}

/* ─── Animate all collectibles (bob + rotate + sync lights) ─────────────── */
function tickGameAnimations(timestamp, delta) {
  const t = timestamp * 0.001;
  for (const entry of GAME.collectibles) {
    const { mesh, baseY, bobOffset, bobSpeed, light } = entry;
    mesh.position.y = baseY + 0.07 * Math.sin(t * bobSpeed + bobOffset);
    mesh.rotation.y += delta * 1.2;
    if (light) light.position.copy(mesh.position);
  }

  /* Fade out footprints over their lifetime */
  for (let i = GAME.footprints.length - 1; i >= 0; i--) {
    const fp   = GAME.footprints[i];
    const life = 30;
    fp.age += delta;
    fp.mesh.material.opacity = Math.max(0, 0.28 * (1 - fp.age / life));
    if (fp.age >= life) {
      scene.remove(fp.mesh);
      fp.mesh.geometry.dispose();
      fp.mesh.material.dispose();
      GAME.footprints.splice(i, 1);
    }
  }
}

/* ─── Drop a footprint trail marker at the camera's ground position ──────── */
function placeFootprint() {
  if (GAME.footprints.length >= MAX_FOOTPRINTS) {
    const old = GAME.footprints.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
  const geo  = new THREE.CircleGeometry(0.07, 12).rotateX(-Math.PI / 2);
  const mat  = new THREE.MeshBasicMaterial({
    color: 0x00ff88, transparent: true, opacity: 0.28,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const cam  = new THREE.Vector3();
  camera.getWorldPosition(cam);
  mesh.position.set(cam.x, 0.005, cam.z);
  scene.add(mesh);
  GAME.footprints.push({ mesh, age: 0 });
}

/* ─── Clear all game collectibles and footprints ─────────────────────────── */
function clearGameCollectibles() {
  for (const { mesh, light } of GAME.collectibles) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    if (light) scene.remove(light);
  }
  GAME.collectibles = [];
  clearFootprints();
}

function clearFootprints() {
  for (const fp of GAME.footprints) {
    scene.remove(fp.mesh);
    fp.mesh.geometry.dispose();
    fp.mesh.material.dispose();
  }
  GAME.footprints = [];
}

/* ─── Update the game HUD elements ──────────────────────────────────────── */
function updateGameHUD() {
  document.getElementById('game-score').textContent = GAME.score.toLocaleString();

  const timerEl = document.getElementById('game-timer');
  timerEl.textContent = formatTime(GAME.timeLeft);
  if (GAME.timeLeft <= 30) {
    timerEl.classList.add('danger');
  } else {
    timerEl.classList.remove('danger');
  }

  /* Streak bar */
  const streakBar  = document.getElementById('game-streak-bar');
  const streakText = document.getElementById('game-streak-text');
  if (GAME.streak >= 3) {
    let streakRarity;
    if (GAME.streak >= 10) {
      streakRarity = 'legendary';
    } else if (GAME.streak >= 6) {
      streakRarity = 'rare';
    } else {
      streakRarity = 'uncommon';
    }
    const rs = RARITY_STYLE[streakRarity];
    streakText.textContent = `${GAME.streak}× Streak  ×${GAME.multiplier} pts`;
    streakText.style.color = rs.textColor;
    streakBar.style.opacity = '1';
  } else {
    streakText.textContent = '';
    streakBar.style.opacity = '0';
  }
}

function formatTime(s) {
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
