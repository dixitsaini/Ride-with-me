import type { LocationSample } from "./index";
import type { LocationSamplingConfig } from "./samplingPolicy";

export type SampleGateReason =
  | "ACCEPTED"
  | "ACCEPTED_LOW_ACCURACY"
  | "DUPLICATE"
  | "OUT_OF_ORDER"
  | "INVALID"
  | "STALE_SAMPLE"
  | "REJECTED_LOW_ACCURACY";

export type SampleGateResult = {
  accepted: boolean;
  publishable: boolean;
  reason: SampleGateReason;
};

export type SampleGateCounters = Record<SampleGateReason, number>;

export type SampleGate = {
  evaluate: (sample: LocationSample) => SampleGateResult;
  configure: (config: LocationSamplingConfig) => void;
  lastAccepted: () => LocationSample | null;
  counters: () => SampleGateCounters;
  reset: () => void;
};

export type SampleGateOptions = {
  now?: () => number;
  dedupeLimit?: number;
};

function emptyCounters(): SampleGateCounters {
  return {
    ACCEPTED: 0,
    ACCEPTED_LOW_ACCURACY: 0,
    DUPLICATE: 0,
    OUT_OF_ORDER: 0,
    INVALID: 0,
    STALE_SAMPLE: 0,
    REJECTED_LOW_ACCURACY: 0,
  };
}

export function locationSampleKey(sample: LocationSample): string {
  return `${sample.latitude.toFixed(6)}:${sample.longitude.toFixed(6)}:${sample.timestamp}:${sample.accuracy}`;
}

function isValid(sample: LocationSample): boolean {
  return (
    Number.isFinite(sample.latitude) &&
    Number.isFinite(sample.longitude) &&
    Number.isFinite(sample.timestamp) &&
    Number.isFinite(sample.accuracy) &&
    sample.latitude >= -90 &&
    sample.latitude <= 90 &&
    sample.longitude >= -180 &&
    sample.longitude <= 180 &&
    sample.accuracy >= 0
  );
}

export function createSampleGate(
  config: LocationSamplingConfig,
  options: SampleGateOptions = {},
): SampleGate {
  const now = options.now ?? Date.now;
  const dedupeLimit = options.dedupeLimit ?? 512;
  let activeConfig = config;
  const seen = new Set<string>();
  const seenOrder: string[] = [];
  let last: LocationSample | null = null;
  let counters = emptyCounters();

  const record = (reason: SampleGateReason): SampleGateResult => {
    counters[reason] += 1;
    return {
      accepted: reason === "ACCEPTED" || reason === "ACCEPTED_LOW_ACCURACY",
      publishable: reason === "ACCEPTED",
      reason,
    };
  };

  const remember = (key: string) => {
    seen.add(key);
    seenOrder.push(key);
    while (seenOrder.length > dedupeLimit) {
      const oldest = seenOrder.shift();
      if (oldest !== undefined) {
        seen.delete(oldest);
      }
    }
  };

  return {
    evaluate(sample) {
      if (!isValid(sample)) {
        return record("INVALID");
      }

      if (now() - sample.timestamp > activeConfig.maxSampleAgeMs) {
        return record("STALE_SAMPLE");
      }

      const key = locationSampleKey(sample);
      if (seen.has(key)) {
        return record("DUPLICATE");
      }

      if (last) {
        if (sample.timestamp < last.timestamp) {
          return record("OUT_OF_ORDER");
        }
        if (sample.timestamp === last.timestamp) {
          return record("DUPLICATE");
        }
      }

      if (sample.accuracy > activeConfig.maxAcceptedAccuracyMeters) {
        remember(key);
        return record("REJECTED_LOW_ACCURACY");
      }

      remember(key);
      last = sample;

      if (sample.accuracy > activeConfig.maxPublishableAccuracyMeters) {
        return record("ACCEPTED_LOW_ACCURACY");
      }

      return record("ACCEPTED");
    },
    configure(nextConfig) {
      activeConfig = nextConfig;
    },
    lastAccepted() {
      return last;
    },
    counters() {
      return { ...counters };
    },
    reset() {
      seen.clear();
      seenOrder.length = 0;
      last = null;
      counters = emptyCounters();
    },
  };
}
