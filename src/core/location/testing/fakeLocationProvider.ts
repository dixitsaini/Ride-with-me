import {
  createLocationSample,
  type LocationBufferState,
  type LocationPermissionState,
  type LocationSample,
  type LocationService,
  type LocationSource,
  type LocationState,
} from "../index";
import type { LocationSamplingConfig } from "../samplingPolicy";

export type FakeLocationProvider = LocationService & {
  emit: (
    overrides?: Partial<LocationSample> & { source?: LocationSource },
  ) => LocationSample;
  emitError: (error: Error) => void;
  setPermission: (value: LocationPermissionState) => void;
  setServicesEnabled: (value: boolean) => void;
  grantOnRequest: (value: boolean) => void;
  watchConfig: () => LocationSamplingConfig | null;
  startCount: () => number;
  stopCount: () => number;
  subscriptionCount: () => number;
  liveSubscriptionCount: () => number;
  isWatching: () => boolean;
};

export type FakeLocationProviderOptions = {
  permission?: LocationPermissionState;
  servicesEnabled?: boolean;
  grantOnRequest?: boolean;
  failOnStart?: boolean;
  now?: () => number;
};

export function createFakeLocationProvider(
  options: FakeLocationProviderOptions = {},
): FakeLocationProvider {
  let permission: LocationPermissionState =
    options.permission ?? "NOT_REQUESTED";
  let servicesEnabled = options.servicesEnabled ?? true;
  let allowRequest = options.grantOnRequest ?? true;
  let failOnStart = options.failOnStart ?? false;
  let trackingState: LocationState = "UNAVAILABLE";
  let latest: LocationSample | null = null;
  let config: LocationSamplingConfig | null = null;
  let startCount = 0;
  let stopCount = 0;
  let subscriptionCount = 0;
  let watching = false;
  const now = options.now ?? Date.now;
  let emitted = 0;

  const listeners = new Set<(sample: LocationSample) => void>();
  const errorListeners = new Set<(error: Error) => void>();

  return {
    async permissionState() {
      return permission;
    },
    async refreshPermission() {
      return permission;
    },
    async requestPermission() {
      if (permission === "NOT_REQUESTED") {
        permission = allowRequest ? "GRANTED" : "DENIED";
      }
      return permission;
    },
    async hasServicesEnabled() {
      return servicesEnabled;
    },
    async startTracking(samplingConfig) {
      startCount += 1;
      config = samplingConfig ?? null;
      if (failOnStart) {
        trackingState = "ERROR";
        throw new Error("native watch unavailable");
      }
      if (!servicesEnabled) {
        trackingState = "GPS_UNAVAILABLE";
        return;
      }
      watching = true;
      trackingState = "TRACKING";
    },
    async stopTracking() {
      stopCount += 1;
      watching = false;
      trackingState = "READY";
    },
    async getCurrentLocation() {
      if (!latest) {
        latest = createLocationSample({
          latitude: 40.7128,
          longitude: -74.006,
          timestamp: now(),
          accuracy: 8,
          source: "gps",
        });
      }
      return latest;
    },
    subscribe(listener, onError) {
      subscriptionCount += 1;
      listeners.add(listener);
      if (onError) {
        errorListeners.add(onError);
      }
      return () => {
        listeners.delete(listener);
        if (onError) {
          errorListeners.delete(onError);
        }
      };
    },
    getTrackingState() {
      return trackingState;
    },
    getErrorState() {
      return null;
    },
    getLatestSample() {
      return latest;
    },
    getPendingLocationCount(): number {
      return 0;
    },
    getPendingLocationState(): LocationBufferState {
      return "EMPTY";
    },

    emit(overrides = {}) {
      emitted += 1;
      const sample = createLocationSample({
        latitude: 40.7128 + emitted * 0.0001,
        longitude: -74.006,
        timestamp: now() + emitted,
        accuracy: 8,
        source: "gps",
        ...overrides,
      });
      latest = sample;
      if (watching) {
        listeners.forEach((listener) => listener(sample));
      }
      return sample;
    },
    emitError(error) {
      errorListeners.forEach((listener) => listener(error));
    },
    setPermission(value) {
      permission = value;
    },
    setServicesEnabled(value) {
      servicesEnabled = value;
    },
    grantOnRequest(value) {
      allowRequest = value;
    },
    watchConfig: () => config,
    startCount: () => startCount,
    stopCount: () => stopCount,
    subscriptionCount: () => subscriptionCount,
    liveSubscriptionCount: () => listeners.size,
    isWatching: () => watching,
  };
}
