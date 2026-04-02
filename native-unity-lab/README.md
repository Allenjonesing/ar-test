# native-unity-lab — Unity AR Foundation Architecture Plan

## Overview

This Unity project implements the **native AR experiments** that cannot be
reproduced in a browser: local/hybrid world tracking (Experiment C), ARCore
Geospatial anchors (Experiment D), and GIS coordinate overlay (Experiment F).

It is a **separate project** from `web-lab`. It is not deployed as a web page.
It is built and deployed as an Android APK or iOS IPA.

See `docs/native-separation-notes.md` for the rationale.

---

## Project Structure

```
native-unity-lab/
├── Assets/
│   ├── Scenes/
│   │   ├── Loader.unity              # Shared experiment loader scene
│   │   ├── ExperimentC_LocalTracking.unity
│   │   ├── ExperimentD_GeospatialAnchors.unity
│   │   └── ExperimentF_GIS.unity
│   ├── Scripts/
│   │   ├── Core/
│   │   │   ├── ExperimentLoader.cs   # Reads config from backend, loads scene
│   │   │   ├── SessionManager.cs     # Session lifecycle, telemetry emission
│   │   │   ├── CapabilityChecker.cs  # Native capability detection
│   │   │   └── BackendClient.cs      # REST client for api-contract.md
│   │   ├── Tracking/
│   │   │   ├── LocalTrackingManager.cs
│   │   │   ├── GeospatialTrackingManager.cs
│   │   │   └── GISCoordinateManager.cs
│   │   ├── Anchors/
│   │   │   ├── AnchorController.cs
│   │   │   └── AnchorRenderer.cs
│   │   ├── UI/
│   │   │   ├── DebugHUD.cs
│   │   │   ├── LocalizationStatePanel.cs
│   │   │   └── DriftWarningBanner.cs
│   │   └── Experiments/
│   │       ├── ExperimentC.cs
│   │       ├── ExperimentD.cs
│   │       └── ExperimentF.cs
│   ├── Prefabs/
│   │   ├── AnchorSphere.prefab
│   │   ├── OriginAxes.prefab
│   │   └── DebugHUD.prefab
│   └── StreamingAssets/
│       └── default-config.json       # Fallback config if backend unreachable
├── Packages/
│   └── manifest.json                 # AR Foundation, ARCore XR Plugin, etc.
├── ProjectSettings/
└── README.md                         # This file
```

---

## Experiment C — AR Foundation Local / Hybrid

### Purpose
Establish a **native AR tracking baseline** using AR Foundation (ARCore on
Android, ARKit on iOS). Provides centimetre-scale local anchors without GPS
dependence, plus an optional GPS overlay for comparison with Experiment A.

### Architecture

```
Loader Scene
  └── ExperimentLoader.cs
        ├── Fetches ExperimentDefinition from backend (GET /experiments/experiment-c)
        ├── Reads configOptions (maxAnchors, showDebugHUD, …)
        └── Loads ExperimentC_LocalTracking scene additively

ExperimentC_LocalTracking scene
  ├── AR Session Origin
  │     └── AR Camera (ARCameraManager, ARCameraBackground)
  ├── AR Plane Manager         → detects horizontal/vertical planes
  ├── AR Raycast Manager       → tap-to-place hit testing
  ├── AnchorController.cs      → manages ARAnchor lifecycle
  ├── LocalTrackingManager.cs  → monitors ARSession.state, emits TrackingSnapshot
  └── DebugHUD.cs              → mirrors web-lab DebugHUD fields
```

### State Machine (LocalTrackingManager)

```
INITIALIZING
  │ ARSession.state == Tracking
  ▼
TRACKING
  │ Plane detected, user taps
  ▼
ANCHOR_PLACED
  │ Elapsed > driftWarningAfterSeconds
  ▼
DRIFT_WARNING (banner shown)
  │ Session ends / back button
  ▼
ENDED (telemetry posted to POST /telemetry)
```

### GPS Overlay (optional)

When `configOptions.enableGpsOverlay` is `true`, `LocalTrackingManager`
also starts `LocationService` and projects GPS coordinates onto the local
AR coordinate frame using the initial fix as the local origin.

**Accuracy note shown to user:** "GPS overlay ±5–15 m. Local AR anchors are
cm-scale. The two do not match precisely."

---

## Experiment D — ARCore Geospatial Anchors

### Purpose
Use the [ARCore Geospatial API](https://developers.google.com/ar/develop/geospatial)
to place WGS-84 anchors that persist at real-world coordinates at 10–30 cm
accuracy (where Google streetscape coverage exists).

### Prerequisites
- `com.google.ar.core` package with Geospatial feature enabled
- `AndroidManifest.xml` includes `<uses-feature android:name="android.hardware.camera.ar"/>`
- Google Cloud API key with ARCore API enabled
- Device outdoors in a covered streetscape area

### Architecture

```
ExperimentD_GeospatialAnchors scene
  ├── AR Session Origin
  │     └── AREarthManager           → ARCore Geospatial component
  ├── GeospatialTrackingManager.cs
  │     ├── Polls AREarthManager.EarthTrackingState
  │     ├── Emits TrackingSnapshot (localizationState: searching → coarse → fine → locked)
  │     └── Posts POST /calibration-events on state change
  ├── AnchorController.cs
  │     └── Creates ARGeospatialAnchor at lat/lng/alt/heading
  └── BackendClient.cs
        └── POST /anchors — persists anchor to backend for cross-session recall
```

### Localization State Flow

```
none → searching → coarse (heading accuracy < 25°) → fine (< 5°) → locked
```

A "Localization Readiness" panel shows the current state with honest labelling.
AR content is NOT shown until state reaches at least `coarse`.

---

## Experiment F — GIS / Engineering Coordinates

### Purpose
Place AR anchors using a local engineering coordinate grid rather than
WGS-84 GPS. Designed for AEC/construction sites where survey control points
define a known local origin.

### Architecture

```
ExperimentF_GIS scene
  ├── GISCoordinateManager.cs
  │     ├── Reads survey control points from backend (GET /scenes/:sceneId)
  │     ├── Computes transform: GIS grid → AR local space
  │     └── Projects GIS anchors into AR world space
  ├── AnchorController.cs
  └── DebugHUD.cs (shows coordinate residuals)
```

---

## Shared: Experiment Loader Scene

`Loader.unity` is the **entry point** for all experiments. It:

1. Shows a loading screen with the experiment name.
2. Calls `GET /experiments/:id` to fetch the current config.
3. Falls back to `StreamingAssets/default-config.json` if offline.
4. Calls `POST /sessions` to obtain a session token.
5. Loads the target scene additively.

This keeps individual experiment scenes free from bootstrap code.

---

## Backend Integration

| Action                    | Endpoint                       | When                         |
|---------------------------|--------------------------------|------------------------------|
| Load experiment config    | GET /experiments/:id           | App launch                   |
| Start session             | POST /sessions                 | After capability check       |
| Load scene anchors        | GET /scenes/:sceneId           | Scene load                   |
| Persist new anchor        | POST /anchors                  | User places anchor (D, F)    |
| Stream telemetry          | POST /telemetry                | Every 30 s + session end     |
| Record calibration event  | POST /calibration-events       | State machine transitions    |

---

## Platform-Specific Feature Plugging

`CapabilityChecker.cs` detects at runtime:

| Feature           | Android              | iOS                  |
|-------------------|----------------------|----------------------|
| ARCore support    | ARSession.state      | N/A                  |
| ARKit support     | N/A                  | ARSession.state      |
| Geospatial API    | AREarthManager       | Not supported        |
| GPS accuracy      | LocationService      | LocationService      |

Experiments gate features based on `CapabilityChecker` results, showing
honest "Not available on this device" messages rather than silently failing.

---

## Relationship to web-lab

| Aspect             | web-lab                          | native-unity-lab              |
|--------------------|----------------------------------|-------------------------------|
| Runtime            | Browser (WebXR / JS)             | Native app (Unity)            |
| Tracking quality   | Room-scale local; GPS ±5–15 m    | cm-scale local; geo ±10–30 cm |
| Deployment         | Static file host / GitHub Pages  | APK / IPA                     |
| API usage          | GET /experiments (public)        | All endpoints (authenticated) |
| Shared types       | shared/types/ (TypeScript)       | Mirror as C# classes          |

Both consume the same backend API defined in `backend/api-contract.md`.
