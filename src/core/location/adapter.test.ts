import { ExpoLocationAdapter } from "./ExpoLocationAdapter";
import {
  createLocationSample,
  createLocationSampleQueue,
  isLocationStale,
} from "./index";

jest.mock("expo-location", () => {
  const mockLocationObject = {
    coords: {
      latitude: 41.1,
      longitude: -73.4,
      accuracy: 8,
      speed: 4.2,
      heading: 90,
    },
    timestamp: 1700000000000,
  };

  return {
    Accuracy: {
      Balanced: 3,
    },
    getForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
    requestForegroundPermissionsAsync: jest.fn(async () => ({
      status: "granted",
    })),
    getCurrentPositionAsync: jest.fn(async () => mockLocationObject),
    watchPositionAsync: jest.fn(async (_options, callback) => ({
      remove: jest.fn(),
      callback,
    })),
  };
});

describe("ExpoLocationAdapter", () => {
  it("normalizes a foreground permission result", async () => {
    const adapter = new ExpoLocationAdapter();
    await expect(adapter.permissionState()).resolves.toBe("GRANTED");
  });

  it("returns a normalized location sample from the current position", async () => {
    const adapter = new ExpoLocationAdapter();
    const sample = await adapter.getCurrentLocation();

    expect(sample).toMatchObject({
      latitude: 41.1,
      longitude: -73.4,
      accuracy: 8,
      speed: 4.2,
      heading: 90,
    });
  });

  it("starts tracking and subscribes to updates", async () => {
    const adapter = new ExpoLocationAdapter();
    const listener = jest.fn();

    adapter.subscribe(listener);
    await adapter.startTracking();

    expect(adapter.getTrackingState()).toBe("TRACKING");
    expect(typeof adapter.subscribe).toBe("function");
  });

  it("stops tracking and keeps the API stable", async () => {
    const adapter = new ExpoLocationAdapter();
    await adapter.startTracking();
    await adapter.stopTracking();

    expect(adapter.getTrackingState()).toBe("READY");
  });

  it("uses the queue for buffered and deduplicated locations", () => {
    const queue = createLocationSampleQueue();
    const sampleA = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp: Date.now(),
      accuracy: 5,
    });
    const sampleB = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp: Date.now(),
      accuracy: 5,
    });

    queue.enqueue(sampleA);
    queue.enqueue(sampleB);

    expect(queue.pendingCount()).toBe(1);
    expect(queue.peek()?.latitude).toBe(1);
  });

  it("supports stale detection for location freshness", () => {
    const staleLocation = createLocationSample({
      latitude: 9,
      longitude: 10,
      timestamp: Date.now() - 60000,
      accuracy: 12,
    });

    expect(isLocationStale(staleLocation, 30000)).toBe(true);
  });
});
