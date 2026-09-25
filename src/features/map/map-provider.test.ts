import {
  createMockMapProvider,
  createRealMapProvider,
  type MapProviderHandle,
  type RiderMarker,
} from "./index";

function riderMarker(
  riderId: string,
  overrides: Partial<RiderMarker> = {},
): RiderMarker {
  return {
    riderId,
    label: `Rider ${riderId}`,
    displayName: null,
    coordinate: { latitude: 1, longitude: 2 },
    timestamp: 1000,
    heading: null,
    state: "LIVE",
    isCurrentUser: false,
    ...overrides,
  };
}

const providers: [string, () => MapProviderHandle][] = [
  ["mock provider", () => createMockMapProvider()],
  ["real provider", () => createRealMapProvider()],
];

describe.each(providers)("%s", (_name, create) => {
  it("starts uninitialized and becomes ready after initialize", () => {
    const provider = create();
    const onReady = jest.fn();

    expect(provider.isReady()).toBe(false);
    provider.initialize({ onReady });

    expect(provider.isReady()).toBe(true);
    expect(onReady).toHaveBeenCalledTimes(1);
    provider.dispose();
  });

  it("ignores initialize after dispose", () => {
    const provider = create();
    provider.initialize();
    provider.dispose();
    provider.initialize();

    expect(provider.isReady()).toBe(false);
  });

  it("adds a rider marker", () => {
    const provider = create();
    provider.initialize();

    provider.upsertRider(riderMarker("rider-a"));

    expect(provider.getState().riders).toHaveLength(1);
    expect(provider.getState().riders[0]?.riderId).toBe("rider-a");
    provider.dispose();
  });

  it("updates an existing marker in place instead of appending", () => {
    const provider = create();
    provider.initialize();
    provider.upsertRider(riderMarker("rider-a"));

    provider.upsertRider(
      riderMarker("rider-a", {
        coordinate: { latitude: 9, longitude: 9 },
        timestamp: 2000,
        state: "STALE",
      }),
    );

    expect(provider.getState().riders).toHaveLength(1);
    expect(provider.getState().riders[0]).toMatchObject({
      coordinate: { latitude: 9, longitude: 9 },
      timestamp: 2000,
      state: "STALE",
    });
    provider.dispose();
  });

  it("prevents duplicate markers for the same rider", () => {
    const provider = create();
    provider.initialize();

    provider.upsertRider(riderMarker("rider-a"));
    provider.upsertRider(riderMarker("rider-a"));
    provider.upsertRider(riderMarker("rider-a", { state: "STALE" }));

    const ids = provider.getState().riders.map((marker) => marker.riderId);
    expect(ids).toEqual(["rider-a"]);
    provider.dispose();
  });

  it("removes a rider marker", () => {
    const provider = create();
    provider.initialize();
    provider.upsertRider(riderMarker("rider-a"));
    provider.upsertRider(riderMarker("rider-b"));

    provider.removeRider("rider-a");

    expect(provider.getState().riders.map((marker) => marker.riderId)).toEqual([
      "rider-b",
    ]);
    provider.dispose();
  });

  it("keeps markers ordered deterministically regardless of arrival order", () => {
    const provider = create();
    provider.initialize();

    provider.upsertRider(riderMarker("rider-c"));
    provider.upsertRider(riderMarker("rider-a"));
    provider.upsertRider(riderMarker("rider-b"));

    expect(provider.getState().riders.map((marker) => marker.riderId)).toEqual([
      "rider-a",
      "rider-b",
      "rider-c",
    ]);
    provider.dispose();
  });

  it("keeps the current rider out of the shared rider list", () => {
    const provider = create();
    provider.initialize();

    provider.upsertRider(riderMarker("me", { isCurrentUser: true }));
    provider.upsertRider(riderMarker("rider-a"));

    expect(provider.getState().currentRider?.riderId).toBe("me");
    expect(provider.getState().riders.map((marker) => marker.riderId)).toEqual([
      "rider-a",
    ]);
    provider.dispose();
  });

  it("notifies subscribers on every change and supports unsubscribe", () => {
    const provider = create();
    provider.initialize();
    const listener = jest.fn();
    const unsubscribe = provider.subscribe(listener);

    provider.upsertRider(riderMarker("rider-a"));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    provider.removeRider("rider-a");
    expect(listener).toHaveBeenCalledTimes(1);
    provider.dispose();
  });

  it("returns a stable snapshot until something changes", () => {
    const provider = create();
    provider.initialize();
    const first = provider.getState();

    expect(provider.getState()).toBe(first);

    provider.upsertRider(riderMarker("rider-a"));
    expect(provider.getState()).not.toBe(first);
    provider.dispose();
  });

  it("clears every entity on dispose and stops accepting updates", () => {
    const provider = create();
    provider.initialize();
    provider.upsertRider(riderMarker("rider-a"));
    provider.upsertPolyline({
      id: "path-a",
      coordinates: [{ latitude: 1, longitude: 1 }],
    });
    provider.upsertAnnotation({
      id: "pin-a",
      coordinate: { latitude: 1, longitude: 1 },
    });

    provider.dispose();

    expect(provider.getState()).toMatchObject({
      ready: false,
      currentRider: null,
      riders: [],
      polylines: [],
      annotations: [],
    });

    provider.upsertRider(riderMarker("rider-b"));
    expect(provider.getState().riders).toHaveLength(0);
  });
});
