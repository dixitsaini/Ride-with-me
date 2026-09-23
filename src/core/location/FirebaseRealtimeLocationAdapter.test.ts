import { onValue, ref, set } from "firebase/database";
import {
  FirebaseRealtimeLocationAdapter,
  normalizeLocation,
} from "./FirebaseRealtimeLocationAdapter";
import { createLocationSample, type RealtimeLocationUpdate } from "./index";

jest.mock("firebase/database", () => ({
  getDatabase: jest.fn(),
  onValue: jest.fn(),
  ref: jest.fn((_database, path) => ({ path })),
  set: jest.fn(async () => undefined),
}));

jest.mock("firebase/app", () => ({
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: "test-app" })),
}));

describe("FirebaseRealtimeLocationAdapter", () => {
  const identity = { getIdentity: jest.fn(async () => ({ userId: "user-a" })) };
  const callbacks: ((snapshot: { val: () => unknown }) => void)[] = [];
  const unsubscribe = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    callbacks.length = 0;
    (onValue as jest.Mock).mockImplementation((_reference, callback) => {
      callbacks.push(callback);
      return unsubscribe;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createAdapter() {
    return new FirebaseRealtimeLocationAdapter({
      database: {} as never,
      identity,
      staleThresholdMs: 30_000,
    });
  }

  it("publishes normalized fields under the authenticated user path", async () => {
    const adapter = createAdapter();
    const location = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp: 100,
      accuracy: 4,
      speed: 5,
    });

    await adapter.publish("context-a", location);

    expect(ref).toHaveBeenCalledWith(
      {},
      "liveLocations/context-a/locations/user-a",
    );
    expect(set).toHaveBeenCalledWith(expect.anything(), {
      latitude: 1,
      longitude: 2,
      timestamp: 100,
      accuracy: 4,
      speed: 5,
    });
  });

  it("deduplicates successful publishes and protects retry after failure", async () => {
    const adapter = createAdapter();
    const location = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp: 100,
      accuracy: 4,
    });
    const setMock = set as jest.Mock;
    setMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);

    await expect(adapter.publish("context-a", location)).rejects.toThrow(
      "publish failed",
    );
    await adapter.publish("context-a", location);
    await adapter.publish("context-a", location);

    expect(setMock).toHaveBeenCalledTimes(2);
  });

  it("maps Firebase connectivity values to the domain connection state", () => {
    const adapter = createAdapter();
    adapter.connect();

    callbacks[0]?.({ val: () => true });
    expect(adapter.getConnectionState()).toBe("CONNECTED");
    callbacks[0]?.({ val: () => false });
    expect(adapter.getConnectionState()).toBe("RECONNECTING");
  });

  it("normalizes snapshots, marks stale data, and cleans up duplicate subscriptions", async () => {
    const adapter = createAdapter();
    const updates: RealtimeLocationUpdate[] = [];
    const stopA = adapter.subscribe("context-a", (update) =>
      updates.push(update),
    );
    const stopB = adapter.subscribe("context-a", (update) =>
      updates.push(update),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(onValue).toHaveBeenCalledTimes(1);
    callbacks[0]?.({
      val: () => ({
        "user-a": {
          latitude: 10,
          longitude: 20,
          timestamp: Date.now() - 60_000,
          accuracy: 8,
        },
        invalid: { latitude: "bad" },
      }),
    });

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ userId: "user-a", stale: true });

    stopA();
    expect(unsubscribe).not.toHaveBeenCalled();
    stopB();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("emits stale state when a publisher stops sending updates", async () => {
    jest.useFakeTimers();
    const adapter = createAdapter();
    const updates: RealtimeLocationUpdate[] = [];
    adapter.subscribe("context-a", (update) => updates.push(update));
    await jest.runAllTimersAsync();
    callbacks[0]?.({
      val: () => ({
        "user-a": {
          latitude: 10,
          longitude: 20,
          timestamp: Date.now(),
          accuracy: 8,
        },
      }),
    });

    expect(updates[0]?.stale).toBe(false);
    jest.advanceTimersByTime(30_001);
    expect(updates.at(-1)?.stale).toBe(true);
  });

  it("rejects invalid location records", () => {
    expect(
      normalizeLocation({
        latitude: 200,
        longitude: 2,
        timestamp: 1,
        accuracy: 1,
      }),
    ).toBeNull();
    expect(
      normalizeLocation({
        latitude: 1,
        longitude: 2,
        timestamp: "now",
        accuracy: 1,
      }),
    ).toBeNull();
  });
});
