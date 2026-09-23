import {
  createLocationSample,
  createLocationSampleQueue,
  createMockLocationStream,
  createMapLocationController,
  getLocationPermissionState,
  isLocationStale,
  normalizeLocationPermission,
  transitionLocationState,
  type LocationPermissionState,
  type LocationSample,
  type LocationState,
} from "../index";

describe("location foundation", () => {
  it("normalizes and validates a location sample", () => {
    const location: LocationSample = createLocationSample({
      latitude: 40.7128,
      longitude: -74.006,
      timestamp: 1700000000000,
      accuracy: 12,
      speed: 5.2,
      heading: 90,
    });

    expect(location.latitude).toBe(40.7128);
    expect(location.longitude).toBe(-74.006);
    expect(location.accuracy).toBe(12);
    expect(location.speed).toBe(5.2);
    expect(location.heading).toBe(90);
  });

  it("detects stale locations based on a freshness threshold", () => {
    const stale = createLocationSample({
      latitude: 40.7128,
      longitude: -74.006,
      timestamp: Date.now() - 120000,
      accuracy: 12,
    });

    expect(isLocationStale(stale, 30000)).toBe(true);
  });

  it("transitions the location state machine deterministically", () => {
    const next = transitionLocationState(
      "UNAVAILABLE" as LocationState,
      "GRANTED" as LocationPermissionState,
      true,
      false,
    );

    expect(next).toBe("READY");
  });

  it("supports permission mapping", () => {
    expect(normalizeLocationPermission("granted")).toBe("GRANTED");
    expect(normalizeLocationPermission("denied")).toBe("DENIED");
    expect(normalizeLocationPermission("not_requested")).toBe("NOT_REQUESTED");
    expect(getLocationPermissionState("restricted")).toBe("RESTRICTED");
  });

  it("queues and deduplicates buffered locations in order", () => {
    const queue = createLocationSampleQueue();
    const sampleA = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp: 1,
      accuracy: 5,
    });
    const sampleB = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp: 1,
      accuracy: 5,
    });
    const sampleC = createLocationSample({
      latitude: 3,
      longitude: 4,
      timestamp: 2,
      accuracy: 6,
    });

    queue.enqueue(sampleA);
    queue.enqueue(sampleB);
    queue.enqueue(sampleC);

    expect(queue.pendingCount()).toBe(2);
    expect(queue.peek()?.latitude).toBe(1);
    expect(queue.dequeue()?.latitude).toBe(1);
  });

  it("publishes a mocked location stream with reconnect and stale behavior", () => {
    const stream = createMockLocationStream();
    const updates: LocationSample[] = [];

    stream.subscribe("context-a", (update) => updates.push(update.location));
    stream.connect();
    void stream.publish(
      "context-a",
      createLocationSample({
        latitude: 10,
        longitude: 20,
        timestamp: Date.now(),
        accuracy: 15,
      }),
    );
    stream.markStale();
    stream.reconnect();

    expect(stream.getConnectionState()).toBe("CONNECTED");
    expect(updates.length).toBeGreaterThan(0);
  });

  it("supports map-facing location state from a single source", () => {
    const controller = createMapLocationController();

    controller.setLocation(
      createLocationSample({
        latitude: 50,
        longitude: 60,
        timestamp: Date.now(),
        accuracy: 10,
      }),
    );

    expect(controller.getCurrentLocation()?.latitude).toBe(50);
    expect(controller.isFollowing()).toBe(false);
  });
});
