import type {
  BackgroundLocationStartOptions,
  BackgroundLocationState,
} from "./backgroundLocation";
import type { LocationBufferSnapshot } from "./persistentBuffer";
import type {
  LocationSamplingConfig,
  SamplingPolicyContext,
} from "./samplingPolicy";

export * from "./persistentBuffer";
export * from "./sampleGate";
export * from "./samplingPolicy";

export type LocationPermissionState =
  "NOT_REQUESTED" | "GRANTED" | "DENIED" | "BLOCKED" | "LIMITED" | "RESTRICTED";

export type LocationState =
  | "UNAVAILABLE"
  | "PERMISSION_REQUIRED"
  | "PERMISSION_DENIED"
  | "PERMISSION_BLOCKED"
  | "PERMISSION_LIMITED"
  | "REQUESTED"
  | "AUTHORIZED"
  | "READY"
  | "TRACKING"
  | "PAUSED_BY_USER"
  | "STALE"
  | "RECOVERING"
  | "GPS_UNAVAILABLE"
  | "LOW_ACCURACY"
  | "OFFLINE"
  | "OFFLINE_BUFFERING"
  | "SYNCING"
  | "SUSPENDED"
  | "ERROR";

export type RealtimeState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "STALE"
  | "ERROR";

export type ConnectionState = RealtimeState;

export type LocationSource = "gps" | "network" | "fused" | "mock" | "unknown";

export type LocationSample = {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number;
  speed?: number;
  heading?: number;
  source?: LocationSource;
};

export const DEFAULT_LOCATION_STALE_THRESHOLD_MS = 30_000;

export type LocationPermissionInput =
  | "not_requested"
  | "granted"
  | "denied"
  | "blocked"
  | "restricted"
  | "limited"
  | "unknown"
  | undefined
  | null;

export type LocationAppState =
  "foreground" | "background" | "inactive" | "unknown";

export type LocationAccuracyQuality = "GOOD" | "LOW" | "UNKNOWN";

export type LocationPublisherState = "IDLE" | "ONLINE" | "OFFLINE" | "FAILED";

export type LocationStatus = {
  permission: LocationPermissionState;
  tracking: LocationState;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  accuracy?: LocationAccuracyQuality;
  gpsAvailable?: boolean;
  appState?: LocationAppState;
  lastSampleAt?: number | null;
  buffer?: LocationBufferSnapshot;
  publisherState?: LocationPublisherState;
  error?: string | null;
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
  refreshPermission?: () => Promise<LocationPermissionState>;
  requestPermission?: () => Promise<LocationPermissionState>;
  hasServicesEnabled?: () => Promise<boolean>;
  startTracking: (config?: LocationSamplingConfig) => Promise<void>;
  stopTracking: () => Promise<void>;
  getCurrentLocation: () => Promise<LocationSample | null>;
  subscribe: (
    listener: (location: LocationSample) => void,
    onError?: (error: Error) => void,
  ) => () => void;
  getTrackingState: () => LocationState;
  getErrorState: () => Error | null;
  getLatestSample?: () => LocationSample | null;
  getPendingLocationCount?: () => number;
  getPendingLocationState?: () => LocationBufferState;
  dispose?: () => void;
};

export type LocationSamplePublisher = {
  publish: (sample: LocationSample) => Promise<void>;
  isReachable?: () => boolean;
  getConnectionState?: () => ConnectionState;
};

export type LocationEngineStatus = {
  state: LocationState;
  permission: LocationPermissionState;
  gpsAvailable: boolean;
  updatesActive: boolean;
  pausedByUser: boolean;
  suspended: boolean;
  appState: LocationAppState;
  freshness: "FRESH" | "STALE" | "UNKNOWN";
  accuracy: LocationAccuracyQuality;
  lastSampleAt: number | null;
  lastAcceptedSample: LocationSample | null;
  buffer: LocationBufferSnapshot;
  publisherState: LocationPublisherState;
  connection: ConnectionState;
  error: string | null;
};

export type EngineBackgroundStatus = {
  supported: boolean;
  state: BackgroundLocationState;
  permission: LocationPermissionState;
  error: string | null;
  desired: boolean;
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
  getEngineStatus?: () => LocationEngineStatus;
  subscribeToEngineStatus?: (
    listener: (status: LocationEngineStatus) => void,
  ) => () => void;
  setPublisher?: (publisher: LocationSamplePublisher | null) => void;
  setContext?: (context: SamplingPolicyContext) => void;
  startBackgroundUpdates?: (
    options?: BackgroundLocationStartOptions,
  ) => Promise<EngineBackgroundStatus>;
  stopBackgroundUpdates?: () => Promise<EngineBackgroundStatus>;
  getBackgroundStatus?: () => EngineBackgroundStatus;
  pauseTracking?: () => Promise<void>;
  resumeTracking?: () => Promise<void>;
  refresh?: () => Promise<LocationEngineStatus>;
  flush?: () => Promise<void>;
  dispose?: () => void;
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
  /**
   * Opens a context for the caller. `participants` lists additional rider ids
   * the caller is authorised to grant (the ride owner grants the roster); the
   * caller is always included.
   */
  authorizeContext?: (
    contextId: string,
    participants?: string[],
  ) => Promise<void>;
  /**
   * Revokes access to a context. Omitted `participants` revokes the caller
   * only; an explicit list revokes exactly that set (the caller is not added
   * implicitly, so an owner can remove someone without losing their own read).
   */
  revokeContext?: (
    contextId: string,
    participants?: string[],
  ) => Promise<void>;
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
  permission: string | null | undefined,
): LocationPermissionState {
  switch (permission?.toLowerCase?.() ?? "unknown") {
    case "granted":
      return "GRANTED";
    case "denied":
      return "DENIED";
    case "blocked":
      return "BLOCKED";
    case "restricted":
      return "RESTRICTED";
    case "limited":
      return "LIMITED";
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
    source: input.source,
  };
}

export function isLocationStale(
  location: LocationSample,
  staleThresholdMs = DEFAULT_LOCATION_STALE_THRESHOLD_MS,
): boolean {
  return Date.now() - location.timestamp > staleThresholdMs;
}

export type LocationStateSignals = {
  requested?: boolean;
  authorized?: boolean;
  gpsAvailable?: boolean;
  pausedByUser?: boolean;
  suspended?: boolean;
  recovering?: boolean;
  syncing?: boolean;
  buffering?: boolean;
  lowAccuracy?: boolean;
  awaitingFirstSample?: boolean;
};

export function isLocationPermissionUsable(
  permission: LocationPermissionState,
): boolean {
  return permission === "GRANTED" || permission === "LIMITED";
}

export function transitionLocationState(
  previousState: LocationState,
  permissionState: LocationPermissionState,
  hasLocation: boolean,
  isOffline: boolean,
  stale = false,
  signals: LocationStateSignals = {},
): LocationState {
  if (permissionState === "BLOCKED") {
    return "PERMISSION_BLOCKED";
  }

  if (permissionState === "DENIED") {
    return "PERMISSION_DENIED";
  }

  if (permissionState === "NOT_REQUESTED") {
    return signals.requested ? "REQUESTED" : "PERMISSION_REQUIRED";
  }

  if (permissionState === "RESTRICTED") {
    return "PERMISSION_REQUIRED";
  }

  if (signals.pausedByUser) {
    return "PAUSED_BY_USER";
  }

  if (signals.suspended) {
    return "SUSPENDED";
  }

  if (signals.gpsAvailable === false) {
    return "GPS_UNAVAILABLE";
  }

  if (signals.syncing) {
    return "SYNCING";
  }

  if (isOffline) {
    return signals.buffering ? "OFFLINE_BUFFERING" : "OFFLINE";
  }

  if (signals.recovering) {
    return "RECOVERING";
  }

  if (permissionState === "LIMITED") {
    if (signals.awaitingFirstSample || !hasLocation) {
      return "PERMISSION_LIMITED";
    }

    if (stale) {
      return "STALE";
    }

    if (signals.lowAccuracy) {
      return "LOW_ACCURACY";
    }

    return previousState === "TRACKING" ? "TRACKING" : "PERMISSION_LIMITED";
  }

  if (permissionState === "GRANTED") {
    if (signals.awaitingFirstSample) {
      return "AUTHORIZED";
    }

    if (!hasLocation) {
      return previousState === "TRACKING" ? "STALE" : "UNAVAILABLE";
    }

    if (stale) {
      return "STALE";
    }

    if (signals.lowAccuracy) {
      return "LOW_ACCURACY";
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
  setPermission?: (value: LocationPermissionState) => void;
  setServicesEnabled?: (value: boolean) => void;
} {
  const listeners = new Set<(location: LocationSample) => void>();
  const queue = createLocationSampleQueue();
  let permissionStateValue: LocationPermissionState = "GRANTED";
  let trackingStateValue: LocationState = "READY";
  let errorValue: Error | null = null;
  let servicesEnabled = true;
  let latestSample: LocationSample | null = null;

  const service: LocationService & {
    publish: (location: LocationSample) => void;
    setPermission: (value: LocationPermissionState) => void;
    setServicesEnabled: (value: boolean) => void;
  } = {
    async permissionState() {
      return permissionStateValue;
    },
    async refreshPermission() {
      return permissionStateValue;
    },
    async requestPermission() {
      if (permissionStateValue === "NOT_REQUESTED") {
        permissionStateValue = "GRANTED";
      }
      return permissionStateValue;
    },
    async hasServicesEnabled() {
      return servicesEnabled;
    },
    async startTracking() {
      trackingStateValue = servicesEnabled ? "TRACKING" : "GPS_UNAVAILABLE";
      errorValue = null;
    },
    async stopTracking() {
      trackingStateValue = "READY";
    },
    async getCurrentLocation() {
      const sample = createLocationSample({
        latitude: 40.7128,
        longitude: -74.006,
        timestamp: Date.now(),
        accuracy: 8,
        source: "mock",
      });
      latestSample = sample;
      return sample;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getTrackingState() {
      return trackingStateValue;
    },
    getErrorState() {
      return errorValue;
    },
    getLatestSample() {
      return latestSample;
    },
    getPendingLocationCount() {
      return queue.pendingCount();
    },
    getPendingLocationState() {
      return queue.state();
    },
    publish(location) {
      queue.enqueue(location);
      latestSample = location;
      listeners.forEach((listener) => listener(location));
    },
    setPermission(value) {
      permissionStateValue = value;
    },
    setServicesEnabled(value) {
      servicesEnabled = value;
    },
  };

  return service;
}

type EngineBackedLocationService = LocationService &
  Partial<
    Pick<
      LocationController,
      | "getEngineStatus"
      | "subscribeToEngineStatus"
      | "setPublisher"
      | "setContext"
      | "startBackgroundUpdates"
      | "stopBackgroundUpdates"
      | "getBackgroundStatus"
      | "pauseTracking"
      | "resumeTracking"
      | "refresh"
      | "flush"
      | "dispose"
    >
  >;

export function createLocationController(
  service: LocationService,
): LocationController {
  const locationListeners = new Set<(location: LocationSample) => void>();
  const statusListeners = new Set<(status: LocationStatus) => void>();
  const engine = service as EngineBackedLocationService;
  let lastSample: LocationSample | null = service.getLatestSample?.() ?? null;
  let status: LocationStatus = {
    permission: "NOT_REQUESTED",
    tracking: "UNAVAILABLE",
    freshness: "UNKNOWN",
  };

  const emitStatus = () => {
    statusListeners.forEach((listener) => listener(status));
  };

  const syncFromEngine = (): boolean => {
    const engineStatus = engine.getEngineStatus?.();
    if (!engineStatus) {
      return false;
    }

    lastSample = engineStatus.lastAcceptedSample;
    status = {
      permission: engineStatus.permission,
      tracking: engineStatus.state,
      freshness: engineStatus.freshness,
      accuracy: engineStatus.accuracy,
      gpsAvailable: engineStatus.gpsAvailable,
      appState: engineStatus.appState,
      lastSampleAt: engineStatus.lastSampleAt,
      buffer: engineStatus.buffer,
      publisherState: engineStatus.publisherState,
      error: engineStatus.error,
    };
    return true;
  };

  const refreshStatus = () => {
    if (syncFromEngine()) {
      emitStatus();
      return;
    }

    const freshness = lastSample
      ? isLocationStale(lastSample, DEFAULT_LOCATION_STALE_THRESHOLD_MS)
        ? "STALE"
        : "FRESH"
      : "UNKNOWN";

    status = {
      ...status,
      tracking: service.getTrackingState(),
      freshness,
      lastSampleAt: lastSample?.timestamp ?? null,
    };
    emitStatus();
  };

  service.subscribe((location) => {
    lastSample = location;
    locationListeners.forEach((listener) => listener(location));
    refreshStatus();
  });

  engine.subscribeToEngineStatus?.(() => {
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
      if (!syncFromEngine()) {
        status.tracking = service.getTrackingState();
      }
      emitStatus();
    },
    async stopTracking() {
      await service.stopTracking();
      if (!syncFromEngine()) {
        status.tracking = service.getTrackingState();
      }
      emitStatus();
    },
    subscribeToLocationChanges(listener) {
      locationListeners.add(listener);
      return () => {
        locationListeners.delete(listener);
      };
    },
    subscribeToStatusChanges(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    getEngineStatus: engine.getEngineStatus?.bind(engine),
    subscribeToEngineStatus: engine.subscribeToEngineStatus?.bind(engine),
    setPublisher: engine.setPublisher?.bind(engine),
    setContext: engine.setContext?.bind(engine),
    startBackgroundUpdates: engine.startBackgroundUpdates?.bind(engine),
    stopBackgroundUpdates: engine.stopBackgroundUpdates?.bind(engine),
    getBackgroundStatus: engine.getBackgroundStatus?.bind(engine),
    pauseTracking: engine.pauseTracking?.bind(engine),
    resumeTracking: engine.resumeTracking?.bind(engine),
    refresh: engine.refresh?.bind(engine),
    flush: engine.flush?.bind(engine),
    dispose() {
      engine.dispose?.();
    },
  };
}
