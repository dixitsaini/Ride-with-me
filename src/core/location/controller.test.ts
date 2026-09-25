import { clearPermissionSources } from "../permissions";
import { createInMemoryAppStateSource } from "./appStateSource";
import { createLocationEngine } from "./LocationEngine";
import {
  createMockLocationService,
  createLocationController,
  createLocationSample,
} from "./index";
import { createPersistentLocationBuffer } from "./persistentBuffer";
import { createFakeLocationProvider } from "./testing/fakeLocationProvider";

describe("LocationController", () => {
  it("tracks permission and start/stop lifecycle", async () => {
    const service = createMockLocationService();
    const controller = createLocationController(service);

    await controller.requestPermission();
    await controller.startTracking();

    expect(controller.getStatus().permission).toBe("GRANTED");
    expect(controller.getStatus().tracking).toBe("TRACKING");

    await controller.stopTracking();
    expect(controller.getStatus().tracking).toBe("READY");
  });

  it("propagates status and location updates to subscribers", async () => {
    const service = createMockLocationService();
    const controller = createLocationController(service);
    const onLocation = jest.fn();
    const onStatus = jest.fn();

    controller.subscribeToLocationChanges(onLocation);
    controller.subscribeToStatusChanges(onStatus);
    await controller.startTracking();

    const sample = createLocationSample({
      latitude: 11.1,
      longitude: 22.2,
      timestamp: Date.now(),
      accuracy: 9,
    });

    service.publish(sample);

    expect(onLocation).toHaveBeenCalledWith(sample);
    expect(onStatus).toHaveBeenCalled();
  });
});

describe("LocationController over LocationEngine", () => {
  const BASE_TIME = 1_700_000_000_000;
  let current = BASE_TIME;
  const now = () => current;
  const created: { dispose?: () => void }[] = [];

  function createEngineHarness() {
    const provider = createFakeLocationProvider({ permission: "GRANTED", now });
    const buffer = createPersistentLocationBuffer({
      storage: {
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
      },
      now,
    });
    const engine = createLocationEngine({
      provider,
      buffer,
      appStateSource: createInMemoryAppStateSource("foreground"),
      now,
      staleThresholdMs: 30_000,
    });
    const controller = createLocationController(engine);
    created.push(controller);
    return { provider, engine, controller };
  }

  beforeEach(() => {
    current = BASE_TIME;
  });

  afterEach(() => {
    while (created.length > 0) {
      created.pop()?.dispose?.();
    }
    clearPermissionSources();
  });

  it("exposes engine-backed freshness from a real sample", async () => {
    const { provider, controller } = createEngineHarness();

    await controller.startTracking();
    expect(controller.getStatus().tracking).toBe("AUTHORIZED");
    expect(controller.getStatus().freshness).toBe("UNKNOWN");

    provider.emit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controller.getStatus().tracking).toBe("TRACKING");
    expect(controller.getStatus().freshness).toBe("FRESH");
    expect(controller.getStatus().accuracy).toBe("GOOD");
    expect(controller.getStatus().lastSampleAt).toBeGreaterThan(0);
    expect(controller.getStatus().gpsAvailable).toBe(true);
  });

  it("reports STALE freshness once the sample ages out", async () => {
    const { provider, engine, controller } = createEngineHarness();

    await controller.startTracking();
    provider.emit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getStatus().freshness).toBe("FRESH");

    current += 40_000;
    engine.checkFreshness();

    expect(controller.getStatus().tracking).toBe("STALE");
    expect(controller.getStatus().freshness).toBe("STALE");
  });

  it("forwards engine controls and lifecycle to subscribers", async () => {
    const { provider, controller } = createEngineHarness();
    const onEngineStatus = jest.fn();
    controller.subscribeToEngineStatus!(onEngineStatus);

    await controller.startTracking();
    provider.emit();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onEngineStatus).toHaveBeenCalled();
    expect(typeof controller.getEngineStatus).toBe("function");
    expect(typeof controller.setPublisher).toBe("function");
    expect(typeof controller.setContext).toBe("function");
    expect(typeof controller.pauseTracking).toBe("function");
    expect(typeof controller.resumeTracking).toBe("function");
    expect(typeof controller.refresh).toBe("function");
    expect(typeof controller.flush).toBe("function");

    await controller.pauseTracking!();
    expect(controller.getStatus().tracking).toBe("PAUSED_BY_USER");

    await controller.resumeTracking!();
    expect(controller.getStatus().tracking).not.toBe("PAUSED_BY_USER");

    controller.setContext!({ rideState: "ACTIVE" });
    expect(controller.getEngineStatus!().state).not.toBe("PAUSED_BY_USER");
  });

  it("emits a status snapshot for every lifecycle step", async () => {
    const { controller } = createEngineHarness();
    const seen: string[] = [];
    controller.subscribeToStatusChanges((status) => seen.push(status.tracking));

    await controller.startTracking();
    await controller.stopTracking();

    expect(new Set(seen)).toEqual(new Set(["AUTHORIZED", "READY"]));
    expect(seen.at(-1)).toBe("READY");
  });
});
