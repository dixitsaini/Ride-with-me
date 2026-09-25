import { clearPermissionSources } from "../permissions";
import { createInMemoryAppStateSource } from "./appStateSource";
import { createLocationEngine } from "./LocationEngine";
import type {
  LocationEngineStatus,
  LocationSample,
  LocationSamplePublisher,
} from "./index";
import { createPersistentLocationBuffer } from "./persistentBuffer";
import type { LocationSamplingConfig } from "./samplingPolicy";
import { createFakeLocationProvider } from "./testing/fakeLocationProvider";
import type { FakeLocationProvider } from "./testing/fakeLocationProvider";

const BASE_TIME = 1_700_000_000_000;

function createClock(start = BASE_TIME) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

type HarnessOptions = {
  provider?: FakeLocationProvider;
  publisher?: LocationSamplePublisher | null;
  granted?: boolean;
  failOnStart?: boolean;
  servicesEnabled?: boolean;
  grantOnRequest?: boolean;
  staleThresholdMs?: number;
  config?: Partial<LocationSamplingConfig>;
};

function createHarness(options: HarnessOptions = {}) {
  const clock = createClock();
  const provider =
    options.provider ??
    createFakeLocationProvider({
      permission: options.granted === false ? "DENIED" : "NOT_REQUESTED",
      servicesEnabled: options.servicesEnabled ?? true,
      grantOnRequest: options.grantOnRequest ?? true,
      failOnStart: options.failOnStart ?? false,
      now: clock.now,
    });
  const appState = createInMemoryAppStateSource("foreground");
  const buffer = createPersistentLocationBuffer({
    storage: {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    },
    now: clock.now,
  });
  const statuses: LocationEngineStatus[] = [];
  const samples: LocationSample[] = [];
  const published: LocationSample[] = [];

  const engine = createLocationEngine({
    provider,
    buffer,
    publisher: options.publisher ?? undefined,
    appStateSource: appState,
    now: clock.now,
    staleThresholdMs: options.staleThresholdMs,
  });

  const unsubscribeStatus = engine.subscribeToStatus((status) => {
    statuses.push(status);
  });
  engine.subscribe((sample) => samples.push(sample));

  return {
    clock,
    provider,
    appState,
    buffer,
    engine,
    statuses,
    samples,
    published,
    states: () => statuses.map((status) => status.state),
    dispose() {
      unsubscribeStatus();
      engine.dispose();
    },
  };
}

function createRecordingPublisher(): {
  publisher: LocationSamplePublisher;
  published: LocationSample[];
  setReachable: (value: boolean) => void;
  setFailing: (value: boolean) => void;
} {
  const published: LocationSample[] = [];
  let reachable = true;
  let failing = false;
  return {
    publisher: {
      publish: async (sample) => {
        if (failing) {
          throw new Error("publish failed");
        }
        published.push(sample);
      },
      isReachable: () => reachable,
      getConnectionState: () =>
        reachable ? ("CONNECTED" as const) : ("DISCONNECTED" as const),
    },
    published,
    setReachable: (value) => {
      reachable = value;
    },
    setFailing: (value) => {
      failing = value;
    },
  };
}

describe("LocationEngine", () => {
  const engines: { dispose: () => void }[] = [];

  function harness(options: HarnessOptions = {}) {
    const created = createHarness(options);
    engines.push(created);
    return created;
  }

  afterEach(() => {
    while (engines.length > 0) {
      engines.pop()?.dispose();
    }
    clearPermissionSources();
    jest.useRealTimers();
  });

  describe("permission lifecycle", () => {
    it("requests permission then reaches AUTHORIZED", async () => {
      const h = harness();

      await h.engine.startTracking();

      expect(h.provider.startCount()).toBe(1);
      expect(h.provider.isWatching()).toBe(true);
      expect(h.engine.getTrackingState()).toBe("AUTHORIZED");
      expect(h.states().slice(0, 2)).toEqual(["REQUESTED", "AUTHORIZED"]);
    });

    it("stops at PERMISSION_DENIED when the user denies", async () => {
      const h = harness({ grantOnRequest: false });

      await h.engine.startTracking();

      expect(h.engine.getTrackingState()).toBe("PERMISSION_DENIED");
      expect(h.provider.startCount()).toBe(0);
      expect(h.provider.liveSubscriptionCount()).toBe(0);
    });

    it("stops at PERMISSION_DENIED when permission is already denied", async () => {
      const h = harness({ granted: false });

      await h.engine.startTracking();

      expect(h.engine.getTrackingState()).toBe("PERMISSION_DENIED");
      expect(h.provider.startCount()).toBe(0);
    });

    it("stops at PERMISSION_BLOCKED when the OS blocks location", async () => {
      const h = harness();
      h.provider.setPermission("BLOCKED");

      await h.engine.startTracking();

      expect(h.engine.getTrackingState()).toBe("PERMISSION_BLOCKED");
      expect(h.provider.startCount()).toBe(0);
    });

    it("recovers after permission is granted and refresh is called", async () => {
      const h = harness({ granted: false });

      await h.engine.startTracking();
      expect(h.engine.getTrackingState()).toBe("PERMISSION_DENIED");

      h.provider.setPermission("GRANTED");
      await h.engine.refresh();

      expect(h.provider.startCount()).toBe(1);
      expect(h.engine.getTrackingState()).toBe("AUTHORIZED");
    });

    it("releases a running session when permission is revoked", async () => {
      const h = harness();
      await h.engine.startTracking();
      h.provider.emit();
      await h.engine.settled();
      expect(h.engine.getTrackingState()).toBe("TRACKING");

      h.provider.setPermission("DENIED");
      const status = await h.engine.refresh();

      expect(status.permission).toBe("DENIED");
      expect(status.state).toBe("PERMISSION_DENIED");
      expect(status.updatesActive).toBe(false);
      expect(h.provider.isWatching()).toBe(false);
      expect(h.provider.liveSubscriptionCount()).toBe(0);

      h.provider.emit();
      await h.engine.settled();
      expect(h.samples).toHaveLength(1);

      h.provider.setPermission("GRANTED");
      const recovered = await h.engine.refresh();

      expect(recovered.state).not.toBe("PERMISSION_DENIED");
      expect(h.provider.isWatching()).toBe(true);
      expect(h.engine.getStatus().updatesActive).toBe(true);
    });
  });

  describe("GPS availability", () => {
    it("reaches GPS_UNAVAILABLE without starting updates", async () => {
      const h = harness({ servicesEnabled: false });

      await h.engine.startTracking();

      expect(h.engine.getTrackingState()).toBe("GPS_UNAVAILABLE");
      expect(h.provider.startCount()).toBe(0);
      expect(h.engine.getStatus().gpsAvailable).toBe(false);
    });

    it("recovers to AUTHORIZED when GPS services come back", async () => {
      const h = harness({ servicesEnabled: false });
      await h.engine.startTracking();
      expect(h.engine.getTrackingState()).toBe("GPS_UNAVAILABLE");

      h.provider.setServicesEnabled(true);
      await h.engine.refresh();

      expect(h.provider.startCount()).toBe(1);
      expect(h.engine.getTrackingState()).toBe("AUTHORIZED");
    });

    it("surfaces provider start failures as ERROR", async () => {
      const h = harness({ failOnStart: true });

      await h.engine.startTracking();

      expect(h.engine.getTrackingState()).toBe("ERROR");
      expect(h.engine.getErrorState()?.message).toBe(
        "native watch unavailable",
      );
      expect(h.engine.getStatus().updatesActive).toBe(false);
    });

    it("releases a running session when location services are disabled", async () => {
      const h = harness();
      await h.engine.startTracking();
      expect(h.provider.isWatching()).toBe(true);

      h.provider.setServicesEnabled(false);
      const degraded = await h.engine.refresh();

      expect(degraded.gpsAvailable).toBe(false);
      expect(degraded.state).toBe("GPS_UNAVAILABLE");
      expect(degraded.updatesActive).toBe(false);
      expect(h.provider.isWatching()).toBe(false);
      expect(h.provider.liveSubscriptionCount()).toBe(0);

      h.provider.setServicesEnabled(true);
      const recovered = await h.engine.refresh();

      expect(recovered.gpsAvailable).toBe(true);
      expect(recovered.state).not.toBe("GPS_UNAVAILABLE");
      expect(h.provider.isWatching()).toBe(true);
      expect(h.provider.startCount()).toBe(2);
    });
  });

  describe("sample acceptance", () => {
    it("accepts a valid sample and reaches TRACKING", async () => {
      const h = harness();
      await h.engine.startTracking();

      h.provider.emit();
      await h.engine.settled();

      expect(h.samples).toHaveLength(1);
      expect(h.engine.getTrackingState()).toBe("TRACKING");
      expect(h.engine.getStatus().freshness).toBe("FRESH");
      expect(h.engine.getStatus().accuracy).toBe("GOOD");
      expect(h.provider.watchConfig()?.distanceIntervalMeters).toBeGreaterThan(
        0,
      );
    });

    it("ignores duplicate samples", async () => {
      const h = harness();
      await h.engine.startTracking();

      h.provider.emit({ timestamp: BASE_TIME + 10, latitude: 40.5 });
      await h.engine.settled();
      h.provider.emit({ timestamp: BASE_TIME + 10, latitude: 40.5 });
      await h.engine.settled();

      expect(h.samples).toHaveLength(1);
      expect(h.buffer.pendingCount()).toBe(1);
      expect(h.engine.getLatestSample()?.latitude).toBe(40.5);
    });

    it("ignores out-of-order samples without corrupting the stream", async () => {
      const h = harness();
      await h.engine.startTracking();

      const newer = h.provider.emit({ timestamp: BASE_TIME + 20_000 });
      await h.engine.settled();
      h.provider.emit({ timestamp: BASE_TIME + 5_000, latitude: 10 });
      await h.engine.settled();

      expect(h.samples).toHaveLength(1);
      expect(h.engine.getLatestSample()).toEqual(newer);
      expect(h.buffer.pendingCount()).toBe(1);
      expect(h.engine.getTrackingState()).toBe("TRACKING");
    });

    it("accepts low accuracy locally but never publishes it", async () => {
      const recording = createRecordingPublisher();
      const h = harness({ publisher: recording.publisher });
      await h.engine.startTracking();

      h.provider.emit({ accuracy: 400 });
      await h.engine.settled();

      expect(h.engine.getTrackingState()).toBe("LOW_ACCURACY");
      expect(recording.published).toHaveLength(0);
      expect(h.buffer.pendingCount()).toBe(1);
      expect(h.engine.getStatus().accuracy).toBe("LOW");
    });

    it("returns to GOOD accuracy once a usable fix arrives", async () => {
      const recording = createRecordingPublisher();
      const h = harness({ publisher: recording.publisher });
      await h.engine.startTracking();

      h.provider.emit({ accuracy: 400 });
      await h.engine.settled();

      expect(h.engine.getStatus().accuracy).toBe("LOW");
      expect(h.engine.getTrackingState()).toBe("LOW_ACCURACY");
      expect(recording.published).toHaveLength(0);

      h.provider.emit({ accuracy: 12 });
      await h.engine.settled();

      expect(h.engine.getStatus().accuracy).toBe("GOOD");
      expect(h.engine.getTrackingState()).toBe("TRACKING");
      expect(recording.published).toHaveLength(1);
    });

    it("drops an out-of-order sample even after newer ones were published", async () => {
      const recording = createRecordingPublisher();
      const h = harness({ publisher: recording.publisher });
      await h.engine.startTracking();

      const first = h.provider.emit({ timestamp: BASE_TIME + 10_000 });
      const second = h.provider.emit({
        timestamp: BASE_TIME + 30_000,
        latitude: 41,
      });
      await h.engine.settled();
      expect(h.samples).toHaveLength(2);

      h.provider.emit({ timestamp: BASE_TIME + 20_000, latitude: 9 });
      await h.engine.settled();

      expect(h.samples).toHaveLength(2);
      expect(h.engine.getLatestSample()).toEqual(second);
      expect(h.engine.getLatestSample()?.latitude).toBe(41);
      expect(h.buffer.pendingCount()).toBe(0);
      expect(recording.published.map((entry) => entry.timestamp)).toEqual([
        first.timestamp,
        second.timestamp,
      ]);
      expect(h.engine.getTrackingState()).toBe("TRACKING");
    });

    it("drops a late sample that arrives while recovering from stale", async () => {
      const h = harness({ staleThresholdMs: 30_000 });
      await h.engine.startTracking();

      h.provider.emit({ timestamp: BASE_TIME + 1_000 });
      await h.engine.settled();
      expect(h.engine.getTrackingState()).toBe("TRACKING");

      h.clock.advance(40_000);
      expect(h.engine.checkFreshness()).toBe("STALE");

      const recovered = h.provider.emit({ timestamp: BASE_TIME + 39_500 });
      await h.engine.settled();
      expect(h.states()).toEqual(
        expect.arrayContaining(["STALE", "RECOVERING"]),
      );

      h.provider.emit({ timestamp: BASE_TIME + 20_000 });
      await h.engine.settled();

      expect(h.samples).toHaveLength(2);
      expect(h.engine.getLatestSample()).toEqual(recovered);
      expect(h.buffer.pendingCount()).toBe(2);
      expect(h.engine.getStatus().freshness).toBe("FRESH");
    });
  });

  describe("stale and recovery", () => {
    it("moves TRACKING to STALE after the threshold and recovers", async () => {
      const h = harness({ staleThresholdMs: 30_000 });
      await h.engine.startTracking();
      h.provider.emit();
      await h.engine.settled();
      expect(h.engine.getTrackingState()).toBe("TRACKING");

      h.clock.advance(40_000);
      expect(h.engine.checkFreshness()).toBe("STALE");

      h.provider.emit();
      await h.engine.settled();

      expect(h.states()).toEqual(
        expect.arrayContaining(["STALE", "RECOVERING", "TRACKING"]),
      );
      expect(h.engine.getTrackingState()).toBe("TRACKING");
      expect(h.engine.getStatus().freshness).toBe("FRESH");
    });

    it("stops the watcher and the subscription on stopTracking", async () => {
      const h = harness();
      await h.engine.startTracking();
      h.provider.emit();
      await h.engine.settled();

      await h.engine.stopTracking();

      expect(h.provider.isWatching()).toBe(false);
      expect(h.provider.liveSubscriptionCount()).toBe(0);
      expect(h.engine.getTrackingState()).toBe("READY");
      expect(h.engine.getStatus().updatesActive).toBe(false);
    });

    it("does not duplicate subscriptions when startTracking is called twice", async () => {
      const h = harness();
      await h.engine.startTracking();
      await h.engine.startTracking();

      expect(h.provider.liveSubscriptionCount()).toBe(1);
      expect(h.provider.startCount()).toBe(1);

      await h.engine.stopTracking();
      await h.engine.startTracking();

      expect(h.provider.liveSubscriptionCount()).toBe(1);
      expect(h.provider.subscriptionCount()).toBe(2);
      expect(h.provider.startCount()).toBe(2);
    });
  });

  describe("pause and resume", () => {
    it("pauses to PAUSED_BY_USER, ignores samples, then resumes", async () => {
      const h = harness();
      await h.engine.startTracking();
      h.provider.emit();
      await h.engine.settled();
      expect(h.engine.getTrackingState()).toBe("TRACKING");

      await h.engine.pauseTracking();
      expect(h.engine.getTrackingState()).toBe("PAUSED_BY_USER");
      expect(h.provider.isWatching()).toBe(false);

      h.provider.emit({ latitude: 12.34 });
      await h.engine.settled();
      expect(h.samples).toHaveLength(1);

      await h.engine.resumeTracking();
      expect(h.engine.getTrackingState()).not.toBe("PAUSED_BY_USER");
      expect(h.provider.isWatching()).toBe(true);

      h.provider.emit({ latitude: 13.34 });
      await h.engine.settled();
      expect(h.samples).toHaveLength(2);
      expect(h.engine.getTrackingState()).toBe("TRACKING");
    });
  });

  describe("offline buffering and sync", () => {
    it("buffers locally when the publisher is unreachable", async () => {
      const recording = createRecordingPublisher();
      recording.setReachable(false);
      const h = harness({ publisher: recording.publisher });
      await h.engine.startTracking();

      h.provider.emit();
      await h.engine.settled();

      expect(h.engine.getTrackingState()).toBe("OFFLINE_BUFFERING");
      expect(h.engine.getStatus().publisherState).toBe("OFFLINE");
      expect(h.buffer.pendingCount()).toBe(1);
      expect(recording.published).toHaveLength(0);
    });

    it("flushes the buffer through SYNCING once the network returns", async () => {
      const recording = createRecordingPublisher();
      recording.setReachable(false);
      const h = harness({ publisher: recording.publisher });
      await h.engine.startTracking();
      h.provider.emit();
      await h.engine.settled();
      expect(h.engine.getTrackingState()).toBe("OFFLINE_BUFFERING");

      h.provider.emit();
      await h.engine.settled();
      expect(h.buffer.pendingCount()).toBe(2);

      recording.setReachable(true);
      await h.engine.flush();

      expect(h.states()).toEqual(expect.arrayContaining(["SYNCING"]));
      expect(recording.published).toHaveLength(2);
      expect(h.buffer.pendingCount()).toBe(0);
      expect(h.buffer.state()).toBe("EMPTY");
      expect(h.engine.getTrackingState()).toBe("TRACKING");
      expect(h.engine.getStatus().publisherState).toBe("ONLINE");
    });

    it("keeps failed samples for retry and clears them after recovery", async () => {
      const recording = createRecordingPublisher();
      recording.setFailing(true);
      const h = harness({ publisher: recording.publisher });
      await h.engine.startTracking();

      h.provider.emit();
      await h.engine.settled();

      expect(h.engine.getTrackingState()).toBe("OFFLINE_BUFFERING");
      expect(h.buffer.pendingCount()).toBe(1);
      expect(h.buffer.pending()[0].attempts).toBe(1);
      expect(h.engine.getStatus().error).toBe("publish failed");

      recording.setFailing(false);
      await h.engine.flush();

      expect(h.buffer.pendingCount()).toBe(0);
      expect(recording.published).toHaveLength(1);
      expect(h.engine.getStatus().error).toBeNull();
      expect(h.engine.getTrackingState()).toBe("TRACKING");
    });

    it("restores pending samples from the local buffer on a fresh engine", async () => {
      const shared = {
        store: new Map<string, string>(),
        async getItem(key: string) {
          return shared.store.get(key) ?? null;
        },
        async setItem(key: string, value: string) {
          shared.store.set(key, value);
        },
        async removeItem(key: string) {
          shared.store.delete(key);
        },
      };
      const clock = createClock();
      const provider = createFakeLocationProvider({
        permission: "GRANTED",
        now: clock.now,
      });
      const unreachable: LocationSamplePublisher = {
        publish: async () => undefined,
        isReachable: () => false,
      };
      const first = createLocationEngine({
        provider,
        buffer: createPersistentLocationBuffer({
          storage: shared,
          now: clock.now,
        }),
        publisher: unreachable,
        appStateSource: createInMemoryAppStateSource("foreground"),
        now: clock.now,
      });
      await first.startTracking();
      provider.emit();
      provider.emit();
      await first.settled();
      expect(first.getPendingLocationCount()).toBe(2);
      first.dispose();

      const restored: LocationSample[] = [];
      const second = createLocationEngine({
        provider: createFakeLocationProvider({
          permission: "GRANTED",
          now: clock.now,
        }),
        buffer: createPersistentLocationBuffer({
          storage: shared,
          now: clock.now,
        }),
        publisher: {
          publish: async (sample) => {
            restored.push(sample);
          },
          isReachable: () => true,
        },
        appStateSource: createInMemoryAppStateSource("foreground"),
        now: clock.now,
      });
      engines.push({ dispose: () => second.dispose() });
      await second.startTracking();

      expect(second.getPendingLocationCount()).toBe(2);
      expect(second.getStatus().buffer.state).toBe("PENDING");

      await second.flush();
      expect(second.getPendingLocationCount()).toBe(0);
      expect(restored).toHaveLength(2);
      second.dispose();
    });

    it("stops a flush at the first failure and resumes in order without duplicating", async () => {
      const published: LocationSample[] = [];
      let reachable = false;
      let failingTimestamp: number | null = null;
      const publisher: LocationSamplePublisher = {
        publish: async (sample) => {
          if (sample.timestamp === failingTimestamp) {
            throw new Error("publish failed");
          }
          published.push(sample);
        },
        isReachable: () => reachable,
        getConnectionState: () =>
          reachable ? ("CONNECTED" as const) : ("DISCONNECTED" as const),
      };
      const h = harness({ publisher });
      await h.engine.startTracking();

      h.provider.emit({ timestamp: BASE_TIME + 1_000 });
      h.provider.emit({ timestamp: BASE_TIME + 2_000 });
      h.provider.emit({ timestamp: BASE_TIME + 3_000 });
      await h.engine.settled();

      expect(h.buffer.pendingCount()).toBe(3);
      expect(published).toHaveLength(0);
      expect(h.engine.getTrackingState()).toBe("OFFLINE_BUFFERING");

      reachable = true;
      failingTimestamp = BASE_TIME + 2_000;
      await h.engine.flush();

      expect(published.map((entry) => entry.timestamp)).toEqual([
        BASE_TIME + 1_000,
      ]);
      expect(h.buffer.pending().map((entry) => entry.timestamp)).toEqual([
        BASE_TIME + 2_000,
        BASE_TIME + 3_000,
      ]);
      expect(h.buffer.pending()[0].attempts).toBe(1);
      expect(h.engine.getStatus().publisherState).toBe("FAILED");

      failingTimestamp = null;
      await h.engine.flush();

      expect(h.buffer.pendingCount()).toBe(0);
      expect(published.map((entry) => entry.timestamp)).toEqual([
        BASE_TIME + 1_000,
        BASE_TIME + 2_000,
        BASE_TIME + 3_000,
      ]);
      expect(h.engine.getStatus().error).toBeNull();
      expect(h.engine.getTrackingState()).toBe("TRACKING");

      await h.engine.flush();
      expect(published).toHaveLength(3);
    });
  });

  describe("background and foreground", () => {
    it("suspends in background and recovers on foreground", async () => {
      const recording = createRecordingPublisher();
      const h = harness({ publisher: recording.publisher });
      await h.engine.startTracking();
      h.provider.emit();
      await h.engine.settled();
      expect(h.engine.getTrackingState()).toBe("TRACKING");

      h.appState.setState("background");
      await h.engine.settled();
      expect(h.engine.getTrackingState()).toBe("SUSPENDED");
      expect(h.engine.getStatus().suspended).toBe(true);

      h.appState.setState("foreground");
      await h.engine.settled();

      expect(h.states()).toEqual(
        expect.arrayContaining(["SUSPENDED", "RECOVERING"]),
      );
      expect(h.engine.getStatus().suspended).toBe(false);
      expect(h.engine.getTrackingState()).toBe("TRACKING");
      expect(h.provider.isWatching()).toBe(true);
    });
  });

  describe("status observation", () => {
    it("emits status snapshots as the engine moves", async () => {
      const h = harness();
      await h.engine.startTracking();
      h.provider.emit();
      await h.engine.settled();

      expect(h.statuses.length).toBeGreaterThan(2);
      expect(h.statuses.at(-1)?.state).toBe("TRACKING");
      expect(h.statuses.at(-1)?.buffer.pending).toBeGreaterThanOrEqual(0);
      expect(h.statuses.at(-1)?.connection).toBeDefined();
    });

    it("keeps a manual getCurrentLocation in the accepted stream", async () => {
      const h = harness();
      await h.engine.startTracking();

      const sample = await h.engine.getCurrentLocation();
      await h.engine.settled();

      expect(sample).not.toBeNull();
      expect(h.samples).toHaveLength(1);
      expect(h.engine.getTrackingState()).toBe("TRACKING");
    });
  });
});
