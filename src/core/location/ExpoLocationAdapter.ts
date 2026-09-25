import * as ExpoLocation from "expo-location";
import { normalizeLocationPermission } from "./index";
import type {
  LocationBufferState,
  LocationPermissionState,
  LocationSample,
  LocationService,
  LocationSource,
  LocationState,
} from "./index";
import {
  DEFAULT_LOCATION_SAMPLING_CONFIG,
  type LocationSamplingConfig,
} from "./samplingPolicy";

type ExpoLocationPermissionResult =
  "granted" | "denied" | "restricted" | "limited" | "undetermined" | "unknown";

type ExpoPermissionResponse = {
  status: ExpoLocationPermissionResult;
  canAskAgain?: boolean;
  accuracyAuthorization?: "full" | "reduced";
};

type ExpoPosition = ExpoLocation.LocationObject;

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

export type ExpoLocationAdapterOptions = {
  staleThresholdMs?: number;
  defaultConfig?: Partial<LocationSamplingConfig>;
};

export class ExpoLocationAdapter implements LocationService {
  private permission: LocationPermissionState = "NOT_REQUESTED";
  private trackingState: LocationState = "UNAVAILABLE";
  private errorMessage: string | null = null;
  private listeners = new Set<(location: LocationSample) => void>();
  private errorListeners = new Set<(error: Error) => void>();
  private subscription: { remove: () => void } | null = null;
  private latestSample: LocationSample | null = null;
  private readonly defaultConfig: LocationSamplingConfig;

  constructor(options: ExpoLocationAdapterOptions = {}) {
    this.defaultConfig = {
      ...DEFAULT_LOCATION_SAMPLING_CONFIG,
      ...options.defaultConfig,
    };
  }

  async permissionState(): Promise<LocationPermissionState> {
    const status = await ExpoLocation.getForegroundPermissionsAsync();
    this.permission = this.normalizePermission(
      status as unknown as ExpoPermissionResponse,
    );
    return this.permission;
  }

  async refreshPermission(): Promise<LocationPermissionState> {
    return this.permissionState();
  }

  async requestPermission(): Promise<LocationPermissionState> {
    const status = await ExpoLocation.requestForegroundPermissionsAsync();
    this.permission = this.normalizePermission(
      status as unknown as ExpoPermissionResponse,
    );
    return this.permission;
  }

  async hasServicesEnabled(): Promise<boolean> {
    try {
      return await ExpoLocation.hasServicesEnabledAsync();
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : "GPS availability unknown";
      return false;
    }
  }

  async startTracking(
    config: LocationSamplingConfig = this.defaultConfig,
  ): Promise<void> {
    if (this.permission !== "GRANTED" && this.permission !== "LIMITED") {
      const permissionStatus = await this.requestPermission();
      if (permissionStatus !== "GRANTED" && permissionStatus !== "LIMITED") {
        this.trackingState =
          permissionStatus === "BLOCKED"
            ? "PERMISSION_BLOCKED"
            : "PERMISSION_DENIED";
        return;
      }
    }

    await this.stopTracking();

    this.trackingState = "TRACKING";
    this.errorMessage = null;

    try {
      this.subscription = await ExpoLocation.watchPositionAsync(
        {
          accuracy: resolveAccuracy(config.accuracy),
          timeInterval: config.timeIntervalMs,
          distanceInterval: config.distanceIntervalMeters,
        },
        (position) => {
          const sample = this.normalizePosition(position as ExpoPosition);
          this.latestSample = sample;
          this.listeners.forEach((listener) => listener(sample));
        },
      );
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : "Location watch failed";
      this.trackingState = "ERROR";
      const failure = new Error(this.errorMessage);
      this.errorListeners.forEach((listener) => listener(failure));
      throw failure;
    }
  }

  async stopTracking(): Promise<void> {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }

    this.trackingState = "READY";
  }

  async getCurrentLocation(): Promise<LocationSample | null> {
    const permissionStatus = await this.permissionState();
    if (permissionStatus !== "GRANTED" && permissionStatus !== "LIMITED") {
      return null;
    }

    try {
      const result = await ExpoLocation.getCurrentPositionAsync({
        accuracy: resolveAccuracy(this.defaultConfig.accuracy),
      });
      const sample = this.normalizePosition(result as ExpoPosition);
      this.latestSample = sample;
      return sample;
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : "Location request failed";
      return null;
    }
  }

  subscribe(
    listener: (location: LocationSample) => void,
    onError?: (error: Error) => void,
  ): () => void {
    this.listeners.add(listener);
    if (onError) {
      this.errorListeners.add(onError);
    }
    return () => {
      this.listeners.delete(listener);
      if (onError) {
        this.errorListeners.delete(onError);
      }
    };
  }

  getTrackingState(): LocationState {
    return this.trackingState;
  }

  getErrorState(): Error | null {
    return this.errorMessage ? new Error(this.errorMessage) : null;
  }

  getLatestSample(): LocationSample | null {
    return this.latestSample;
  }

  getPendingLocationCount(): number {
    return 0;
  }

  getPendingLocationState(): LocationBufferState {
    return "EMPTY";
  }

  dispose(): void {
    void this.stopTracking();
    this.listeners.clear();
    this.errorListeners.clear();
  }

  private normalizePermission(
    response: ExpoPermissionResponse,
  ): LocationPermissionState {
    const normalized = normalizeLocationPermission(response.status);

    if (
      normalized === "GRANTED" &&
      response.accuracyAuthorization === "reduced"
    ) {
      return "LIMITED";
    }

    if (normalized === "DENIED" && response.canAskAgain === false) {
      return "BLOCKED";
    }

    return normalized;
  }

  private normalizePosition(position: ExpoPosition): LocationSample {
    const coords = position.coords as ExpoLocation.LocationObjectCoords & {
      mocked?: boolean;
    };
    const source: LocationSource = coords.mocked
      ? "mock"
      : typeof coords.accuracy === "number" && coords.accuracy < 20
        ? "gps"
        : "fused";

    return {
      latitude: coords.latitude,
      longitude: coords.longitude,
      timestamp: position.timestamp,
      accuracy: coords.accuracy ?? 0,
      speed: coords.speed ?? undefined,
      heading: coords.heading ?? undefined,
      source,
    };
  }
}

export const PLATFORM_VALIDATION_REQUIRED = "PLATFORM VALIDATION REQUIRED";

export const backgroundLocationTaskName = "background-location-task";
