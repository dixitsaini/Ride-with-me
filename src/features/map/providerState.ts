import {
  DEFAULT_MAP_CAMERA,
  type MapAnnotation,
  type MapCameraState,
  type MapConnectionState,
  type MapPolyline,
  type MapProviderHandle,
  type MapProviderInitializeOptions,
  type MapRenderState,
  type MapViewport,
  type RiderMarker,
} from "./types";

function sortByRiderId(left: RiderMarker, right: RiderMarker): number {
  if (left.riderId === right.riderId) {
    return 0;
  }
  return left.riderId < right.riderId ? -1 : 1;
}

function createSnapshot(
  ready: boolean,
  currentRider: RiderMarker | null,
  riders: RiderMarker[],
  polylines: MapPolyline[],
  annotations: MapAnnotation[],
  camera: MapCameraState,
  connection: MapConnectionState,
  viewport: MapViewport | null,
): MapRenderState {
  return {
    ready,
    currentRider,
    riders,
    polylines,
    annotations,
    camera,
    connection,
    viewport,
  };
}

/**
 * Provider-internal incremental projection.
 *
 * Entity maps are keyed by id, so a rider/polyline/annotation can never be
 * duplicated and an update replaces the existing entry instead of appending.
 * A cached snapshot keeps `getState()` referentially stable for renderers.
 */
export function createMapProviderRuntime(kind: string): MapProviderHandle {
  const listeners = new Set<() => void>();
  const riderMarkers = new Map<string, RiderMarker>();
  const polylines = new Map<string, MapPolyline>();
  const annotations = new Map<string, MapAnnotation>();

  let ready = false;
  let disposed = false;
  let currentRider: RiderMarker | null = null;
  let camera: MapCameraState = DEFAULT_MAP_CAMERA;
  let connection: MapConnectionState = "DISCONNECTED";
  let viewport: MapViewport | null = null;
  let snapshot: MapRenderState = createSnapshot(
    ready,
    currentRider,
    [],
    [],
    [],
    camera,
    connection,
    viewport,
  );

  const rebuild = (): void => {
    snapshot = createSnapshot(
      ready,
      currentRider,
      [...riderMarkers.values()].sort(sortByRiderId),
      [...polylines.values()],
      [...annotations.values()],
      camera,
      connection,
      viewport,
    );
  };

  const touch = (): void => {
    rebuild();
    listeners.forEach((listener) => listener());
  };

  const active = (): boolean => !disposed;

  return {
    kind,
    initialize(options?: MapProviderInitializeOptions) {
      if (!active()) {
        return;
      }
      if (options && "viewport" in options) {
        viewport = options.viewport ?? null;
      }
      ready = true;
      touch();
      options?.onReady?.();
    },
    isReady() {
      return ready && active();
    },
    upsertRider(marker) {
      if (!active()) {
        return;
      }
      if (marker.isCurrentUser) {
        currentRider = marker;
      } else {
        // Map.set on an existing key keeps the original insertion order.
        riderMarkers.set(marker.riderId, marker);
      }
      touch();
    },
    removeRider(riderId) {
      if (!active() || !riderMarkers.has(riderId)) {
        return;
      }
      riderMarkers.delete(riderId);
      touch();
    },
    setCurrentRider(marker) {
      if (!active() || currentRider === marker) {
        return;
      }
      currentRider = marker;
      touch();
    },
    setCamera(nextCamera) {
      if (!active()) {
        return;
      }
      camera = nextCamera;
      touch();
    },
    setViewport(nextViewport) {
      if (!active() || viewport === nextViewport) {
        return;
      }
      viewport = nextViewport;
      touch();
    },
    upsertPolyline(polyline) {
      if (!active()) {
        return;
      }
      polylines.set(polyline.id, polyline);
      touch();
    },
    removePolyline(polylineId) {
      if (!active() || !polylines.has(polylineId)) {
        return;
      }
      polylines.delete(polylineId);
      touch();
    },
    clearPolylines() {
      if (!active() || polylines.size === 0) {
        return;
      }
      polylines.clear();
      touch();
    },
    upsertAnnotation(annotation) {
      if (!active()) {
        return;
      }
      annotations.set(annotation.id, annotation);
      touch();
    },
    removeAnnotation(annotationId) {
      if (!active() || !annotations.has(annotationId)) {
        return;
      }
      annotations.delete(annotationId);
      touch();
    },
    clearAnnotations() {
      if (!active() || annotations.size === 0) {
        return;
      }
      annotations.clear();
      touch();
    },
    setConnectionState(nextConnection) {
      if (!active() || connection === nextConnection) {
        return;
      }
      connection = nextConnection;
      touch();
    },
    dispose() {
      if (disposed) {
        return;
      }
      riderMarkers.clear();
      polylines.clear();
      annotations.clear();
      currentRider = null;
      ready = false;
      camera = DEFAULT_MAP_CAMERA;
      viewport = null;
      rebuild();
      const pending = [...listeners];
      listeners.clear();
      disposed = true;
      pending.forEach((listener) => listener());
    },
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
