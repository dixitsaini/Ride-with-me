export type LocationPermissionState =
  "NOT_REQUESTED" | "GRANTED" | "DENIED" | "RESTRICTED";

export type LocationState =
  | "UNAVAILABLE"
  | "PERMISSION_REQUIRED"
  | "PERMISSION_DENIED"
  | "READY"
  | "TRACKING"
  | "STALE"
  | "OFFLINE"
  | "SYNCING"
  | "ERROR";

export type RealtimeState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "STALE"
  | "ERROR";

export type ConnectionState = RealtimeState;

export type LocationSample = {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number;
  speed?: number;
  heading?: number;
};

export const DEFAULT_LOCATION_STALE_THRESHOLD_MS = 30_000;

export type LocationPermissionInput =
  | "not_requested"
  | "granted"
  | "denied"
  | "restricted"
  | "limited"
  | "unknown"
  | undefined
  | null;

export type LocationStatus = {
  permission: LocationPermissionState;
  tracking: LocationState;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
};

export type ConnectionStatus = {
  disconnected: boolean;
  connecting: boolean;
  connected: boolean;
  reconnecting: boolean;
  error: Error | null;
};

export type SyncStatus = "IDLE" | "PENDING" | "SYNCING" | "FAILED";

export type LocationService = {
  permissionState: () => Promise<LocationPermissionState>;
  requestPermission?: () => Promise<LocationPermissionState>;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  getCurrentLocation: () => Promise<LocationSample | null>;
  subscribe: (listener: (location: LocationSample) => void) => () => void;
  getTrackingState: () => LocationState;
  getErrorState: () => Error | null;
  getPendingLocationCount: () => number;
  getPendingLocationState: () => LocationBufferState;
};

export type LocationController = {
  getCurrentLocation: () => Promise<LocationSample | null>;
  getPermissionState: () => Promise<LocationPermissionState>;
  getStatus: () => LocationStatus;
  requestPermission: () => Promise<LocationPermissionState>;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  subscribeToLocationChanges: (
    listener: (location: LocationSample) => void,
  ) => () => void;
  subscribeToStatusChanges: (
    listener: (status: LocationStatus) => void,
  ) => () => void;
};

export type RealtimeLocationUpdate = {
  contextId: string;
  userId: string;
  location: LocationSample;
  stale: boolean;
};

export type RealtimeLocationService = {
  publish: (contextId: string, location: LocationSample) => Promise<void>;
  subscribe: (
    contextId: string,
    listener: (update: RealtimeLocationUpdate) => void,
  ) => () => void;
  authorizeContext?: (contextId: string) => Promise<void>;
  revokeContext?: (contextId: string) => Promise<void>;
  connect: () => void;
  disconnect: () => void;
  reconnect: () => void;
  getConnectionState: () => ConnectionState;
};

export type LocationBufferState = "EMPTY" | "PENDING" | "SYNCING" | "ERROR";

export type LocationSampleQueue = {
  enqueue: (sample: LocationSample) => number;
  dequeue: () => LocationSample | undefined;
  peek: () => LocationSample | undefined;
  pendingCount: () => number;
  clear: () => void;
  state: () => LocationBufferState;
};

export type MapLocationController = {
  setLocation: (sample: LocationSample) => void;
  getCurrentLocation: () => LocationSample | null;
  isFollowing: () => boolean;
  setFollowing: (value: boolean) => void;
};

export function normalizeLocationPermission(
  permission: LocationPermissionInput,
): LocationPermissionState {
  switch (permission?.toLowerCase?.() ?? "unknown") {
    case "granted":
      return "GRANTED";
    case "denied":
      return "DENIED";
    case "restricted":
    case "limited":
      return "RESTRICTED";
    case "not_requested":
      return "NOT_REQUESTED";
    default:
      return "NOT_REQUESTED";
  }
}

export function getLocationPermissionState(
  permission: string | undefined,
): LocationPermissionState {
  return normalizeLocationPermission(permission as LocationPermissionInput);
}

export function createLocationSample(
  input: Partial<LocationSample> & {
    latitude: number;
    longitude: number;
    timestamp: number;
    accuracy: number;
  },
): LocationSample {
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    timestamp: input.timestamp,
    accuracy: input.accuracy,
    speed: input.speed,
    heading: input.heading,
  };
}

export function isLocationStale(
  location: LocationSample,
  staleThresholdMs = DEFAULT_LOCATION_STALE_THRESHOLD_MS,
): boolean {
  return Date.now() - location.timestamp > staleThresholdMs;
}

export function transitionLocationState(
  previousState: LocationState,
  permissionState: LocationPermissionState,
  hasLocation: boolean,
  isOffline: boolean,
  stale = false,
): LocationState {
  if (isOffline) {
    return "OFFLINE";
  }

  if (permissionState === "DENIED") {
    return "PERMISSION_DENIED";
  }

  if (permissionState === "RESTRICTED") {
    return "PERMISSION_REQUIRED";
  }

  if (permissionState === "NOT_REQUESTED") {
    return "PERMISSION_REQUIRED";
  }

  if (permissionState === "GRANTED") {
    if (!hasLocation) {
      return "UNAVAILABLE";
    }

    if (stale) {
      return "STALE";
    }

    return previousState === "TRACKING" ? "TRACKING" : "READY";
  }

  return previousState;
}

export function createLocationSampleQueue(): LocationSampleQueue {
  const queue: LocationSample[] = [];
  const seen = new Set<string>();

  const dedupeKey = (sample: LocationSample) =>
    `${sample.latitude.toFixed(6)}:${sample.longitude.toFixed(6)}:${sample.timestamp}:${sample.accuracy}`;

  return {
    enqueue(sample) {
      const key = dedupeKey(sample);

      if (seen.has(key)) {
        return queue.length;
      }

      seen.add(key);
      queue.push(sample);
      return queue.length;
    },
    dequeue() {
      const next = queue.shift();
      if (next) {
        seen.delete(dedupeKey(next));
      }
      return next;
    },
    peek() {
      return queue[0];
    },
    pendingCount() {
      return queue.length;
    },
    clear() {
      queue.length = 0;
      seen.clear();
    },
    state() {
      if (queue.length === 0) {
        return "EMPTY";
      }

      return "PENDING";
    },
  };
}

export function createMockLocationStream(
  userId = "mock-user",
): RealtimeLocationService & {
  markStale: () => void;
} {
  const listeners = new Map<
    string,
    Set<(update: RealtimeLocationUpdate) => void>
  >();
  let currentConnectionState: ConnectionState = "DISCONNECTED";
  let stale = false;

  return {
    async authorizeContext() {
      return undefined;
    },
    async revokeContext() {
      return undefined;
    },
    async publish(contextId, location) {
      listeners
        .get(contextId)
        ?.forEach((listener) =>
          listener({ contextId, userId, location, stale }),
        );
    },
    subscribe(contextId, listener) {
      const contextListeners = listeners.get(contextId) ?? new Set();
      contextListeners.add(listener);
      listeners.set(contextId, contextListeners);
      return () => {
        contextListeners.delete(listener);
        if (contextListeners.size === 0) {
          listeners.delete(contextId);
        }
      };
    },
    connect() {
      currentConnectionState = "CONNECTED";
      stale = false;
    },
    disconnect() {
      currentConnectionState = "DISCONNECTED";
    },
    reconnect() {
      currentConnectionState = "CONNECTED";
      stale = false;
    },
    markStale() {
      stale = true;
      currentConnectionState = "STALE";
    },
    getConnectionState() {
      return currentConnectionState;
    },
  };
}

export function createMapLocationController(): MapLocationController {
  let currentLocation: LocationSample | null = null;
  let isFollowMode = false;

  return {
    setLocation(sample) {
      currentLocation = sample;
    },
    getCurrentLocation() {
      return currentLocation;
    },
    isFollowing() {
      return isFollowMode;
    },
    setFollowing(value) {
      isFollowMode = value;
    },
  };
}

export function createMockLocationService(): LocationService & {
  publish: (location: LocationSample) => void;
} {
  const listeners = new Set<(location: LocationSample) => void>();
  const queue = createLocationSampleQueue();
  let permissionStateValue: LocationPermissionState = "GRANTED";
  let trackingStateValue: LocationState = "READY";
  let errorValue: Error | null = null;

  return {
    async permissionState() {
      return permissionStateValue;
    },
    async requestPermission() {
      permissionStateValue = "GRANTED";
      return permissionStateValue;
    },
    async startTracking() {
      trackingStateValue = "TRACKING";
      errorValue = null;
    },
    async stopTracking() {
      trackingStateValue = "READY";
    },
    async getCurrentLocation() {
      return createLocationSample({
        latitude: 40.7128,
        longitude: -74.006,
        timestamp: Date.now(),
        accuracy: 8,
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getTrackingState() {
      return trackingStateValue;
    },
    getErrorState() {
      return errorValue;
    },
    getPendingLocationCount() {
      return queue.pendingCount();
    },
    getPendingLocationState() {
      return queue.state();
    },
    publish(location) {
      queue.enqueue(location);
      listeners.forEach((listener) => listener(location));
    },
  };
}

export function createLocationController(
  service: LocationService,
): LocationController {
  const locationListeners = new Set<(location: LocationSample) => void>();
  const statusListeners = new Set<(status: LocationStatus) => void>();
  let status: LocationStatus = {
    permission: "NOT_REQUESTED",
    tracking: "UNAVAILABLE",
    freshness: "UNKNOWN",
  };

  const emitStatus = () => {
    statusListeners.forEach((listener) => listener(status));
  };

  const refreshStatus = () => {
    const tracking = service.getTrackingState();
    const freshness = isLocationStale(
      createLocationSample({
        latitude: 0,
        longitude: 0,
        timestamp: Date.now() - 10000,
        accuracy: 1,
      }),
      30000,
    )
      ? "STALE"
      : "FRESH";

    status = {
      permission: status.permission,
      tracking,
      freshness,
    };
    emitStatus();
  };

  service.subscribe((location) => {
    locationListeners.forEach((listener) => listener(location));
    refreshStatus();
  });

  return {
    async getCurrentLocation() {
      return service.getCurrentLocation();
    },
    async getPermissionState() {
      const permission = await service.permissionState();
      status.permission = permission;
      emitStatus();
      return permission;
    },
    getStatus() {
      return status;
    },
    async requestPermission() {
      const permission = (
        service.requestPermission ?? service.permissionState
      )();
      status.permission = await permission;
      emitStatus();
      return status.permission;
    },
    async startTracking() {
      await service.startTracking();
      status.permission = await service.permissionState();
      status.tracking = service.getTrackingState();
      emitStatus();
    },
    async stopTracking() {
      await service.stopTracking();
      status.tracking = service.getTrackingState();
      emitStatus();
    },
    subscribeToLocationChanges(listener) {
      locationListeners.add(listener);
      return () => locationListeners.delete(listener);
    },
    subscribeToStatusChanges(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
  };
}
