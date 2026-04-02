# vps-lab — Niantic Spatial VPS Architecture Plan

## Overview

This project implements **Experiment E: Niantic Spatial VPS** — sub-metre
AR localisation at pre-scanned real-world locations using the
[Niantic Lightship ARDK](https://lightship.dev/).

This is a **native mobile project** (Unity + Lightship ARDK). It cannot run
in a browser. It is built and deployed as an Android APK or iOS IPA.

See `docs/native-separation-notes.md` for the rationale behind keeping this
separate from web-lab.

---

## Niantic Spatial VPS — Integration Approach

### What is VPS?

Niantic's Visual Positioning System (VPS) localises a device to a
sub-metre pose at a **pre-scanned wayspot** using visual feature matching
against a stored 3D map of that location. Accuracy is typically < 1 m.

Unlike GPS, VPS:
- Does **not** require outdoor coverage or satellite line-of-sight.
- Works at specific **scanned locations** only (not everywhere).
- Provides a **repeatable, drift-resistant** pose on each visit.
- Requires the Niantic Lightship SDK and a Niantic developer API key.

### What VPS is NOT

- Not a general-purpose positioning system.
- Not available at arbitrary locations — only at scanned wayspots.
- Not a substitute for GPS in outdoor navigation.

---

## Experiment E Architecture

### Project Structure

```
vps-lab/
├── Assets/
│   ├── Scenes/
│   │   ├── Loader.unity              # Entry point (shared pattern with native-unity-lab)
│   │   └── ExperimentE_VPS.unity
│   ├── Scripts/
│   │   ├── Core/
│   │   │   ├── VPSSessionManager.cs  # VPS session lifecycle
│   │   │   ├── BackendClient.cs      # REST client for api-contract.md
│   │   │   └── TelemetryEmitter.cs
│   │   ├── VPS/
│   │   │   ├── WayspotLoader.cs      # Fetches wayspot list from backend
│   │   │   ├── LocalizationMonitor.cs# Polls VPS localisation state
│   │   │   └── VPSAnchorController.cs
│   │   └── UI/
│   │       ├── LocalizationProgressPanel.cs
│   │       ├── DebugHUD.cs
│   │       └── WayspotSelector.cs
│   ├── Prefabs/
│   │   ├── VPSAnchor.prefab
│   │   └── LocalizationIndicator.prefab
│   └── StreamingAssets/
│       └── default-wayspots.json    # Fallback wayspot list
├── Packages/
│   └── manifest.json                # Lightship ARDK, AR Foundation
├── ProjectSettings/
└── README.md                        # This file
```

---

## Localization Success / Failure Flow

```
App Launch
  │
  ▼
WayspotLoader.cs
  └── GET /locations (filters by experimentId=experiment-e)
        ├── Success → populate WayspotSelector UI
        └── Failure → load default-wayspots.json from StreamingAssets

User selects wayspot
  │
  ▼
VPSSessionManager.StartVPSSession(wayspotId)
  │
  ├── POST /sessions (obtain session token)
  │
  ▼
LocalizationMonitor begins polling IARLocalizationPayload
  │
  ├── State: ATTEMPTING_LOCALIZATION
  │     └── Show: "Scanning… point device at the location"
  │
  ├── State: LOCALIZED (success)
  │     ├── Show: "✓ Localised — sub-metre accuracy"
  │     ├── POST /calibration-events (eventType: vps-localised)
  │     └── Reveal VPS-anchored content
  │
  ├── State: FAILED (timeout > 30 s with no fix)
  │     ├── Show: "✗ VPS localisation failed"
  │     ├── Offer: "Try again" or "Exit"
  │     └── POST /calibration-events (eventType: vps-localisation-failed)
  │
  └── State: LOST (localisation lost after initial fix)
        ├── Show: "⚠ Tracking lost — re-scanning"
        └── POST /calibration-events (eventType: relocalisation-triggered)

Session End
  └── POST /telemetry (full session summary)
```

---

## Backend Scene Storage

VPS-anchored content is stored on the backend, not hard-coded in the app.
This enables adding new content at a wayspot without a new app build.

### Content retrieval flow

1. After localisation success, `VPSAnchorController` calls:
   `GET /scenes/:sceneId` where `sceneId` maps to the current wayspot.
2. The response contains `SceneDefinition.locations[0].anchors[]` —
   a list of `AnchorDefinition` objects with `anchorType: "vps"`.
3. Each anchor's `localPose` is expressed in the wayspot's local
   coordinate frame (origin = VPS localisation origin).
4. `VPSAnchorController` creates `PersistentAnchorComponent` instances
   at the specified poses and attaches the content prefab.

### Content authoring

Content authors place anchors at a wayspot using a separate editor tool
(future work) which posts `POST /anchors` with the VPS local pose.

---

## Multi-Location Support Strategy

The app supports multiple wayspot locations without rebuilding:

1. `WayspotSelector` UI lists all available wayspots fetched from the backend.
2. Each wayspot has a unique `locationId` and `vpsMapId` (Niantic wayspot ID).
3. On selection, the app initialises the Lightship VPS session with that
   wayspot's `vpsMapId`.
4. Scene content for each wayspot is fetched independently from the backend.

To add a new location:
1. Scan the real-world location with the Niantic Wayfarer app to create a wayspot.
2. Add a `LocationDefinition` to the backend with the Niantic `vpsMapId`.
3. Place anchors via `POST /anchors` — no app update required.

---

## Relationship to web-lab and native-unity-lab

| Aspect              | web-lab                | native-unity-lab        | vps-lab                     |
|---------------------|------------------------|-------------------------|-----------------------------|
| Tracking            | WebXR local / GPS      | ARCore/ARKit + Geo      | Niantic VPS                 |
| Accuracy            | Room-scale / ±5–15 m   | cm-local / ±10–30 cm    | < 1 m at wayspots           |
| Location constraint | None                   | Outdoor streetscape      | Pre-scanned wayspot only    |
| SDK                 | Browser APIs           | AR Foundation            | Lightship ARDK              |
| Deployment          | Static web             | APK / IPA               | APK / IPA                   |
| Backend API usage   | Public endpoints only  | Full authenticated API  | Full authenticated API      |

---

## Prerequisites for Development

- Unity 2022 LTS or later
- [Niantic Lightship ARDK](https://lightship.dev/docs/ardk/) installed via UPM
- Niantic developer account and API key
- AR Foundation 5.x
- Android Build Support or iOS Build Support module
- A physical Android or iOS device (VPS cannot be tested in the editor)
- Access to a pre-scanned Niantic wayspot for end-to-end testing
