# AR Lab — Backend API Contract

## Overview

This document defines the REST API contract for the AR Lab backend.
The backend serves experiment definitions, scene configurations, persistent
anchors, and telemetry ingestion.

All web-lab experiments communicate with this API over HTTPS.
Native labs (Unity, VPS) also use this API for scene configs and anchor
persistence where applicable.

---

## Base URL

```
https://api.arlab.example.com/v1
```

During local development, use:

```
http://localhost:3000/v1
```

---

## Authentication

All endpoints except `GET /experiments` and `GET /experiments/:id` require a
Bearer token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Tokens are session-scoped JWTs issued by `POST /sessions`.

Unauthenticated requests return `401 Unauthorized`.

---

## Error Response Format

All errors return a consistent JSON envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Experiment 'experiment-z' not found.",
    "details": {}
  }
}
```

| Field     | Type   | Description                            |
|-----------|--------|----------------------------------------|
| code      | string | Machine-readable error code            |
| message   | string | Human-readable description             |
| details   | object | Optional extra context (may be empty)  |

### Common error codes

| Code                | HTTP Status | Description                        |
|---------------------|-------------|------------------------------------|
| NOT_FOUND           | 404         | Resource does not exist            |
| UNAUTHORIZED        | 401         | Missing or invalid token           |
| FORBIDDEN           | 403         | Token lacks required scope         |
| VALIDATION_ERROR    | 422         | Request body failed validation     |
| INTERNAL_ERROR      | 500         | Unexpected server error            |

---

## Entity Definitions

### ExperimentDefinition

```json
{
  "id": "experiment-a",
  "displayName": "Browser Baseline World Tracking",
  "description": "string",
  "runtimeType": "browser-webxr | browser-gps | native-arfoundation | native-arcore-geospatial | native-vps | native-gis",
  "environment": "indoor | outdoor | mixed | any",
  "trackingMode": "local-world | gps-relative | arcore-geospatial | vps | gis-coordinates",
  "requiredCapabilities": ["https", "camera", "webxr-ar"],
  "supportedPlatforms": ["web-android", "web-ios", "web-desktop", "android", "ios"],
  "expectedAccuracy": "Room-scale only",
  "driftRisk": "none | low | medium | high",
  "driftNote": "string (optional)",
  "starterScene": "string (URL or Unity scene name, optional)",
  "configOptions": {},
  "limitations": ["string"],
  "bestUseCase": "string",
  "deviceRequirements": ["string"],
  "status": "available | coming-soon | deprecated",
  "labPath": "string (relative URL, nullable)"
}
```

### SceneDefinition

```json
{
  "id": "scene-001",
  "experimentId": "experiment-a",
  "displayName": "string",
  "description": "string (optional)",
  "locations": ["LocationDefinition"],
  "defaultConfig": {},
  "createdAtIso": "2025-01-01T00:00:00Z",
  "updatedAtIso": "2025-01-01T00:00:00Z"
}
```

### AnchorDefinition

```json
{
  "id": "anchor-001",
  "title": "string",
  "anchorType": "screen-space | local-world | geospatial | vps | gis",
  "status": "pending | tracking | paused | lost | error",
  "lat": 51.5,
  "lng": -0.09,
  "altMeters": 10.0,
  "localPose": {
    "x": 0.0,
    "y": 0.0,
    "z": -0.5,
    "quatX": 0.0,
    "quatY": 0.0,
    "quatZ": 0.0,
    "quatW": 1.0
  },
  "contentType": "sphere | box | label | model-gltf | image | video | info-panel",
  "renderAsset": "string (URL or hex colour, optional)",
  "labelText": "string (optional)",
  "confidence": 0.95,
  "placedAtIso": "2025-01-01T00:00:00Z",
  "placedBySessionId": "string"
}
```

### LocationDefinition

```json
{
  "id": "location-001",
  "displayName": "string",
  "description": "string (optional)",
  "centerLat": 51.5,
  "centerLng": -0.09,
  "radiusMeters": 50.0,
  "anchors": ["AnchorDefinition"],
  "vpsMapId": "string (optional)"
}
```

### CapabilityReport

```json
{
  "timestamp": "2025-01-01T00:00:00Z",
  "https": { "status": "pass | fail | unknown", "detail": "string" },
  "camera": { "status": "pass | fail | unknown", "detail": "string" },
  "geolocation": { "status": "pass | fail | unknown", "detail": "string" },
  "webxr": { "status": "pass | fail | unknown", "detail": "string" },
  "motionSensors": { "status": "pass | fail | unknown", "detail": "string" }
}
```

### TrackingSnapshot

```json
{
  "sessionId": "string",
  "timestamp": "2025-01-01T00:00:00Z",
  "trackingState": "initializing | tracking | limited | lost",
  "localizationState": "none | searching | coarse | fine | locked",
  "anchorSource": "local-world | gps-relative | arcore-geospatial | vps | gis-coordinates",
  "gpsAccuracyMeters": 8.0,
  "headingConfidenceDeg": 5.0,
  "relocalizationCount": 0,
  "driftWarning": false,
  "userPositionSource": "gps | imu | vps | manual | unknown",
  "pose": {
    "lat": 51.5,
    "lng": -0.09,
    "altMeters": 10.0,
    "headingDeg": 270.0
  }
}
```

### SessionTelemetry

```json
{
  "sessionId": "string",
  "experimentId": "experiment-a",
  "deviceInfo": {
    "userAgent": "string",
    "platform": "string",
    "screenWidth": 390,
    "screenHeight": 844
  },
  "capabilityReport": "CapabilityReport",
  "trackingSnapshots": ["TrackingSnapshot"],
  "sessionStartIso": "2025-01-01T00:00:00Z",
  "sessionEndIso": "2025-01-01T00:05:00Z",
  "totalAnchorsPlaced": 3,
  "errorLog": [
    { "timestamp": "2025-01-01T00:00:01Z", "message": "string", "stack": "string (optional)" }
  ]
}
```

---

## Endpoints

---

### GET /experiments

Returns all experiment definitions in the registry.

**Auth:** Not required

**Response 200:**
```json
{
  "experiments": ["ExperimentDefinition"]
}
```

---

### GET /experiments/:id

Returns a single experiment definition.

**Auth:** Not required

**Path params:**
| Param | Type   | Description         |
|-------|--------|---------------------|
| id    | string | Experiment ID       |

**Response 200:**
```json
{
  "experiment": "ExperimentDefinition"
}
```

**Response 404:** Experiment not found.

---

### GET /scenes/:sceneId

Returns a full scene definition including all locations and anchors.

**Auth:** Bearer token required

**Path params:**
| Param   | Type   | Description   |
|---------|--------|---------------|
| sceneId | string | Scene ID      |

**Response 200:**
```json
{
  "scene": "SceneDefinition"
}
```

---

### GET /locations/:locationId

Returns a single location definition with its anchors.

**Auth:** Bearer token required

**Path params:**
| Param      | Type   | Description     |
|------------|--------|-----------------|
| locationId | string | Location ID     |

**Response 200:**
```json
{
  "location": "LocationDefinition"
}
```

---

### POST /anchors

Creates or upserts a persistent anchor. Used by experiments that store
anchors on the backend (ARCore Geospatial, VPS).

**Auth:** Bearer token required

**Request body:**
```json
{
  "sceneId": "string",
  "anchor": "AnchorDefinition (without id — server assigns)"
}
```

**Response 201:**
```json
{
  "anchor": "AnchorDefinition (with server-assigned id)"
}
```

**Response 422:** Validation error (missing required fields, invalid anchorType).

---

### POST /sessions

Initialises a new experiment session. Returns a session-scoped JWT for
subsequent authenticated requests.

**Auth:** Not required (public endpoint)

**Request body:**
```json
{
  "experimentId": "string",
  "deviceInfo": {
    "userAgent": "string",
    "platform": "string",
    "screenWidth": 390,
    "screenHeight": 844
  },
  "capabilityReport": "CapabilityReport"
}
```

**Response 201:**
```json
{
  "sessionId": "string",
  "token": "string (JWT)",
  "expiresAt": "2025-01-01T01:00:00Z"
}
```

---

### POST /telemetry

Appends telemetry data for an active session. Can be called multiple
times during a session (streaming snapshots) or once at session end.

**Auth:** Bearer token required

**Request body:**
```json
{
  "sessionId": "string",
  "trackingSnapshots": ["TrackingSnapshot"],
  "errorLog": [{ "timestamp": "string", "message": "string", "stack": "string" }],
  "totalAnchorsPlaced": 0,
  "sessionEndIso": "string (optional — set on final call)"
}
```

**Response 200:**
```json
{
  "received": true,
  "snapshotCount": 5
}
```

---

### POST /calibration-events

Records a single calibration or re-localisation event for analysis.

**Auth:** Bearer token required

**Request body:**
```json
{
  "sessionId": "string",
  "eventType": "heading-calibrated | vps-localised | gps-updated | relocalisation-triggered",
  "timestamp": "2025-01-01T00:00:00Z",
  "data": {}
}
```

**Response 201:**
```json
{
  "eventId": "string"
}
```

---

## Notes

- All timestamps are ISO-8601 UTC strings.
- Pagination is not yet defined; will be added when experiment/anchor counts justify it.
- The backend is not yet implemented — this document specifies the contract
  for future implementation and for generating mock data.
