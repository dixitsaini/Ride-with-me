import type {
  LocationEngineStatus,
  LocationSample,
  RealtimeLocationUpdate,
} from "../../core/location";
import {
  createMapCameraController,
  type MapCameraController,
  type MapCameraSetModeOptions,
} from "./camera";
import { resolveRiderIdentity, type DisplayNameResolver } from "./identity";
import type {
  CameraMode,
  MapAnnotation,
  MapConnectionState,
  MapCoordinate,
  MapPolyline,
  MapProviderHandle,
  MapRegion,
  MapRenderState,
  MapViewport,
  RiderMarker,
  RiderMarkerState,
} from "./types";

export type CurrentRiderLocationInput = {
  /** Latest locally acquired sample, or null when location is unavailable. */
  sample: LocationSample | null;
  /** Freshness reported by the location engine. The map never recomputes it. */
  freshness: "FRESH" | "STALE" | "UNKNOWN";
};

export function currentRiderLocationFromEngineStatus(
  status: Pick<LocationEngineStatus, "lastAcceptedSample" | "freshness">,
): CurrentRiderLocationInput {
  return {
    sample: status.lastAcceptedSample,
    freshness: status.freshness,
  };
}

export type MapControllerOptions = {
  provider: MapProviderHandle;
  /** Rider reference of the device owner; null disables current-rider state. */
  currentRiderId?: string | null;
  displayNameResolver?: DisplayNameResolver;
};

export type MapController = {
  readonly provider: MapProviderHandle;
  initialize: () => void;
  isReady: () => boolean;
  setViewport: (viewport: MapViewport | null) => void;
  setConnectionState: (state: MapConnectionState) => void;
  setCurrentRiderLocation: (input: CurrentRiderLocationInput | null) => void;
  applyRiderUpdate: (update: RealtimeLocationUpdate) => RiderMarker;
  removeRider: (riderId: string) => void;
  setCameraMode: (mode: CameraMode, options?: MapCameraSetModeOptions) => void;
  notifyUserCameraGesture: (region: MapRegion) => void;
  resetCamera: () => void;
  upsertPolyline: (polyline: MapPolyline) => void;
  removePolyline: (polylineId: string) => void;
  clearPolylines: () => void;
  upsertAnnotation: (annotation: MapAnnotation) => void;
  removeAnnotation: (annotationId: string) => void;
  clearAnnotations: () => void;
  getState: () => MapRenderState;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

function markerStateFor(
  sample: LocationSample | null,
  freshness: CurrentRiderLocationInput["freshness"],
): RiderMarkerState {
  if (!sample) {
    return "UNAVAILABLE";
  }
  return freshness === "FRESH" ? "LIVE" : "STALE";
}

/**
 * Authoritative map state model.
 *
 * It is the only bridge between the domain layers (location, realtime, ride)
 * and a `MapProvider`. It never acquires GPS and never opens its own realtime
 * subscription: it is fed by whoever owns those responsibilities.
 *
 * Current-rider ownership rule: once the local location state has produced a
 * marker for the current rider, realtime echoes of the same rider are ignored
 * so a single authoritative representation exists and freshness cannot flip
 * between sources.
 */
export function createMapController(
  options: MapControllerOptions,
): MapController {
  const { provider, displayNameResolver } = options;
  const currentRiderId = options.currentRiderId ?? null;
  let hasLocalCurrentRider = false;
  let disposed = false;

  const readState = (): MapRenderState => provider.getState();

  const camera: MapCameraController = createMapCameraController({
    getCurrentCoordinate: () => readState().currentRider?.coordinate ?? null,
    getRiderCoordinate: (riderId) =>
      readState().riders.find((marker) => marker.riderId === riderId)
        ?.coordinate ?? null,
    getOtherCoordinates: () =>
      readState().riders.reduce<MapCoordinate[]>((coordinates, marker) => {
        if (marker.coordinate) {
          coordinates.push(marker.coordinate);
        }
        return coordinates;
      }, []),
    onChange: (nextCamera) => {
      if (!disposed) {
        provider.setCamera(nextCamera);
      }
    },
  });

  const identityOf = (riderId: string) =>
    resolveRiderIdentity(riderId, displayNameResolver);

  const markerFromUpdate = (update: RealtimeLocationUpdate): RiderMarker => {
    const identity = identityOf(update.userId);
    return {
      riderId: identity.riderId,
      label: identity.label,
      displayName: identity.displayName,
      coordinate: {
        latitude: update.location.latitude,
        longitude: update.location.longitude,
      },
      timestamp: update.location.timestamp,
      heading: update.location.heading ?? null,
      state: update.stale ? "STALE" : "LIVE",
      isCurrentUser:
        currentRiderId !== null && update.userId === currentRiderId,
    };
  };

  return {
    provider,
    initialize() {
      if (disposed || provider.isReady()) {
        return;
      }
      provider.initialize();
    },
    isReady: () => provider.isReady(),
    setViewport(viewport) {
      if (!disposed) {
        provider.setViewport(viewport);
      }
    },
    setConnectionState(state) {
      if (!disposed) {
        provider.setConnectionState(state);
      }
    },
    setCurrentRiderLocation(input) {
      if (disposed || !currentRiderId) {
        return;
      }
      hasLocalCurrentRider = true;
      const identity = identityOf(currentRiderId);
      const sample = input?.sample ?? null;
      provider.setCurrentRider({
        riderId: identity.riderId,
        label: identity.label,
        displayName: identity.displayName,
        coordinate: sample
          ? { latitude: sample.latitude, longitude: sample.longitude }
          : null,
        timestamp: sample ? sample.timestamp : null,
        heading: sample ? (sample.heading ?? null) : null,
        state: markerStateFor(sample, input?.freshness ?? "UNKNOWN"),
        isCurrentUser: true,
      });
      camera.refresh();
    },
    applyRiderUpdate(update) {
      const marker = markerFromUpdate(update);
      if (disposed) {
        return marker;
      }

      if (marker.isCurrentUser) {
        if (!hasLocalCurrentRider) {
          provider.setCurrentRider(marker);
          camera.refresh();
        }
        return marker;
      }

      provider.upsertRider(marker);
      camera.refresh();
      return marker;
    },
    removeRider(riderId) {
      if (disposed) {
        return;
      }
      if (riderId === currentRiderId) {
        provider.setCurrentRider(null);
        hasLocalCurrentRider = false;
        return;
      }
      provider.removeRider(riderId);
      camera.handleRiderRemoved(riderId);
    },
    setCameraMode(mode, cameraOptions) {
      if (!disposed) {
        camera.setMode(mode, cameraOptions);
      }
    },
    notifyUserCameraGesture(region) {
      if (!disposed) {
        camera.notifyUserGesture(region);
      }
    },
    resetCamera() {
      if (!disposed) {
        camera.reset();
      }
    },
    upsertPolyline(polyline) {
      if (!disposed) {
        provider.upsertPolyline(polyline);
      }
    },
    removePolyline(polylineId) {
      if (!disposed) {
        provider.removePolyline(polylineId);
      }
    },
    clearPolylines() {
      if (!disposed) {
        provider.clearPolylines();
      }
    },
    upsertAnnotation(annotation) {
      if (!disposed) {
        provider.upsertAnnotation(annotation);
      }
    },
    removeAnnotation(annotationId) {
      if (!disposed) {
        provider.removeAnnotation(annotationId);
      }
    },
    clearAnnotations() {
      if (!disposed) {
        provider.clearAnnotations();
      }
    },
    getState: () => readState(),
    subscribe(listener) {
      return provider.subscribe(listener);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      camera.dispose();
      provider.dispose();
    },
  };
}
