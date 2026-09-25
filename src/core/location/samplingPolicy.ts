export type LocationAccuracyLevel =
  "lowest" | "low" | "balanced" | "high" | "highest";

export type TrackingMode = "STOPPED" | "RIDING" | "PAUSED";

export type SamplingPolicyAppState = "foreground" | "background";

export type SamplingPolicyContext = {
  rideState?: "READY" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  trackingMode?: TrackingMode;
  appState?: SamplingPolicyAppState;
  batteryLevel?: number | null;
};

export type LocationSamplingConfig = {
  accuracy: LocationAccuracyLevel;
  timeIntervalMs: number;
  distanceIntervalMeters: number;
  staleThresholdMs: number;
  maxSampleAgeMs: number;
  maxPublishableAccuracyMeters: number;
  maxAcceptedAccuracyMeters: number;
  flushRetryDelayMs: number;
  flushBatchSize: number;
};

export type LocationSamplingPolicy = {
  resolve: (context?: SamplingPolicyContext) => LocationSamplingConfig;
  with: (overrides: Partial<LocationSamplingConfig>) => LocationSamplingPolicy;
};

export const DEFAULT_LOCATION_SAMPLING_CONFIG: LocationSamplingConfig = {
  accuracy: "balanced",
  timeIntervalMs: 5000,
  distanceIntervalMeters: 10,
  staleThresholdMs: 30_000,
  maxSampleAgeMs: 60_000,
  maxPublishableAccuracyMeters: 100,
  maxAcceptedAccuracyMeters: 1_000,
  flushRetryDelayMs: 5_000,
  flushBatchSize: 50,
};

export function createSamplingPolicy(
  overrides: Partial<LocationSamplingConfig> = {},
): LocationSamplingPolicy {
  const base: LocationSamplingConfig = {
    ...DEFAULT_LOCATION_SAMPLING_CONFIG,
    ...overrides,
  };

  const resolve = (
    context: SamplingPolicyContext = {},
  ): LocationSamplingConfig => {
    const config: LocationSamplingConfig = { ...base };

    if (context.rideState === "ACTIVE") {
      config.accuracy = "high";
      config.timeIntervalMs = 3_000;
      config.distanceIntervalMeters = 5;
    } else if (context.rideState === "PAUSED") {
      config.accuracy = "balanced";
      config.timeIntervalMs = 10_000;
      config.distanceIntervalMeters = 30;
    }

    if (context.trackingMode === "PAUSED") {
      config.accuracy = "balanced";
      config.timeIntervalMs = 10_000;
      config.distanceIntervalMeters = 30;
    }

    if (context.appState === "background") {
      config.timeIntervalMs = Math.max(config.timeIntervalMs, 10_000);
      config.distanceIntervalMeters = Math.max(
        config.distanceIntervalMeters,
        30,
      );
    }

    return config;
  };

  return {
    resolve,
    with(nextOverrides) {
      return createSamplingPolicy({ ...base, ...nextOverrides });
    },
  };
}

export const defaultSamplingPolicy: LocationSamplingPolicy =
  createSamplingPolicy();
