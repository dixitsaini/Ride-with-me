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

  const mockPermission = {
    status: "granted",
    canAskAgain: true,
    accuracyAuthorization: "full",
  };

  const mockPosition = { value: mockLocationObject };
  const mockServicesEnabled = { value: true };
  const mockWatchFailure: { value: Error | null } = { value: null };

  return {
    Accuracy: {
      Balanced: 3,
    },
    mockPermission,
    mockServicesEnabled,
    mockWatchFailure,
    mockPosition,
    getForegroundPermissionsAsync: jest.fn(async () => ({ ...mockPermission })),
    requestForegroundPermissionsAsync: jest.fn(async () => ({
      ...mockPermission,
    })),
    hasServicesEnabledAsync: jest.fn(async () => mockServicesEnabled.value),
    getCurrentPositionAsync: jest.fn(async () => mockPosition.value),
    watchPositionAsync: jest.fn(async (_options, callback) => {
      if (mockWatchFailure.value) {
        throw mockWatchFailure.value;
      }
      return {
        remove: jest.fn(),
        callback,
      };
    }),
  };
});

type ExpoLocationMock = {
  mockPermission: {
    status: string;
    canAskAgain?: boolean;
    accuracyAuthorization?: string;
  };
  mockServicesEnabled: { value: boolean };
  mockWatchFailure: { value: Error | null };
  mockPosition: { value: Record<string, unknown> };
  getForegroundPermissionsAsync: jest.Mock;
  requestForegroundPermissionsAsync: jest.Mock;
  hasServicesEnabledAsync: jest.Mock;
  getCurrentPositionAsync: jest.Mock;
  watchPositionAsync: jest.Mock;
};

function expoMock(): ExpoLocationMock {
  return jest.requireMock("expo-location") as ExpoLocationMock;
}

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
    const timestamp = Date.now();
    const sampleA = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp,
      accuracy: 5,
    });
    const sampleB = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp,
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

describe("ExpoLocationAdapter platform edge cases", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const mock = expoMock();
    mock.mockPermission.status = "granted";
    mock.mockPermission.canAskAgain = true;
    mock.mockPermission.accuracyAuthorization = "full";
    mock.mockServicesEnabled.value = true;
    mock.mockWatchFailure.value = null;
    mock.mockPosition.value = {
      coords: {
        latitude: 41.1,
        longitude: -73.4,
        accuracy: 8,
        speed: 4.2,
        heading: 90,
      },
      timestamp: 1700000000000,
    };
    mock.hasServicesEnabledAsync.mockImplementation(
      async () => mock.mockServicesEnabled.value,
    );
    mock.getCurrentPositionAsync.mockImplementation(
      async () => mock.mockPosition.value,
    );
    mock.watchPositionAsync.mockImplementation(async (_options, callback) => {
      if (mock.mockWatchFailure.value) {
        throw mock.mockWatchFailure.value;
      }
      return { remove: jest.fn(), callback };
    });
  });

  it("reports GPS availability from the platform", async () => {
    const adapter = new ExpoLocationAdapter();

    await expect(adapter.hasServicesEnabled()).resolves.toBe(true);

    expoMock().mockServicesEnabled.value = false;
    await expect(adapter.hasServicesEnabled()).resolves.toBe(false);
  });

  it("treats a throwing GPS availability check as unavailable", async () => {
    const mock = expoMock();
    mock.hasServicesEnabledAsync.mockRejectedValue(new Error("no gps"));

    const adapter = new ExpoLocationAdapter();

    await expect(adapter.hasServicesEnabled()).resolves.toBe(false);
    expect(adapter.getErrorState()?.message).toBe("no gps");
  });

  it("stops at PERMISSION_DENIED when the user denies", async () => {
    const mock = expoMock();
    mock.mockPermission.status = "denied";
    const adapter = new ExpoLocationAdapter();

    await expect(adapter.permissionState()).resolves.toBe("DENIED");
    await adapter.startTracking();

    expect(adapter.getTrackingState()).toBe("PERMISSION_DENIED");
    expect(mock.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("stops at PERMISSION_BLOCKED when the prompt can no longer be shown", async () => {
    const mock = expoMock();
    mock.mockPermission.status = "denied";
    mock.mockPermission.canAskAgain = false;
    const adapter = new ExpoLocationAdapter();

    await expect(adapter.requestPermission()).resolves.toBe("BLOCKED");
    await adapter.startTracking();

    expect(adapter.getTrackingState()).toBe("PERMISSION_BLOCKED");
    expect(mock.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("treats reduced accuracy authorization as LIMITED but still tracks", async () => {
    const mock = expoMock();
    mock.mockPermission.accuracyAuthorization = "reduced";
    const adapter = new ExpoLocationAdapter();

    await expect(adapter.permissionState()).resolves.toBe("LIMITED");
    await adapter.startTracking();

    expect(adapter.getTrackingState()).toBe("TRACKING");
  });

  it("returns no current location without permission", async () => {
    const mock = expoMock();
    mock.mockPermission.status = "denied";
    const adapter = new ExpoLocationAdapter();

    await expect(adapter.getCurrentLocation()).resolves.toBeNull();
    expect(mock.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it("surfaces watch startup failures as ERROR and notifies subscribers", async () => {
    const mock = expoMock();
    mock.mockWatchFailure.value = new Error("watch unavailable");
    const adapter = new ExpoLocationAdapter();
    const onError = jest.fn();
    adapter.subscribe(jest.fn(), onError);

    await expect(adapter.startTracking()).rejects.toThrow("watch unavailable");

    expect(adapter.getTrackingState()).toBe("ERROR");
    expect(adapter.getErrorState()?.message).toBe("watch unavailable");
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("tags a platform-mocked position as mock", async () => {
    const mock = expoMock();
    mock.mockPosition.value = {
      coords: {
        latitude: 1,
        longitude: 2,
        accuracy: 5,
        mocked: true,
      },
      timestamp: 1700000000000,
    };
    const adapter = new ExpoLocationAdapter();

    await expect(adapter.getCurrentLocation()).resolves.toMatchObject({
      latitude: 1,
      longitude: 2,
      source: "mock",
    });
  });

  it("exposes a stable empty buffer state", () => {
    const adapter = new ExpoLocationAdapter();

    expect(adapter.getPendingLocationCount()).toBe(0);
    expect(adapter.getPendingLocationState()).toBe("EMPTY");
    expect(adapter.getLatestSample()).toBeNull();
  });
});
