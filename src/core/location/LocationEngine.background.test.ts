import { clearPermissionSources } from "../permissions";
import { createInMemoryAppStateSource } from "./appStateSource";
import type {
  BackgroundLocationService,
  BackgroundLocationStartOptions,
  BackgroundLocationState,
} from "./backgroundLocation";
import {
  clearBackgroundLocationSinks,
  getBackgroundLocationSinkCount,
  pushBackgroundLocation,
} from "./backgroundSink";
import { createLocationEngine } from "./LocationEngine";
import type {
  EngineBackgroundStatus,
  LocationEngineStatus,
  LocationPermissionState,
  LocationSample,
  LocationSamplePublisher,
} from "./index";
import { createPersistentLocationBuffer } from "./persistentBuffer";
import { createFakeLocationProvider } from "./testing/fakeLocationProvider";

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

function sample(timestamp: number, accuracy = 8): LocationSample {
  return {
    latitude: 40.7128,
    longitude: -74.006,
    timestamp,
    accuracy,
    source: "gps",
  };
}

function createFakeBackgroundService(
  initial: BackgroundLocationState = "STOPPED",
) {
  const state: { current: BackgroundLocationState } = { current: initial };
  const permission: { current: LocationPermissionState } = {
    current: "GRANTED",
  };
  let supported = true;
  let error: string | null = null;
  let startCalls = 0;
  let stopCalls = 0;
  let lastOptions: BackgroundLocationStartOptions | undefined;

  const service: BackgroundLocationService = {
    isSupported: () => supported,
    status: () => state.current,
    permissionState: async () => permission.current,
    requestPermission: async () => {
      permission.current = "GRANTED";
      return permission.current;
    },
    start: async (options) => {
      startCalls += 1;
      lastOptions = options;
      const refusing =
        state.current === "NOT_AUTHORIZED" ||
        state.current === "UNAVAILABLE" ||
        state.current === "ERROR";
      if (!refusing) {
        state.current = "RUNNING";
      }
      return state.current;
    },
    stop: async () => {
      stopCalls += 1;
      state.current = "STOPPED";
    },
    getError: () => error,
  };

  return {
    service,
    startCalls: () => startCalls,
    stopCalls: () => stopCalls,
    lastOptions: () => lastOptions,
    setState: (next: BackgroundLocationState) => {
      state.current = next;
    },
    setPermission: (next: LocationPermissionState) => {
      permission.current = next;
    },
    setSupported: (next: boolean) => {
      supported = next;
    },
    setError: (next: string | null) => {
      error = next;
    },
  };
}

type HarnessOptions = {
  granted?: boolean;
  publisher?: LocationSamplePublisher | null;
  background?: BackgroundLocationService | null;
};

function createHarness(options: HarnessOptions = {}) {
  const clock = createClock();
  const provider = createFakeLocationProvider({
    permission: options.granted === false ? "DENIED" : "NOT_REQUESTED",
    servicesEnabled: true,
    grantOnRequest: true,
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

  const publisher: LocationSamplePublisher | null =
    options.publisher === undefined
      ? {
          publish: async (entry) => {
            published.push(entry);
          },
          isReachable: () => true,
          getConnectionState: () => "CONNECTED" as const,
        }
      : options.publisher;

  const engine = createLocationEngine({
    provider,
    buffer,
    publisher,
    appStateSource: appState,
    now: clock.now,
    background:
      options.background === undefined
        ? createFakeBackgroundService().service
        : options.background,
  });

  const unsubscribeStatus = engine.subscribeToStatus((status) => {
    statuses.push(status);
  });
  engine.subscribe((entry) => samples.push(entry));

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

describe("LocationEngine background location", () => {
  const harnesses: { dispose: () => void }[] = [];

  function harness(options: HarnessOptions = {}) {
    const created = createHarness(options);
    harnesses.push(created);
    return created;
  }

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.dispose();
    }
    clearPermissionSources();
    clearBackgroundLocationSinks();
  });

  it("reports unsupported when no background service is wired up", async () => {
    const created = harness({ background: null });
    await created.engine.startTracking();

    const status = await created.engine.startBackgroundUpdates();

    expect(status).toEqual({
      supported: false,
      state: "UNSUPPORTED",
      permission: "NOT_REQUESTED",
      error: null,
      desired: true,
    });
    expect(created.provider.isWatching()).toBe(true);
    expect(created.engine.getBackgroundStatus().desired).toBe(true);
  });

  it("keeps a single OS stream: background takes over from the watch", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();
    expect(created.provider.isWatching()).toBe(true);
    expect(created.provider.startCount()).toBe(1);

    const status = await created.engine.startBackgroundUpdates({
      requestPermission: true,
    });

    expect(status.state).toBe("RUNNING");
    expect(status.supported).toBe(true);
    expect(status.desired).toBe(true);
    expect(background.startCalls()).toBe(1);
    expect(background.lastOptions()).toEqual({ requestPermission: true });
    expect(created.provider.isWatching()).toBe(false);
    expect(created.engine.getStatus().updatesActive).toBe(true);
  });

  it("rejects a foreground sample while the background stream owns delivery", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();
    await created.engine.startBackgroundUpdates();

    created.provider.emit();
    expect(created.samples).toHaveLength(0);

    pushBackgroundLocation(sample(BASE_TIME + 10));
    await created.engine.settled();
    expect(created.samples).toHaveLength(1);
    expect(created.published).toHaveLength(1);
  });

  it("returns to the foreground watch when background tracking stops", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();
    await created.engine.startBackgroundUpdates();

    const status = await created.engine.stopBackgroundUpdates();

    expect(background.stopCalls()).toBe(1);
    expect(status.desired).toBe(false);
    expect(status.state).toBe("STOPPED");
    expect(created.provider.isWatching()).toBe(true);
    expect(created.engine.getStatus().updatesActive).toBe(true);

    created.provider.emit();
    expect(created.samples).toHaveLength(1);
  });

  it("falls back to the foreground watch when background is not authorized", async () => {
    const background = createFakeBackgroundService("NOT_AUTHORIZED");
    const created = harness({ background: background.service });
    await created.engine.startTracking();

    const status = await created.engine.startBackgroundUpdates({
      requestPermission: true,
    });

    expect(status.state).toBe("NOT_AUTHORIZED");
    expect(status.desired).toBe(true);
    expect(created.provider.isWatching()).toBe(true);
    expect(created.engine.getStatus().updatesActive).toBe(true);

    created.provider.emit();
    expect(created.samples).toHaveLength(1);
  });

  it("keeps the background request across pause and resume", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();
    await created.engine.startBackgroundUpdates({ requestPermission: false });
    expect(background.startCalls()).toBe(1);

    await created.engine.pauseTracking();
    expect(background.stopCalls()).toBe(1);
    expect(created.engine.getBackgroundStatus().desired).toBe(true);

    await created.engine.resumeTracking();
    expect(background.startCalls()).toBe(2);
    expect(created.engine.getBackgroundStatus().desired).toBe(true);
    expect(created.provider.isWatching()).toBe(false);
  });

  it("clears the background request when tracking stops", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();
    await created.engine.startBackgroundUpdates();

    await created.engine.stopTracking();

    expect(background.stopCalls()).toBe(1);
    expect(created.engine.getBackgroundStatus().desired).toBe(false);
    expect(created.provider.isWatching()).toBe(false);

    await created.engine.resumeTracking();
    expect(background.startCalls()).toBe(1);
  });

  it("does not suspend while the background stream keeps delivering", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();
    await created.engine.startBackgroundUpdates();

    created.appState.setState("background");
    await created.engine.settled();

    expect(created.engine.getStatus().suspended).toBe(false);
    expect(created.engine.getTrackingState()).not.toBe("SUSPENDED");
    expect(created.provider.isWatching()).toBe(false);

    pushBackgroundLocation(sample(BASE_TIME + 20));
    await created.engine.settled();
    expect(created.samples).toHaveLength(1);
  });

  it("releases the background sink on dispose", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();
    await created.engine.startBackgroundUpdates();
    expect(getBackgroundLocationSinkCount()).toBe(1);

    created.dispose();

    expect(getBackgroundLocationSinkCount()).toBe(0);
    expect(background.stopCalls()).toBe(1);
    pushBackgroundLocation(sample(BASE_TIME + 30));
    expect(created.samples).toHaveLength(0);
  });

  it("surfaces background errors through the status", async () => {
    const background = createFakeBackgroundService();
    background.setError("Starting background location failed");
    const created = harness({ background: background.service });

    const status: EngineBackgroundStatus = created.engine.getBackgroundStatus();

    expect(status.error).toBe("Starting background location failed");
    expect(status.supported).toBe(true);
    expect(status.desired).toBe(false);
  });

  it("starts the background stream only once when requested twice", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();

    await created.engine.startBackgroundUpdates({ requestPermission: true });
    await created.engine.startBackgroundUpdates({ requestPermission: true });

    expect(background.startCalls()).toBe(1);
    expect(background.stopCalls()).toBe(0);
    expect(getBackgroundLocationSinkCount()).toBe(1);
    expect(created.engine.getBackgroundStatus()).toMatchObject({
      state: "RUNNING",
      desired: true,
      error: null,
    });
    expect(created.engine.getStatus().updatesActive).toBe(true);
    expect(created.provider.isWatching()).toBe(false);
    expect(created.provider.stopCount()).toBe(1);
  });

  it("stops the background stream only once when asked twice", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();
    await created.engine.startBackgroundUpdates();

    await created.engine.stopBackgroundUpdates();
    await created.engine.stopBackgroundUpdates();

    expect(background.stopCalls()).toBe(1);
    expect(getBackgroundLocationSinkCount()).toBe(0);
    expect(created.engine.getBackgroundStatus()).toMatchObject({
      state: "STOPPED",
      desired: false,
    });
    expect(created.engine.getStatus().updatesActive).toBe(true);
    expect(created.provider.isWatching()).toBe(true);
    expect(created.provider.liveSubscriptionCount()).toBe(1);

    created.provider.emit();
    expect(created.samples).toHaveLength(1);
  });

  it("releases the session when location permission is revoked while active", async () => {
    const background = createFakeBackgroundService();
    const created = harness({ background: background.service });
    await created.engine.startTracking();
    await created.engine.startBackgroundUpdates();
    expect(created.engine.getStatus().updatesActive).toBe(true);

    created.provider.setPermission("DENIED");
    const status = await created.engine.refresh();

    expect(status.permission).toBe("DENIED");
    expect(status.state).toBe("PERMISSION_DENIED");
    expect(status.updatesActive).toBe(false);
    expect(background.stopCalls()).toBe(1);
    expect(getBackgroundLocationSinkCount()).toBe(0);
    expect(created.provider.isWatching()).toBe(false);
    expect(created.engine.getBackgroundStatus()).toMatchObject({
      state: "STOPPED",
      // the request survives so background resumes once access returns
      desired: true,
    });
  });
});
