/**
 * ar.js — AR Experiment
 *
 * Uses Three.js + WebXR (immersive-ar + hit-test) to:
 *   • Stream the real-world camera as the scene background
 *   • Detect surfaces via the hit-test API and show a reticle
 *   • Place random 3D objects on detected surfaces with a tap/click
 *   • Fall back to a simulation mode on non-XR browsers
 *
 * Debug panel (toggle with the ⚙ Debug button) exposes:
 *   Axes helper, ground grid, plane overlays, surface normals,
 *   bounding boxes, wireframe, FPS counter, camera-world-matrix,
 *   XR session state, and live hit-test pose readout.
 */

'use strict';

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

  /* Click to place objects in simulation mode */
  const canvas = document.getElementById('ar-canvas');
  canvas.addEventListener('click',      onSimClick);
  canvas.addEventListener('touchstart', onSimTouch, { passive: true });

  document.getElementById('start-ar-btn').textContent = 'Place Object';
  document.getElementById('start-ar-btn').disabled    = false;
  document.getElementById('reticle-hint').style.display = '';
  document.getElementById('reticle-hint').textContent   = 'Click / tap anywhere to place objects';

  document.getElementById('no-ar-banner').style.display = 'block';
  setTimeout(() => { document.getElementById('no-ar-banner').style.display = 'none'; }, 4500);

  /* "Start AR" just places an object at centre in sim mode */
  document.getElementById('start-ar-btn').removeEventListener('click', toggleAR);
  document.getElementById('start-ar-btn').addEventListener('click', () => placeObjectAtPosition(
    new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)
  ));
}

function onSimClick(e) {
  const rect   = renderer.domElement.getBoundingClientRect();
  const ndc    = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top)  / rect.height) * 2 + 1
  );
  rayCastToGround(ndc);
}

function onSimTouch(e) {
  if (e.touches.length !== 1) return;
  const touch = e.touches[0];
  const rect  = renderer.domElement.getBoundingClientRect();
  const ndc   = new THREE.Vector2(
    ((touch.clientX - rect.left) / rect.width)  * 2 - 1,
    -((touch.clientY - rect.top)  / rect.height) * 2 + 1
  );
  rayCastToGround(ndc);
}

function rayCastToGround(ndc) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const target = new THREE.Vector3();
  raycaster.ray.intersectPlane(ground, target);
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

  updateStatus('AR active — point at a surface and tap to place.');
  updateXRInfoDisplay('Session started\nMode: immersive-ar\nFeatures: hit-test');
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

  document.getElementById('start-ar-btn').textContent = 'Start AR';
  document.getElementById('start-ar-btn').classList.remove('active');
  document.getElementById('reticle-hint').style.display = 'none';

  updateStatus('AR session ended.');
  updateXRInfoDisplay('No active session');
}

function onXRSelect() {
  if (reticle.visible) {
    const pos = new THREE.Vector3();
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
  updatePlacedCount();
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
  bindToggle('dbg-planes',    'showPlanes',    () => { /* plane overlay: future */ });
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
  document.getElementById('placed-count').textContent = `Objects: ${placedObjects.length}`;
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
