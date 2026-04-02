# AR Lab — System Architecture

## System Overview

AR Lab is a multi-platform, multi-runtime research platform for exploring the
accuracy, limitations, and honest use-cases of five distinct AR/location
tracking approaches.

### The Five Tracking Approaches

| #  | Approach                  | Runtime           | Accuracy              | Platform          | Drift Risk |
|----|---------------------------|-------------------|-----------------------|-------------------|------------|
| A  | Browser WebXR Local       | Browser (WebXR)   | Room-scale local      | Android (Chrome)  | High       |
| B  | Browser GPS/Map           | Browser (JS)      | ±5–15 m GPS           | Any browser       | Low        |
| C  | AR Foundation Native      | Unity native      | cm-scale local        | Android + iOS     | Low        |
| D  | ARCore Geospatial         | Unity native      | ±10–30 cm outdoors    | Android only      | None       |
| E  | Niantic VPS               | Unity + ARDK      | < 1 m at wayspots     | Android + iOS     | None       |
| F  | GIS / Engineering         | Unity native      | mm–cm (RTK GPS)       | Android + iOS     | Low        |

---

## Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        AR Lab System                             │
│                                                                  │
│  ┌─────────────────────────┐   ┌──────────────────────────────┐  │
│  │        web-lab          │   │    native-unity-lab          │  │
│  │  (Static HTML/JS/CSS)   │   │    (Unity + AR Foundation)   │  │
│  │                         │   │                              │  │
│  │  index.html (launcher)  │   │  Loader.unity                │  │
│  │  experiment-a/          │   │  ExperimentC_LocalTracking   │  │
│  │    WebXR + Three.js     │   │  ExperimentD_Geospatial      │  │
│  │  experiment-b/          │   │  ExperimentF_GIS             │  │
│  │    Leaflet GPS map      │   │                              │  │
│  └──────────┬──────────────┘   └─────────────┬────────────────┘  │
│             │                                │                   │
│             │ HTTPS REST                     │ HTTPS REST        │
│             │                                │                   │
│  ┌──────────▼────────────────────────────────▼────────────────┐  │
│  │                      Backend API                           │  │
│  │              (api-contract.md defines contract)            │  │
│  │                                                            │  │
│  │  GET  /experiments        POST /sessions                   │  │
│  │  GET  /experiments/:id    POST /anchors                    │  │
│  │  GET  /scenes/:id         POST /telemetry                  │  │
│  │  GET  /locations/:id      POST /calibration-events         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                      vps-lab                               │ │
│  │              (Unity + Niantic Lightship ARDK)              │ │
│  │                                                            │ │
│  │  ExperimentE_VPS — Niantic wayspot localisation            │ │
│  └────────────────────────────┬───────────────────────────────┘ │
│                               │ HTTPS REST                      │
│                               ▼                                  │
│                        Backend API (same)                        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                  shared/types/                             │ │
│  │         TypeScript interfaces (source of truth)            │ │
│  │  experiment.ts — ExperimentDefinition, CapabilityReport,   │ │
│  │                  TrackingSnapshot, SessionTelemetry         │ │
│  │  anchor.ts     — AnchorDefinition, SceneDefinition,        │ │
│  │                  LocationDefinition                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Between Components

### 1. Browser experiment startup (web-lab)

```
User opens index.html
  → Capability check (CapabilityChecker.checkAll())
  → Capability status panel updated
  → User clicks experiment card
  → Experiment page loads (experiment-a or experiment-b)
  → (Optional) fetch registry.json to read configOptions
  → Session begins (local — no backend call in current phase)
```

### 2. Browser experiment telemetry (future)

```
Experiment page
  → POST /sessions (obtain token)
  → Experiment runs; snapshots collected
  → POST /telemetry every 30 s (streaming)
  → POST /telemetry with sessionEndIso on exit
```

### 3. Native experiment startup (native-unity-lab / vps-lab)

```
App launch → Loader.unity
  → CapabilityChecker.cs detects ARCore/ARKit/VPS support
  → GET /experiments/:id (fetch current config from backend)
  → POST /sessions (obtain session token)
  → Load experiment scene
  → Experiment runs
  → POST /telemetry (streaming + end)
```

### 4. Anchor persistence (Experiments D, E, F)

```
User places anchor in native app
  → AnchorController creates AR anchor
  → BackendClient.POST /anchors (anchor definition)
  → Backend stores anchor with sceneId + locationId
  → Next session: GET /scenes/:sceneId returns stored anchors
  → AnchorController re-creates anchors at stored poses
```

### 5. VPS localisation event

```
LocalizationMonitor detects VPS state change
  → POST /calibration-events (eventType: vps-localised | vps-localisation-failed)
  → Backend stores event for analysis
  → TelemetryEmitter includes event in next POST /telemetry
```

---

## Shared Types (Source of Truth)

`shared/types/` contains TypeScript interfaces that define the canonical
schema for all entities used across the system:

- `experiment.ts` — `ExperimentDefinition`, `CapabilityReport`,
  `TrackingSnapshot`, `SessionTelemetry`, `ExperimentConfig`, `DebugHUDState`
- `anchor.ts` — `AnchorDefinition`, `SceneDefinition`, `LocationDefinition`

The backend API contract (`backend/api-contract.md`) is derived from these
types. The Unity C# classes in native projects mirror these interfaces manually
(no code generation in the current phase).

---

## Shared Utilities (web-lab)

| File                             | Purpose                                              |
|----------------------------------|------------------------------------------------------|
| `web-lab/shared/capability-check.js` | Browser capability detection (IIFE, no build) |
| `web-lab/shared/debug-hud.js`    | Debug overlay (IIFE, no build required)             |
| `web-lab/registry.json`          | Local copy of experiment registry (no backend call) |

---

## Deployment

| Component          | Deployment target                       | Build required |
|--------------------|-----------------------------------------|----------------|
| web-lab            | GitHub Pages / any static host          | No             |
| native-unity-lab   | Google Play / Apple App Store / sideload| Yes (Unity)    |
| vps-lab            | Google Play / Apple App Store / sideload| Yes (Unity)    |
| backend            | Cloud function / Node server (future)   | Yes            |

---

## Design Principles

1. **Honest labelling** — every experiment prominently states its accuracy
   range, drift risk, and limitations. No marketing language.
2. **Graceful fallback** — browser experiments degrade gracefully when
   WebXR or camera is unavailable.
3. **No build step for web** — all web-lab files are plain HTML/CSS/JS
   loadable directly from a static file server.
4. **Shared contract** — `shared/types/` and `backend/api-contract.md`
   are the source of truth, ensuring all runtimes agree on data shapes.
5. **Separation of concerns** — browser, native ARCore, and VPS experiments
   live in separate directories and projects; they share only the API contract.
