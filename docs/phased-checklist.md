# AR Lab — Phased Implementation Checklist

Status key: ✅ Done · 🔄 In Progress · ⬜ Not Started · 🚫 Blocked

---

## Phase 1 — Foundation & Browser Baselines

> Goal: honest static web experiments with no backend dependency.

### Architecture & Docs
- ✅ `docs/architecture.md` — system overview
- ✅ `docs/native-separation-notes.md` — why native is separate
- ✅ `docs/phased-checklist.md` — this file
- ✅ `backend/api-contract.md` — REST API contract defined
- ✅ `shared/types/experiment.ts` — TypeScript interfaces
- ✅ `shared/types/anchor.ts` — Anchor + Scene TypeScript interfaces

### Web Lab — Launcher
- ✅ `index.html` — AR Lab launcher with experiment catalog
- ✅ Capability status panel (HTTPS, camera, geolocation, WebXR, motion)
- ✅ Browser experiment cards with accurate drift/accuracy labels
- ✅ Native scaffold cards (coming-soon overlays)
- ✅ Legacy experiments section (links to existing HTML files)
- ✅ Animated starfield background preserved

### Web Lab — Shared Utilities
- ✅ `web-lab/registry.json` — experiment registry JSON
- ✅ `web-lab/shared/capability-check.js` — browser capability detection
- ✅ `web-lab/shared/debug-hud.js` — reusable debug overlay

### Experiment A — Browser Baseline World Tracking
- ✅ `web-lab/experiments/experiment-a/index.html` — complete page
- ✅ WebXR immersive-AR session request
- ✅ Hit-test reticle + tap-to-place spheres
- ✅ Graceful fallback to 3D preview when WebXR unavailable
- ✅ Drift warning banner after 60 s
- ✅ Inline debug HUD
- ✅ Clear anchors + Reset session controls
- ✅ "LOCAL SESSION ONLY" label visible at all times
- ⬜ Connect to POST /sessions + POST /telemetry (Phase 2)

### Experiment B — Browser Map + GPS
- ✅ `web-lab/experiments/experiment-b/index.html` — complete page
- ✅ Leaflet.js map with OSM tiles (no API key)
- ✅ Live GPS watch with accuracy circle
- ✅ Add POI at current position with label
- ✅ Bearing + distance panel for each POI
- ✅ Camera compass overlay with directional arrows
- ✅ Fallback simulated compass when camera unavailable
- ✅ "GPS ONLY — NOT centimetre AR" warning prominent
- ⬜ Connect to POST /sessions + POST /telemetry (Phase 2)

---

## Phase 2 — Backend API & Telemetry

> Goal: implement the backend so sessions and telemetry are recorded.

### Backend Implementation
- ⬜ Implement GET /experiments
- ⬜ Implement GET /experiments/:id
- ⬜ Implement POST /sessions (JWT issuance)
- ⬜ Implement POST /telemetry
- ⬜ Implement POST /calibration-events
- ⬜ Implement GET /scenes/:sceneId
- ⬜ Implement GET /locations/:locationId
- ⬜ Implement POST /anchors
- ⬜ Deploy backend to staging environment
- ⬜ `backend/mock-data/experiments.json` served by GET /experiments

### Web Lab — Backend Integration
- ⬜ Experiment A: POST /sessions on AR start
- ⬜ Experiment A: POST /telemetry streaming + session end
- ⬜ Experiment B: POST /sessions on GPS fix
- ⬜ Experiment B: POST /telemetry with GPS snapshots
- ⬜ Launcher: fetch registry from GET /experiments (fallback to registry.json)

---

## Phase 3 — Native AR Foundation (Unity)

> Goal: Experiments C and D working as native Android builds.

### Project Setup
- ⬜ Create Unity project in `native-unity-lab/`
- ⬜ Configure AR Foundation + ARCore XR Plugin
- ⬜ Implement `Loader.unity` + `ExperimentLoader.cs`
- ⬜ Implement `BackendClient.cs` (REST client)
- ⬜ Implement `SessionManager.cs` + `TelemetryEmitter.cs`
- ⬜ Implement `DebugHUD.cs` (mirrors web-lab HUD fields)

### Experiment C — AR Foundation Local/Hybrid
- ⬜ `ExperimentC_LocalTracking.unity` scene
- ⬜ `LocalTrackingManager.cs` with state machine
- ⬜ Tap-to-place anchors via AR Raycast Manager
- ⬜ Drift warning banner after configurable threshold
- ⬜ Optional GPS overlay mode
- ⬜ Telemetry integration

### Experiment D — ARCore Geospatial
- ⬜ `ExperimentD_GeospatialAnchors.unity` scene
- ⬜ `GeospatialTrackingManager.cs` with localisation state flow
- ⬜ `AREarthManager` integration
- ⬜ ARGeospatialAnchor creation at lat/lng/alt
- ⬜ POST /anchors for backend persistence
- ⬜ GET /scenes for loading stored anchors
- ⬜ Calibration events on state change
- ⬜ Localization readiness panel

---

## Phase 4 — VPS Lab & GIS

> Goal: Experiment E (Niantic VPS) and Experiment F (GIS) working.

### VPS Lab — Experiment E
- ⬜ Create Unity project in `vps-lab/`
- ⬜ Install Niantic Lightship ARDK via UPM
- ⬜ `WayspotLoader.cs` — fetch locations from backend
- ⬜ `VPSSessionManager.cs` — VPS session lifecycle
- ⬜ `LocalizationMonitor.cs` — state machine (attempting → localised → failed)
- ⬜ `VPSAnchorController.cs` — create/restore VPS anchors
- ⬜ `WayspotSelector.cs` — multi-location picker UI
- ⬜ POST /calibration-events on localisation state change
- ⬜ Backend content authoring workflow documented

### Experiment F — GIS / Engineering
- ⬜ `ExperimentF_GIS.unity` scene (in native-unity-lab)
- ⬜ `GISCoordinateManager.cs` — survey control point loader
- ⬜ GIS → AR coordinate frame transform
- ⬜ Anchor placement at GIS grid coordinates
- ⬜ Coordinate residual display in debug HUD
- ⬜ Backend integration for control point data

---

## Cross-Cutting Concerns (All Phases)

- ✅ Honest accuracy labels on all experiment UIs
- ✅ Drift warnings visible at appropriate thresholds
- ⬜ Accessibility: ARIA labels on interactive elements
- ⬜ End-to-end test: Experiment A on real Android device
- ⬜ End-to-end test: Experiment B outdoors with real GPS
- ⬜ End-to-end test: Experiment D with ARCore Geospatial API
- ⬜ Performance profiling: Experiment A FPS on mid-range Android
