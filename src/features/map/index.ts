import type { LocationSample } from "../../core/location";

type NativeMapMarker = {
  coordinate: { latitude: number; longitude: number };
  title?: string;
  description?: string;
};

type NativeMapPolyline = {
  coordinates: { latitude: number; longitude: number }[];
};

type NativeMapView = {
  setCamera?: (camera: {
    center: { latitude: number; longitude: number };
    zoom?: number;
  }) => void;
  animateToRegion?: (region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  }) => void;
  fitToCoordinates?: (
    coordinates: { latitude: number; longitude: number }[],
    options?: unknown,
  ) => void;
};

export type MapCameraOptions = {
  animate?: boolean;
  zoom?: number;
};

export type MapProvider = {
  renderMarker: (location: LocationSample, id?: string) => void;
  renderPath: (points: LocationSample[]) => void;
  setCamera: (location: LocationSample, options?: MapCameraOptions) => void;
  followLocation: (enabled: boolean) => void;
  updateLocation: (location: LocationSample) => void;
};

export type MapState = {
  currentLocation: LocationSample | null;
  following: boolean;
  markers: { id: string; location: LocationSample }[];
  path: LocationSample[];
};

export function createMockMapProvider(): MapProvider & {
  getState: () => MapState;
} {
  const state: MapState = {
    currentLocation: null,
    following: false,
    markers: [],
    path: [],
  };

  return {
    renderMarker(location, id = "default-marker") {
      state.markers = [{ id, location }];
    },
    renderPath(points) {
      state.path = points;
    },
    setCamera(location, _options) {
      state.currentLocation = location;
    },
    followLocation(enabled) {
      state.following = enabled;
    },
    updateLocation(location) {
      state.currentLocation = location;
      state.path = [...state.path, location];
    },
    getState() {
      return state;
    },
  };
}

export function createRealMapProvider(
  mapRef?: NativeMapView,
): MapProvider & { getState: () => MapState } {
  const state: MapState = {
    currentLocation: null,
    following: false,
    markers: [],
    path: [],
  };

  const setCamera = (
    location: LocationSample,
    options: MapCameraOptions = {},
  ) => {
    state.currentLocation = location;
    if (mapRef?.setCamera) {
      mapRef.setCamera({
        center: { latitude: location.latitude, longitude: location.longitude },
        zoom: options.zoom,
      });
    }
  };

  return {
    renderMarker(location, id = "default-marker") {
      state.markers = [{ id, location }];
      if (mapRef) {
        const marker: NativeMapMarker = {
          coordinate: {
            latitude: location.latitude,
            longitude: location.longitude,
          },
          title: id,
        };
        void marker;
      }
    },
    renderPath(points) {
      state.path = points;
      if (mapRef) {
        const polyline: NativeMapPolyline = {
          coordinates: points.map((point) => ({
            latitude: point.latitude,
            longitude: point.longitude,
          })),
        };
        void polyline;
      }
    },
    setCamera,
    followLocation(enabled) {
      state.following = enabled;
    },
    updateLocation(location) {
      state.currentLocation = location;
      state.path = [...state.path, location];
      if (mapRef?.animateToRegion) {
        mapRef.animateToRegion({
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        });
      }
    },
    getState() {
      return state;
    },
  };
}

export const PLATFORM_VALIDATION_REQUIRED = "PLATFORM VALIDATION REQUIRED";
