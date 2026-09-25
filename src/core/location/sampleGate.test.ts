import { createSampleGate, locationSampleKey } from "./sampleGate";
import { createSamplingPolicy } from "./samplingPolicy";
import type { LocationSample } from "./index";

const config = createSamplingPolicy().resolve();

function sample(overrides: Partial<LocationSample> = {}): LocationSample {
  return {
    latitude: 40.7128,
    longitude: -74.006,
    timestamp: 1_700_000_000_000,
    accuracy: 8,
    ...overrides,
  };
}

describe("sample gate", () => {
  it("accepts a valid, in-order, accurate sample", () => {
    const gate = createSampleGate(config, { now: () => 1_700_000_000_000 });

    const result = gate.evaluate(sample());

    expect(result).toEqual({
      accepted: true,
      publishable: true,
      reason: "ACCEPTED",
    });
    expect(gate.lastAccepted()).toEqual(sample());
  });

  it("rejects duplicate samples", () => {
    const now = () => 1_700_000_000_000;
    const gate = createSampleGate(config, { now });

    gate.evaluate(sample());
    const duplicate = gate.evaluate(sample());

    expect(duplicate).toMatchObject({
      accepted: false,
      reason: "DUPLICATE",
    });
    expect(gate.counters().DUPLICATE).toBe(1);
  });

  it("rejects samples older than the latest accepted sample", () => {
    const now = () => 1_700_000_100_000;
    const gate = createSampleGate(config, { now });

    gate.evaluate(sample({ timestamp: 1_700_000_100_000 }));
    const older = gate.evaluate(
      sample({ timestamp: 1_700_000_050_000, latitude: 41 }),
    );

    expect(older).toMatchObject({
      accepted: false,
      reason: "OUT_OF_ORDER",
    });
    expect(gate.lastAccepted()?.timestamp).toBe(1_700_000_100_000);
    expect(gate.lastAccepted()?.latitude).toBe(40.7128);
  });

  it("rejects invalid coordinates and accuracy", () => {
    const now = () => 1_700_000_000_000;
    const gate = createSampleGate(config, { now });

    expect(gate.evaluate(sample({ latitude: 120 })).reason).toBe("INVALID");
    expect(gate.evaluate(sample({ longitude: -200 })).reason).toBe("INVALID");
    expect(gate.evaluate(sample({ accuracy: Number.NaN })).reason).toBe(
      "INVALID",
    );
    expect(
      gate.evaluate(sample({ latitude: Number.POSITIVE_INFINITY })).reason,
    ).toBe("INVALID");
  });

  it("rejects samples older than the max sample age", () => {
    const gate = createSampleGate(config, {
      now: () => 1_700_000_000_000 + config.maxSampleAgeMs + 1,
    });

    expect(gate.evaluate(sample()).reason).toBe("STALE_SAMPLE");
    expect(gate.lastAccepted()).toBeNull();
  });

  it("accepts low accuracy locally but does not publish it", () => {
    const gate = createSampleGate(config, { now: () => 1_700_000_000_000 });

    const result = gate.evaluate(
      sample({ accuracy: config.maxPublishableAccuracyMeters + 1 }),
    );

    expect(result).toEqual({
      accepted: true,
      publishable: false,
      reason: "ACCEPTED_LOW_ACCURACY",
    });
  });

  it("rejects clearly unusable accuracy outright", () => {
    const gate = createSampleGate(config, { now: () => 1_700_000_000_000 });

    const result = gate.evaluate(
      sample({ accuracy: config.maxAcceptedAccuracyMeters + 1 }),
    );

    expect(result).toMatchObject({
      accepted: false,
      reason: "REJECTED_LOW_ACCURACY",
    });
    expect(gate.lastAccepted()).toBeNull();
  });

  it("keeps a bounded dedupe window", () => {
    const base = 1_700_000_000_000;
    const gate = createSampleGate(config, {
      now: () => base,
      dedupeLimit: 2,
    });

    gate.evaluate(sample({ timestamp: base, latitude: 1 }));
    gate.evaluate(sample({ timestamp: base + 1, latitude: 2 }));
    gate.evaluate(sample({ timestamp: base + 2, latitude: 3 }));

    expect(gate.evaluate(sample({ timestamp: base, latitude: 1 })).reason).toBe(
      "OUT_OF_ORDER",
    );
    expect(gate.counters().OUT_OF_ORDER).toBe(1);
  });

  it("produces a stable dedupe key", () => {
    expect(locationSampleKey(sample())).toBe(locationSampleKey(sample()));
  });

  it("reconfigures thresholds without losing ordering history", () => {
    const gate = createSampleGate(config, { now: () => 1_700_000_000_000 });
    gate.evaluate(sample({ timestamp: 1_700_000_000_000 }));

    gate.configure({
      ...config,
      maxPublishableAccuracyMeters: 1_000,
      maxAcceptedAccuracyMeters: 2_000,
    });

    expect(
      gate.evaluate(sample({ timestamp: 1_700_000_001_000, accuracy: 500 })),
    ).toMatchObject({ accepted: true, publishable: true });
    expect(
      gate.evaluate(sample({ timestamp: 1_699_999_999_000, accuracy: 1 }))
        .reason,
    ).toBe("OUT_OF_ORDER");
  });
});
