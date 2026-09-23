import * as Location from "expo-location";
import {
  createLocationSampleQueue,
  type LocationBufferState,
  type LocationSample,
  type LocationService,
  type LocationPermissionState,
  type LocationState,
} from "./index";

export type ExpoLocationPermissionResult =
  "granted" | "denied" | "restricted" | "limited" | "unknown";

export type ExpoLocationAdapterOptions = {
  staleThresholdMs?: number;
  queue?: ReturnType<typeof createLocationSampleQueue>;
};

export class ExpoLocationAdapter implements LocationService {
  private permission: LocationPermissionState = "NOT_REQUESTED";
  private trackingState: LocationState = "UNAVAILABLE";
  private error: Error | null = null;
  private listeners = new Set<(location: LocationSample) => void>();
  private queue: ReturnType<typeof createLocationSampleQueue>;
  private staleThresholdMs: number;
  private subscription: Location.LocationSubscription | null = null;

  constructor(options: ExpoLocationAdapterOptions = {}) {
    this.staleThresholdMs = options.staleThresholdMs ?? 30_000;
    this.queue = options.queue ?? createLocationSampleQueue();
  }

  async permissionState(): Promise<LocationPermissionState> {
    const status = await Location.getForegroundPermissionsAsync();
    this.permission = this.normalizePermission(
      status.status as ExpoLocationPermissionResult,
    );
    return this.permission;
  }

  async requestPermission(): Promise<LocationPermissionState> {
    const status = await Location.requestForegroundPermissionsAsync();
    this.permission = this.normalizePermission(
      status.status as ExpoLocationPermissionResult,
    );
    return this.permission;
  }

  async startTracking(): Promise<void> {
    if (this.permission !== "GRANTED") {
      const permissionStatus = await this.requestPermission();
      if (permissionStatus !== "GRANTED") {
        this.trackingState = "PERMISSION_DENIED";
        return;
      }
    }

    this.trackingState = "TRACKING";
    this.error = null;

    const subscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 10,
      },
      (position) => {
        const sample = this.normalizePosition(position);
        this.enqueueSample(sample);
        this.listeners.forEach((listener) => listener(sample));
      },
    );

    this.subscription = subscription;
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
    if (permissionStatus !== "GRANTED") {
      return null;
    }

    const result = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const sample = this.normalizePosition(result);
    this.enqueueSample(sample);
    return sample;
  }

  subscribe(listener: (location: LocationSample) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getTrackingState(): LocationState {
    return this.trackingState;
  }

  getErrorState(): Error | null {
    return this.error;
  }

  getPendingLocationCount(): number {
    return this.queue.pendingCount();
  }

  getPendingLocationState(): LocationBufferState {
    return this.queue.state();
  }

  private normalizePermission(
    permission: ExpoLocationPermissionResult,
  ): LocationPermissionState {
    switch (permission) {
      case "granted":
        return "GRANTED";
      case "denied":
        return "DENIED";
      case "restricted":
      case "limited":
        return "RESTRICTED";
      default:
        return "NOT_REQUESTED";
    }
  }

  private normalizePosition(position: Location.LocationObject): LocationSample {
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      timestamp: position.timestamp,
      accuracy: position.coords.accuracy ?? 0,
      speed: position.coords.speed ?? undefined,
      heading: position.coords.heading ?? undefined,
    };
  }

  private enqueueSample(sample: LocationSample) {
    if (this.queue.pendingCount() > 200) {
      this.queue.dequeue();
    }

    this.queue.enqueue(sample);

    if (Date.now() - sample.timestamp > this.staleThresholdMs) {
      this.trackingState = "STALE";
    } else if (this.trackingState === "UNAVAILABLE") {
      this.trackingState = "READY";
    }
  }
}

export const PLATFORM_VALIDATION_REQUIRED = "PLATFORM VALIDATION REQUIRED";

export const backgroundLocationTaskName = "background-location-task";
