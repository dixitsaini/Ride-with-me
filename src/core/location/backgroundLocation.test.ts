import * as ExpoLocation from "expo-location";
import { Platform } from "react-native";
import {
  BACKGROUND_LOCATION_TASK,
  createExpoBackgroundLocationService,
  createUnsupportedBackgroundLocationService,
} from "./backgroundLocation";

jest.mock("expo-location", () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5 },
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
}));

const startUpdates =
  ExpoLocation.startLocationUpdatesAsync as unknown as jest.Mock;
const stopUpdates =
  ExpoLocation.stopLocationUpdatesAsync as unknown as jest.Mock;
const hasStarted =
  ExpoLocation.hasStartedLocationUpdatesAsync as unknown as jest.Mock;
const hasServices =
  ExpoLocation.hasServicesEnabledAsync as unknown as jest.Mock;
const getForeground =
  ExpoLocation.getForegroundPermissionsAsync as unknown as jest.Mock;
const getBackground =
  ExpoLocation.getBackgroundPermissionsAsync as unknown as jest.Mock;
const requestForeground =
  ExpoLocation.requestForegroundPermissionsAsync as unknown as jest.Mock;
const requestBackground =
  ExpoLocation.requestBackgroundPermissionsAsync as unknown as jest.Mock;

function setPlatformOS(value: string) {
  Object.defineProperty(Platform, "OS", { value, configurable: true });
}

async function flushMicrotasks(rounds = 20) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

const originalPlatformOS = Object.getOwnPropertyDescriptor(Platform, "OS");

// The background service logs every state transition; keep the suite quiet.
jest.spyOn(console, "info").mockImplementation(() => undefined);
jest.spyOn(console, "warn").mockImplementation(() => undefined);
jest.spyOn(console, "error").mockImplementation(() => undefined);

afterAll(() => {
  jest.restoreAllMocks();
  if (originalPlatformOS) {
    Object.defineProperty(Platform, "OS", originalPlatformOS);
  }
});

function resetMocks() {
  jest.clearAllMocks();
  setPlatformOS("ios");
  // A successful request changes what the platform reports afterwards.
  startUpdates.mockImplementation(async () => {
    hasStarted.mockResolvedValue(true);
  });
  stopUpdates.mockImplementation(async () => {
    hasStarted.mockResolvedValue(false);
  });
  hasStarted.mockResolvedValue(false);
  hasServices.mockResolvedValue(true);
  getForeground.mockResolvedValue({ status: "granted" });
  getBackground.mockResolvedValue({ status: "granted" });
  requestForeground.mockImplementation(async () => {
    getForeground.mockResolvedValue({ status: "granted" });
    return { status: "granted" };
  });
  requestBackground.mockImplementation(async () => {
    getBackground.mockResolvedValue({ status: "granted" });
    return { status: "granted" };
  });
}

describe("unsupported background location service", () => {
  it("reports unsupported and never touches the platform", async () => {
    const service = createUnsupportedBackgroundLocationService(
      "Background location is not available with the mock location provider.",
    );

    expect(service.isSupported()).toBe(false);
    expect(service.status()).toBe("UNSUPPORTED");
    expect(service.getError()).toBe(
      "Background location is not available with the mock location provider.",
    );
    await expect(service.start({ requestPermission: true })).resolves.toBe(
      "UNSUPPORTED",
    );
    await expect(service.permissionState()).resolves.toBe("NOT_REQUESTED");
    await expect(service.stop()).resolves.toBeUndefined();
  });
});

describe("expo background location service", () => {
  beforeEach(resetMocks);

  it("starts the task once with a foreground service notification", async () => {
    const service = createExpoBackgroundLocationService();

    expect(service.isSupported()).toBe(true);
    await expect(service.start()).resolves.toBe("RUNNING");
    await expect(service.start()).resolves.toBe("RUNNING");

    expect(startUpdates).toHaveBeenCalledTimes(1);
    expect(startUpdates).toHaveBeenCalledWith(
      BACKGROUND_LOCATION_TASK,
      expect.objectContaining({
        accuracy: 3,
        timeInterval: 5000,
        distanceInterval: 10,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: expect.objectContaining({
          notificationTitle: expect.any(String),
          notificationBody: expect.any(String),
        }),
      }),
    );
    expect(service.status()).toBe("RUNNING");
  });

  it("honours an explicit notification title and body", async () => {
    const service = createExpoBackgroundLocationService({
      notificationTitle: "Ride in progress",
      notificationBody: "Sharing your position with your group.",
      accuracy: "high",
      timeIntervalMs: 3000,
      distanceIntervalMeters: 5,
    });

    await service.start();

    expect(startUpdates).toHaveBeenCalledWith(
      BACKGROUND_LOCATION_TASK,
      expect.objectContaining({
        accuracy: 4,
        timeInterval: 3000,
        distanceInterval: 5,
        foregroundService: {
          notificationTitle: "Ride in progress",
          notificationBody: "Sharing your position with your group.",
        },
      }),
    );
  });

  it("coalesces concurrent starts into a single registration", async () => {
    let release: (() => void) | undefined;
    startUpdates.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const service = createExpoBackgroundLocationService();

    const first = service.start();
    const second = service.start();

    await flushMicrotasks();
    expect(startUpdates).toHaveBeenCalledTimes(1);
    release?.();
    await expect(first).resolves.toBe("RUNNING");
    await expect(second).resolves.toBe("RUNNING");
    expect(startUpdates).toHaveBeenCalledTimes(1);
  });

  it("adopts a registration the OS already owns instead of stacking one", async () => {
    hasStarted.mockResolvedValue(true);
    const service = createExpoBackgroundLocationService();

    await expect(service.start()).resolves.toBe("RUNNING");

    expect(hasStarted).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK);
    expect(startUpdates).not.toHaveBeenCalled();
    expect(service.status()).toBe("RUNNING");
  });

  it("requests permission only when asked and still refuses when unusable", async () => {
    getBackground.mockResolvedValue({ status: "denied" });
    requestBackground.mockResolvedValue({ status: "denied" });
    const service = createExpoBackgroundLocationService();

    await expect(service.start()).resolves.toBe("NOT_AUTHORIZED");
    expect(requestBackground).not.toHaveBeenCalled();
    expect(startUpdates).not.toHaveBeenCalled();

    await expect(service.start({ requestPermission: true })).resolves.toBe(
      "NOT_AUTHORIZED",
    );
    expect(requestBackground).toHaveBeenCalledTimes(1);
    expect(startUpdates).not.toHaveBeenCalled();
    expect(service.getError()).toBeNull();
  });

  it("requests background permission on iOS when asked", async () => {
    getBackground.mockResolvedValue({ status: "not_requested" });
    const service = createExpoBackgroundLocationService();

    await expect(service.start({ requestPermission: true })).resolves.toBe(
      "RUNNING",
    );

    expect(requestBackground).toHaveBeenCalledTimes(1);
    expect(requestForeground).not.toHaveBeenCalled();
    expect(startUpdates).toHaveBeenCalledTimes(1);
  });

  it("uses while-in-use permission on Android, where the service path runs", async () => {
    setPlatformOS("android");
    getForeground.mockResolvedValue({ status: "granted" });
    getBackground.mockResolvedValue({ status: "denied" });
    const service = createExpoBackgroundLocationService();

    await expect(service.start()).resolves.toBe("RUNNING");

    expect(getForeground).toHaveBeenCalled();
    expect(getBackground).not.toHaveBeenCalled();
    expect(startUpdates).toHaveBeenCalledTimes(1);
  });

  it("requests foreground permission on Android when asked", async () => {
    setPlatformOS("android");
    getForeground.mockResolvedValue({ status: "not_requested" });
    const service = createExpoBackgroundLocationService();

    await expect(service.start({ requestPermission: true })).resolves.toBe(
      "RUNNING",
    );

    expect(requestForeground).toHaveBeenCalledTimes(1);
    expect(requestBackground).not.toHaveBeenCalled();
  });

  it("reports disabled location services as unavailable", async () => {
    hasServices.mockResolvedValue(false);
    const service = createExpoBackgroundLocationService();

    await expect(service.start()).resolves.toBe("UNAVAILABLE");
    expect(startUpdates).not.toHaveBeenCalled();
    expect(service.getError()).toBe(
      "Location services are disabled on this device.",
    );
  });

  it("captures a registration failure instead of throwing", async () => {
    startUpdates.mockRejectedValue(new Error("service not allowed"));
    const service = createExpoBackgroundLocationService();

    await expect(service.start()).resolves.toBe("ERROR");
    expect(service.getError()).toBe("service not allowed");
    expect(service.status()).toBe("ERROR");
  });

  it("stops the task exactly once and reports stopped", async () => {
    const service = createExpoBackgroundLocationService();
    await service.start();

    await service.stop();
    await service.stop();

    expect(stopUpdates).toHaveBeenCalledTimes(1);
    expect(stopUpdates).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK);
    expect(service.status()).toBe("STOPPED");
    expect(service.getError()).toBeNull();
  });

  it("does not try to stop a task the OS never started", async () => {
    const service = createExpoBackgroundLocationService();

    await service.stop();

    expect(stopUpdates).not.toHaveBeenCalled();
    expect(service.status()).toBe("STOPPED");
  });

  it("still reports stopped when the platform refuses to stop", async () => {
    const service = createExpoBackgroundLocationService();
    await service.start();
    stopUpdates.mockRejectedValue(new Error("stop failed"));

    await service.stop();

    expect(service.status()).toBe("STOPPED");
    expect(service.getError()).toBe("stop failed");
  });

  it("waits for an in-flight start before stopping", async () => {
    let release: (() => void) | undefined;
    startUpdates.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    hasStarted.mockResolvedValue(true);
    const service = createExpoBackgroundLocationService();

    const start = service.start();
    const stop = service.stop();
    release?.();

    await expect(start).resolves.toBe("RUNNING");
    await stop;
    expect(stopUpdates).toHaveBeenCalledWith(BACKGROUND_LOCATION_TASK);
    expect(service.status()).toBe("STOPPED");
  });
});
