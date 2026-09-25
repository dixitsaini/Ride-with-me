import type { ConnectionState } from "../../core/location";

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type MapRegion = MapCoordinate & {
  latitudeDelta: number;
  longitudeDelta: number;
};

export type MapViewport =
  { region: MapRegion } | { bounds: MapCoordinate[]; padding?: number };

/**
 * Semantic freshness of a rider marker.
 *
 * `LIVE`  - the rider position is current.
 * `STALE` - a position exists but the source reported it as stale.
 * `UNAVAILABLE` - no position is known for the rider right now.
 *
 * The value is always derived from the existing realtime/location state; the
 * map layer never computes freshness on its own.
 */
export type RiderMarkerState = "LIVE" | "STALE" | "UNAVAILABLE";

export type RiderMarker = {
  /** Stable rider reference (the domain user id). Never rendered verbatim. */
  riderId: string;
  /** Display-ready label. Always non-empty; never the raw user id. */
  label: string;
  /** Profile display name when a profile source supplies one. */
  displayName: string | null;
  coordinate: MapCoordinate | null;
  /** Source timestamp of the position, from the realtime/location state. */
  timestamp: number | null;
  heading: number | null;
  state: RiderMarkerState;
  isCurrentUser: boolean;
};

export type MapPolyline = {
  id: string;
  /** Ordered coordinates. Order is preserved exactly as supplied. */
  coordinates: MapCoordinate[];
};

export type MapAnnotation = {
  id: string;
  coordinate: MapCoordinate;
  title?: string;
  subtitle?: string;
  /** Free-form semantic tag left to the annotation consumer (stop, note, ...). */
  kind?: string;
};

export type CameraMode =
  "FREE" | "FOLLOW_USER" | "FOLLOW_RIDE" | "FOLLOW_SELECTED_RIDER";

export type MapCameraState = {
  mode: CameraMode;
  /** Rider tracked by `FOLLOW_SELECTED_RIDER`, otherwise null. */
  selectedRiderId: string | null;
  /** Region the renderer should display. Null means "no controlled region". */
  region: MapRegion | null;
  /** Increments on every controller-driven region change. */
  sequence: number;
  /** Derived convenience flag; true for every follow mode. */
  following: boolean;
};

export type MapConnectionState = ConnectionState;

export type MapRenderState = {
  ready: boolean;
  currentRider: RiderMarker | null;
  /** Non-current riders, sorted by `riderId` for deterministic rendering. */
  riders: RiderMarker[];
  polylines: MapPolyline[];
  annotations: MapAnnotation[];
  camera: MapCameraState;
  connection: MapConnectionState;
  viewport: MapViewport | null;
};

export type MapProviderInitializeOptions = {
  viewport?: MapViewport | null;
  onReady?: () => void;
};

/**
 * Provider-agnostic rendering contract.
 *
 * Every method is incremental: callers add, update and remove individual
 * entities instead of repainting the whole map. Implementations must keep at
 * most one entry per entity id.
 */
export type MapProvider = {
  readonly kind: string;
  initialize: (options?: MapProviderInitializeOptions) => void;
  isReady: () => boolean;
  upsertRider: (marker: RiderMarker) => void;
  removeRider: (riderId: string) => void;
  setCurrentRider: (marker: RiderMarker | null) => void;
  setCamera: (camera: MapCameraState) => void;
  setViewport: (viewport: MapViewport | null) => void;
  upsertPolyline: (polyline: MapPolyline) => void;
  removePolyline: (polylineId: string) => void;
  clearPolylines: () => void;
  upsertAnnotation: (annotation: MapAnnotation) => void;
  removeAnnotation: (annotationId: string) => void;
  clearAnnotations: () => void;
  setConnectionState: (state: MapConnectionState) => void;
  dispose: () => void;
};

/**
 * A provider plus its read model. The read model is what the concrete map
 * surface renders from, which keeps provider-specific objects out of the
 * feature modules.
 */
export type MapProviderHandle = MapProvider & {
  getState: () => MapRenderState;
  subscribe: (listener: () => void) => () => void;
};

export const DEFAULT_MAP_CAMERA: MapCameraState = {
  mode: "FREE",
  selectedRiderId: null,
  region: null,
  sequence: 0,
  following: false,
};

export const DEFAULT_FOLLOW_REGION_SPAN = 0.02;
