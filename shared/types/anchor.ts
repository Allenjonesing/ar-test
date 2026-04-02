// ─── Anchor Type Enum ─────────────────────────────────────────────────────────

export type AnchorType =
  | 'screen-space'     // Overlaid on 2D screen; no world position
  | 'local-world'      // Relative to session origin; drifts on restart
  | 'geospatial'       // WGS-84 lat/lng/alt via ARCore Geospatial
  | 'vps'              // Visual Positioning System anchor
  | 'gis';             // Engineering / survey coordinate system

export type AnchorStatus =
  | 'pending'          // Not yet resolved
  | 'tracking'         // Actively tracked
  | 'paused'           // Tracking paused (e.g. device moved far away)
  | 'lost'             // Could not re-localise
  | 'error';

export type ContentType =
  | 'sphere'
  | 'box'
  | 'label'
  | 'model-gltf'
  | 'image'
  | 'video'
  | 'info-panel';

// ─── Anchor Definition ────────────────────────────────────────────────────────

export interface AnchorDefinition {
  id: string;
  title: string;
  anchorType: AnchorType;
  status: AnchorStatus;

  // Geospatial position (optional — not used for local-world anchors)
  lat?: number;
  lng?: number;
  altMeters?: number;

  // Local pose relative to session origin (optional — used for local-world)
  localPose?: {
    x: number;   // metres right
    y: number;   // metres up
    z: number;   // metres forward (negative = away from viewer in WebXR)
    quatX?: number;
    quatY?: number;
    quatZ?: number;
    quatW?: number;
  };

  // Content
  contentType: ContentType;
  renderAsset?: string;    // URL to glTF/image/video, or colour hex for primitives
  labelText?: string;

  // Confidence / quality
  confidence?: number;     // 0.0 – 1.0
  placedAtIso?: string;    // ISO-8601 timestamp when anchor was placed
  placedBySessionId?: string;
}

// ─── Location Definition ──────────────────────────────────────────────────────

export interface LocationDefinition {
  id: string;
  displayName: string;
  description?: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  anchors: AnchorDefinition[];
  vpsMapId?: string;       // Niantic VPS map identifier if applicable
}

// ─── Scene Definition ─────────────────────────────────────────────────────────

export interface SceneDefinition {
  id: string;
  experimentId: string;
  displayName: string;
  description?: string;
  locations: LocationDefinition[];
  defaultConfig?: Record<string, unknown>;
  createdAtIso: string;
  updatedAtIso: string;
}
