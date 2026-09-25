import {
  createSamplingPolicy,
  DEFAULT_LOCATION_SAMPLING_CONFIG,
  defaultSamplingPolicy,
} from "./samplingPolicy";

describe("sampling policy", () => {
  it("exposes the documented defaults", () => {
    expect(defaultSamplingPolicy.resolve()).toEqual(
      DEFAULT_LOCATION_SAMPLING_CONFIG,
    );
    expect(DEFAULT_LOCATION_SAMPLING_CONFIG.timeIntervalMs).toBe(5_000);
    expect(DEFAULT_LOCATION_SAMPLING_CONFIG.distanceIntervalMeters).toBe(10);
    expect(DEFAULT_LOCATION_SAMPLING_CONFIG.staleThresholdMs).toBe(30_000);
  });

  it("keeps defaults for an idle rider", () => {
    expect(defaultSamplingPolicy.resolve({ rideState: "READY" })).toEqual(
      DEFAULT_LOCATION_SAMPLING_CONFIG,
    );
  });

  it("samples faster and more accurately while riding", () => {
    const config = defaultSamplingPolicy.resolve({ rideState: "ACTIVE" });

    expect(config.accuracy).toBe("high");
    expect(config.timeIntervalMs).toBe(3_000);
    expect(config.distanceIntervalMeters).toBe(5);
  });

  it("relaxes sampling while the ride is paused", () => {
    const config = defaultSamplingPolicy.resolve({ rideState: "PAUSED" });

    expect(config.accuracy).toBe("balanced");
    expect(config.timeIntervalMs).toBe(10_000);
    expect(config.distanceIntervalMeters).toBe(30);
  });

  it("relaxes sampling when the tracking mode is paused", () => {
    const config = defaultSamplingPolicy.resolve({ trackingMode: "PAUSED" });

    expect(config.timeIntervalMs).toBe(10_000);
    expect(config.distanceIntervalMeters).toBe(30);
  });

  it("never samples faster than 10s in the background", () => {
    const config = defaultSamplingPolicy.resolve({
      rideState: "ACTIVE",
      appState: "background",
    });

    expect(config.timeIntervalMs).toBeGreaterThanOrEqual(10_000);
    expect(config.distanceIntervalMeters).toBeGreaterThanOrEqual(5);
  });

  it("carries background clamps over already-relaxed settings", () => {
    const config = defaultSamplingPolicy.resolve({
      rideState: "PAUSED",
      appState: "background",
    });

    expect(config.timeIntervalMs).toBe(10_000);
    expect(config.distanceIntervalMeters).toBe(30);
  });

  it("supports one-off overrides without mutating the base policy", () => {
    const policy = createSamplingPolicy({ timeIntervalMs: 1_000 }).with({
      maxPublishableAccuracyMeters: 25,
    });

    expect(policy.resolve().timeIntervalMs).toBe(1_000);
    expect(policy.resolve().maxPublishableAccuracyMeters).toBe(25);
    expect(defaultSamplingPolicy.resolve().timeIntervalMs).toBe(5_000);
    expect(defaultSamplingPolicy.resolve().maxPublishableAccuracyMeters).toBe(
      100,
    );
  });

  it("returns fresh objects so callers cannot mutate shared state", () => {
    const first = defaultSamplingPolicy.resolve();
    first.timeIntervalMs = 1;

    expect(defaultSamplingPolicy.resolve().timeIntervalMs).toBe(5_000);
  });
});
