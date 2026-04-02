// ─── Runtime / Environment / Tracking enums ───────────────────────────────────

export type RuntimeType =
  | 'browser-webxr'
  | 'browser-gps'
  | 'native-arfoundation'
  | 'native-arcore-geospatial'
  | 'native-vps'
  | 'native-gis';

export type EnvironmentType =
  | 'indoor'
  | 'outdoor'
  | 'mixed'
  | 'any';

export type TrackingMode =
  | 'local-world'       // Device-relative, resets on session restart
  | 'gps-relative'      // GPS + compass bearing
  | 'arcore-geospatial' // ARCore Geospatial API (WGS-84 anchors)
  | 'vps'               // Visual Positioning System
  | 'gis-coordinates';  // Engineering / survey coordinates

export type DriftRisk = 'none' | 'low' | 'medium' | 'high';

export type Platform = 'web-android' | 'web-ios' | 'web-desktop' | 'android' | 'ios';

export type CapabilityKey =
  | 'https'
  | 'camera'
  | 'geolocation'
  | 'webxr-ar'
  | 'motion-sensors'
  | 'arcore'
  | 'arkit'
  | 'vps-sdk';

export type CapabilityStatus = 'pass' | 'fail' | 'unknown' | 'not-required';

// ─── Capability Report ─────────────────────────────────────────────────────────

export interface CapabilityCheck {
  status: CapabilityStatus;
  detail?: string;
}

export interface CapabilityReport {
  timestamp: string;       // ISO-8601
  https: CapabilityCheck;
  camera: CapabilityCheck;
  geolocation: CapabilityCheck;
  webxr: CapabilityCheck;
  motionSensors: CapabilityCheck;
  arcore?: CapabilityCheck;
  arkit?: CapabilityCheck;
  vpsSdk?: CapabilityCheck;
}

// ─── Tracking Snapshot ────────────────────────────────────────────────────────

export interface TrackingSnapshot {
  sessionId: string;
  timestamp: string;              // ISO-8601
  trackingState: 'initializing' | 'tracking' | 'limited' | 'lost';
  localizationState: 'none' | 'searching' | 'coarse' | 'fine' | 'locked';
  anchorSource: TrackingMode;
  gpsAccuracyMeters?: number;
  headingConfidenceDeg?: number;
  relocalizationCount: number;
  driftWarning: boolean;
  userPositionSource: 'gps' | 'imu' | 'vps' | 'manual' | 'unknown';
  pose?: {
    lat?: number;
    lng?: number;
    altMeters?: number;
    headingDeg?: number;
  };
}

// ─── Session Telemetry ────────────────────────────────────────────────────────

export interface SessionTelemetry {
  sessionId: string;
  experimentId: string;
  deviceInfo: {
    userAgent: string;
    platform: string;
    screenWidth: number;
    screenHeight: number;
  };
  capabilityReport: CapabilityReport;
  trackingSnapshots: TrackingSnapshot[];
  sessionStartIso: string;
  sessionEndIso?: string;
  totalAnchorsPlaced: number;
  errorLog: Array<{ timestamp: string; message: string; stack?: string }>;
}

// ─── Experiment Config Options ────────────────────────────────────────────────

export interface ExperimentConfig {
  maxAnchors?: number;
  driftWarningAfterSeconds?: number;
  showDebugHUD?: boolean;
  mapTileProvider?: string;
  gpsPollingIntervalMs?: number;
  anchorPersistence?: 'session' | 'local' | 'backend';
  [key: string]: unknown;
}

// ─── Experiment Definition (core schema) ─────────────────────────────────────

export interface ExperimentDefinition {
  id: string;
  displayName: string;
  description: string;
  runtimeType: RuntimeType;
  environment: EnvironmentType;
  trackingMode: TrackingMode;
  requiredCapabilities: CapabilityKey[];
  supportedPlatforms: Platform[];
  expectedAccuracy: string;          // Human-readable, e.g. "5–15 m GPS only"
  driftRisk: DriftRisk;
  driftNote?: string;
  starterScene?: string;             // URL or Unity scene name
  configOptions?: ExperimentConfig;
  limitations: string[];
  bestUseCase: string;
  deviceRequirements: string[];
  status: 'available' | 'coming-soon' | 'deprecated';
  labPath?: string;                  // Relative URL for browser experiments
}

// ─── Debug HUD State ──────────────────────────────────────────────────────────

export interface DebugHUDState {
  gpsAccuracy: string;
  headingConfidence: string;
  trackingState: string;
  localizationState: string;
  anchorSource: string;
  relocalizationCount: number;
  driftWarning: boolean;
  userPositionSource: string;
  experimentMode: string;
  fps?: number;
  anchorCount?: number;
}
