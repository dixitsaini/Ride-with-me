import * as ExpoLocation from "expo-location";
import { Platform } from "react-native";
import { createLogger } from "../logger";
import { pushBackgroundLocation } from "./backgroundSink";
import {
  isLocationPermissionUsable,
  normalizeLocationPermission,
  type LocationPermissionState,
  type LocationSample,
} from "./index";
import {
  DEFAULT_LOCATION_SAMPLING_CONFIG,
  type LocationSamplingConfig,
} from "./samplingPolicy";

const log = createLogger("location.background");

export const BACKGROUND_LOCATION_TASK = "background-location-task";

export const PLATFORM_VALIDATION_REQUIRED = "PLATFORM VALIDATION REQUIRED";

export const BACKGROUND_LOCATION_PLATFORM_REQUIREMENTS = {
  ios: PLATFORM_VALIDATION_REQUIRED,
  android: PLATFORM_VALIDATION_REQUIRED,
  lifecycle: PLATFORM_VALIDATION_REQUIRED,
  terminatedApp: PLATFORM_VALIDATION_REQUIRED,
};

type BackgroundLocationPayload = {
  locations?: {
    coords?: {
      latitude?: number;
      longitude?: number;
      accuracy?: number | null;
      speed?: number | null;
      heading?: number | null;
      mocked?: boolean;
    };
    timestamp?: number;
  }[];
};

function toBackgroundSample(
  payload: BackgroundLocationPayload | undefined,
): LocationSample | null {
  const location = payload?.locations?.[0];
  const coords = location?.coords;
  if (!coords || typeof location?.timestamp !== "number") {
    return null;
  }
  if (
    typeof coords.latitude !== "number" ||
    typeof coords.longitude !== "number"
  ) {
    return null;
  }

  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    timestamp: location.timestamp,
    accuracy: coords.accuracy ?? 0,
    ...(typeof coords.speed === "number" ? { speed: coords.speed } : {}),
    ...(typeof coords.heading === "number" ? { heading: coords.heading } : {}),
    source: coords.mocked ? "mock" : "gps",
  };
}

export async function handleBackgroundLocationEvent({
  data,
  error,
}: {
  data?: unknown;
  error?: { message?: string } | null;
}): Promise<void> {
  if (error) {
    log.warn("background location update failed", { message: error.message });
    return;
  }

  const sample = toBackgroundSample(
    data as BackgroundLocationPayload | undefined,
  );
  if (!sample) {
    return;
  }

  const delivered = pushBackgroundLocation(sample);
  if (delivered === 0) {
    log.debug("background sample dropped: no tracking session is listening", {
      source: sample.source,
    });
  }
}

export type BackgroundLocationState =
  | "UNSUPPORTED"
  | "STOPPED"
  | "STARTING"
  | "RUNNING"
  | "UNAVAILABLE"
  | "NOT_AUTHORIZED"
  | "ERROR";

export type BackgroundLocationStartOptions = {
  requestPermission?: boolean;
};

export type BackgroundLocationStatus = {
  supported: boolean;
  state: BackgroundLocationState;
  permission: LocationPermissionState;
  error: string | null;
};

export type BackgroundLocationService = {
  isSupported: () => boolean;
  status: () => BackgroundLocationState;
  permissionState: () => Promise<LocationPermissionState>;
  requestPermission: () => Promise<LocationPermissionState>;
  start: (
    options?: BackgroundLocationStartOptions,
  ) => Promise<BackgroundLocationState>;
  stop: () => Promise<void>;
  getError: () => string | null;
};

export type BackgroundLocationConfig = {
  taskName?: string;
  accuracy?: LocationSamplingConfig["accuracy"];
  timeIntervalMs?: number;
  distanceIntervalMeters?: number;
  notificationTitle?: string;
  notificationBody?: string;
};

const ACCURACY_KEYS: Record<LocationSamplingConfig["accuracy"], string> = {
  lowest: "Lowest",
  low: "Low",
  balanced: "Balanced",
  high: "High",
  highest: "Highest",
};

function resolveAccuracy(accuracy: LocationSamplingConfig["accuracy"]): number {
  const table = ExpoLocation.Accuracy as unknown as Record<
    string,
    number | undefined
  >;
  return table[ACCURACY_KEYS[accuracy]] ?? table.Balanced ?? 3;
}

function isExpoBackgroundAvailable(): boolean {
  return (
    typeof ExpoLocation.startLocationUpdatesAsync === "function" &&
    typeof ExpoLocation.stopLocationUpdatesAsync === "function"
  );
}

export function createUnsupportedBackgroundLocationService(
  reason = "Background location is unavailable in this environment.",
): BackgroundLocationService {
  return {
    isSupported: () => false,
    status: () => "UNSUPPORTED",
    permissionState: async () => "NOT_REQUESTED",
    requestPermission: async () => "NOT_REQUESTED",
    start: async () => "UNSUPPORTED",
    stop: async () => undefined,
    getError: () => reason,
  };
}

/**
 * Background location through the OS task manager.
 *
 * Android delivers updates through the foreground service that expo-location
 * starts when a `foregroundService` option is supplied, so it only needs
 * while-in-use permission. iOS can only hand updates to the task while the
 * app holds "Allow All the Time", so the background permission is what gates
 * it there.
 */
export function createExpoBackgroundLocationService(
  config: BackgroundLocationConfig = {},
): BackgroundLocationService {
  const taskName = config.taskName ?? BACKGROUND_LOCATION_TASK;
  const supported = isExpoBackgroundAvailable();

  let state: BackgroundLocationState = supported ? "STOPPED" : "UNSUPPORTED";
  let errorMessage: string | null = null;
  let pendingStart: Promise<BackgroundLocationState> | null = null;

  function setState(next: BackgroundLocationState) {
    if (state === next) {
      return;
    }
    const previous = state;
    state = next;
    log.info("background location state changed", { from: previous, to: next });
  }

  function setError(message: string | null) {
    if (errorMessage === message) {
      return;
    }
    errorMessage = message;
    if (message) {
      log.warn("background location error", { message });
    }
  }

  async function readPermission(
    scope: "whenInUse" | "always",
  ): Promise<LocationPermissionState> {
    try {
      const result =
        scope === "always"
          ? await ExpoLocation.getBackgroundPermissionsAsync()
          : await ExpoLocation.getForegroundPermissionsAsync();
      return normalizeLocationPermission(
        (result as unknown as { status?: string })?.status,
      );
    } catch {
      return "NOT_REQUESTED";
    }
  }

  async function resolvePermission(): Promise<LocationPermissionState> {
    const foreground = await readPermission("whenInUse");
    if (!isLocationPermissionUsable(foreground)) {
      return foreground;
    }
    if (Platform.OS === "android") {
      return foreground;
    }
    return readPermission("always");
  }

  async function doStart(
    options: BackgroundLocationStartOptions,
  ): Promise<BackgroundLocationState> {
    setState("STARTING");
    setError(null);

    if (options.requestPermission) {
      await requestPermission();
    }

    const permission = await resolvePermission();
    if (!isLocationPermissionUsable(permission)) {
      setError(null);
      setState("NOT_AUTHORIZED");
      return state;
    }

    let servicesEnabled = true;
    try {
      servicesEnabled = await ExpoLocation.hasServicesEnabledAsync();
    } catch (error) {
      servicesEnabled = false;
      setError(
        error instanceof Error ? error.message : "Location services unknown",
      );
    }
    if (!servicesEnabled) {
      if (!errorMessage) {
        setError("Location services are disabled on this device.");
      }
      setState("UNAVAILABLE");
      return state;
    }

    try {
      const alreadyStarted =
        (await ExpoLocation.hasStartedLocationUpdatesAsync?.(taskName)) ??
        false;
      if (!alreadyStarted) {
        await ExpoLocation.startLocationUpdatesAsync(taskName, {
          accuracy: resolveAccuracy(
            config.accuracy ?? DEFAULT_LOCATION_SAMPLING_CONFIG.accuracy,
          ),
          timeInterval:
            config.timeIntervalMs ??
            DEFAULT_LOCATION_SAMPLING_CONFIG.timeIntervalMs,
          distanceInterval:
            config.distanceIntervalMeters ??
            DEFAULT_LOCATION_SAMPLING_CONFIG.distanceIntervalMeters,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle:
              config.notificationTitle ?? "Rider App is sharing your location",
            notificationBody:
              config.notificationBody ??
              "Your ride is active. Location is shared with riders in your ride.",
          },
        });
      }
      setError(null);
      setState("RUNNING");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Starting background location failed",
      );
      setState("ERROR");
    }

    return state;
  }

  async function requestPermission(): Promise<LocationPermissionState> {
    try {
      const result =
        Platform.OS === "android"
          ? await ExpoLocation.requestForegroundPermissionsAsync()
          : await ExpoLocation.requestBackgroundPermissionsAsync();
      return normalizeLocationPermission(
        (result as unknown as { status?: string })?.status,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Requesting background location permission failed",
      );
      return "DENIED";
    }
  }

  return {
    isSupported: () => supported,
    status: () => state,
    permissionState: resolvePermission,
    getError: () => errorMessage,
    requestPermission,
    start(options = {}) {
      if (!supported) {
        return Promise.resolve(state);
      }
      if (state === "RUNNING") {
        return Promise.resolve(state);
      }
      if (pendingStart) {
        return pendingStart;
      }
      pendingStart = doStart(options).finally(() => {
        pendingStart = null;
      });
      return pendingStart;
    },
    async stop() {
      if (!supported) {
        setState("UNSUPPORTED");
        return;
      }
      if (pendingStart) {
        await pendingStart.catch(() => undefined);
      }
      try {
        const alreadyStarted =
          (await ExpoLocation.hasStartedLocationUpdatesAsync?.(taskName)) ??
          state === "RUNNING";
        if (alreadyStarted) {
          await ExpoLocation.stopLocationUpdatesAsync(taskName);
        }
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Stopping background location failed",
        );
      }
      setState("STOPPED");
    },
  };
}
