import * as TaskManager from "expo-task-manager";
import {
  BACKGROUND_LOCATION_PLATFORM_REQUIREMENTS,
  BACKGROUND_LOCATION_TASK,
} from "./background";
import {
  addBackgroundLocationSink,
  clearBackgroundLocationSinks,
  getBackgroundLocationSinkCount,
  pushBackgroundLocation,
} from "./backgroundSink";
import type { LocationSample } from "./index";

jest.mock("expo-task-manager", () => ({
  defineTask: jest.fn(),
}));

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  hasServicesEnabledAsync: jest.fn(async () => true),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: "granted",
  })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({
    status: "granted",
  })),
}));

type TaskHandler = (event: {
  data?: unknown;
  error?: { message?: string } | null;
}) => Promise<void>;

function definedTask(): TaskHandler {
  const calls = (TaskManager.defineTask as jest.Mock).mock.calls;
  const match = calls.find(([name]) => name === BACKGROUND_LOCATION_TASK);
  if (!match) {
    throw new Error("background location task was not defined");
  }
  return match[1] as TaskHandler;
}

describe("background location task", () => {
  const taskHandler = definedTask();
  const received: LocationSample[] = [];
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    received.length = 0;
    unsubscribe = addBackgroundLocationSink((sample: LocationSample) =>
      received.push(sample),
    );
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    clearBackgroundLocationSinks();
    warn.mockClear();
  });

  it("defines the task under the exported name", () => {
    expect(TaskManager.defineTask).toHaveBeenCalledWith(
      BACKGROUND_LOCATION_TASK,
      expect.any(Function),
    );
  });

  it("forwards the first location payload to the sink", async () => {
    await taskHandler({
      data: {
        locations: [
          {
            coords: {
              latitude: 40.5,
              longitude: -74.1,
              accuracy: 12,
              speed: 3,
              heading: 180,
            },
            timestamp: 1700000000000,
          },
        ],
      },
      error: null,
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      latitude: 40.5,
      longitude: -74.1,
      timestamp: 1700000000000,
      accuracy: 12,
      speed: 3,
      heading: 180,
      source: "gps",
    });
  });

  it("marks a simulated position as mock", async () => {
    await taskHandler({
      data: {
        locations: [
          {
            coords: { latitude: 1, longitude: 2, mocked: true },
            timestamp: 1700000000000,
          },
        ],
      },
    });

    expect(received[0]?.source).toBe("mock");
    expect(received[0]?.accuracy).toBe(0);
  });

  it("drops malformed payloads instead of emitting partial samples", async () => {
    await taskHandler({ data: {} });
    await taskHandler({ data: { locations: [] } });
    await taskHandler({ data: { locations: [{}] } });
    await taskHandler({
      data: { locations: [{ coords: { latitude: 1 }, timestamp: 1 }] },
    });
    await taskHandler({
      data: { locations: [{ coords: { latitude: 1, longitude: 2 } }] },
    });

    expect(received).toHaveLength(0);
  });

  it("logs task errors and does not emit", async () => {
    await taskHandler({
      data: { locations: [] },
      error: { message: "location unavailable" },
    });

    expect(received).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("reports zero deliveries when nothing is listening", () => {
    unsubscribe?.();
    unsubscribe = null;

    expect(
      pushBackgroundLocation({
        latitude: 1,
        longitude: 2,
        timestamp: 1700000000000,
        accuracy: 5,
      }),
    ).toBe(0);
  });

  it("delivers one sample to every registered sink exactly once", () => {
    unsubscribe?.();
    unsubscribe = null;
    clearBackgroundLocationSinks();

    const first: LocationSample[] = [];
    const second: LocationSample[] = [];
    const releaseFirst = addBackgroundLocationSink((sample) =>
      first.push(sample),
    );
    const releaseSecond = addBackgroundLocationSink((sample) =>
      second.push(sample),
    );

    expect(getBackgroundLocationSinkCount()).toBe(2);
    expect(
      pushBackgroundLocation({
        latitude: 1,
        longitude: 2,
        timestamp: 1700000000000,
        accuracy: 5,
      }),
    ).toBe(2);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    releaseFirst();
    releaseFirst();
    expect(getBackgroundLocationSinkCount()).toBe(1);
    expect(
      pushBackgroundLocation({
        latitude: 1,
        longitude: 2,
        timestamp: 1700000000001,
        accuracy: 5,
      }),
    ).toBe(1);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);

    releaseSecond();
    clearBackgroundLocationSinks();
    expect(getBackgroundLocationSinkCount()).toBe(0);
  });

  it("reports platform validation as pending for every surface", () => {
    expect(BACKGROUND_LOCATION_PLATFORM_REQUIREMENTS).toEqual({
      ios: "PLATFORM VALIDATION REQUIRED",
      android: "PLATFORM VALIDATION REQUIRED",
      lifecycle: "PLATFORM VALIDATION REQUIRED",
      terminatedApp: "PLATFORM VALIDATION REQUIRED",
    });
  });
});
