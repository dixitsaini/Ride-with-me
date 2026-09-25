import type { RealtimeLocationUpdate } from "../../core/location";
import {
  createMapController,
  createMockMapProvider,
  type MapController,
} from "./index";

function update(
  userId: string,
  overrides: Partial<RealtimeLocationUpdate> = {},
): RealtimeLocationUpdate {
  return {
    contextId: "context-a",
    userId,
    location: {
      latitude: 40.5,
      longitude: -74.25,
      timestamp: 1_700_000_000_000,
      accuracy: 5,
      heading: 12,
    },
    stale: false,
    ...overrides,
  };
}

function setup(): MapController {
  const map = createMapController({
    provider: createMockMapProvider(),
    currentRiderId: "me",
  });
  map.initialize();
  return map;
}

describe("map state integration", () => {
  it("moves a realtime rider update into map state", () => {
    const map = setup();

    map.applyRiderUpdate(update("rider-a"));

    expect(map.getState().riders).toHaveLength(1);
    expect(map.getState().riders[0]).toMatchObject({
      riderId: "rider-a",
      state: "LIVE",
      coordinate: { latitude: 40.5, longitude: -74.25 },
    });
    map.dispose();
  });

  it("moves a stale realtime rider into map state as stale", () => {
    const map = setup();

    map.applyRiderUpdate(update("rider-a", { stale: true }));

    expect(map.getState().riders[0]?.state).toBe("STALE");
    map.dispose();
  });

  it("removes the marker when a rider goes away", () => {
    const map = setup();
    map.applyRiderUpdate(update("rider-a"));
    map.applyRiderUpdate(update("rider-b"));

    map.removeRider("rider-a");

    expect(map.getState().riders.map((marker) => marker.riderId)).toEqual([
      "rider-b",
    ]);
    map.dispose();
  });

  it("keeps one authoritative marker for the current rider", () => {
    const map = setup();

    map.applyRiderUpdate(update("me"));
    map.applyRiderUpdate(update("me"));
    map.setCurrentRiderLocation({
      sample: { latitude: 1, longitude: 2, timestamp: 3, accuracy: 4 },
      freshness: "FRESH",
    });

    expect(map.getState().riders).toHaveLength(0);
    expect(map.getState().currentRider?.riderId).toBe("me");
    map.dispose();
  });

  it("moves current rider location state into map state", () => {
    const map = setup();

    map.setCurrentRiderLocation(null);
    expect(map.getState().currentRider?.state).toBe("UNAVAILABLE");

    map.setCurrentRiderLocation({
      sample: { latitude: 10, longitude: 20, timestamp: 30, accuracy: 4 },
      freshness: "FRESH",
    });
    expect(map.getState().currentRider).toMatchObject({
      state: "LIVE",
      coordinate: { latitude: 10, longitude: 20 },
      timestamp: 30,
    });
    map.dispose();
  });

  it("surfaces realtime connection state on the map", () => {
    const map = setup();
    expect(map.getState().connection).toBe("DISCONNECTED");

    map.setConnectionState("CONNECTING");
    map.setConnectionState("CONNECTED");

    expect(map.getState().connection).toBe("CONNECTED");

    map.setConnectionState("RECONNECTING");
    expect(map.getState().connection).toBe("RECONNECTING");
    map.dispose();
  });

  it("publishes camera mode changes into map state", () => {
    const map = setup();
    map.applyRiderUpdate(
      update("me", {
        location: { latitude: 1, longitude: 1, timestamp: 1, accuracy: 1 },
      }),
    );

    map.setCameraMode("FOLLOW_USER");

    expect(map.getState().camera).toMatchObject({
      mode: "FOLLOW_USER",
      following: true,
      region: { latitude: 1, longitude: 1 },
    });
    map.dispose();
  });

  it("lets a manual camera gesture take ownership away from follow mode", () => {
    const map = setup();
    map.setCameraMode("FOLLOW_USER");

    map.notifyUserCameraGesture({
      latitude: 50,
      longitude: 60,
      latitudeDelta: 1,
      longitudeDelta: 1,
    });

    expect(map.getState().camera.mode).toBe("FREE");
    expect(map.getState().camera.following).toBe(false);
    map.dispose();
  });

  it("falls back when the selected rider is removed", () => {
    const map = setup();
    map.applyRiderUpdate(
      update("rider-b", {
        location: { latitude: 3, longitude: 4, timestamp: 1, accuracy: 1 },
      }),
    );
    map.setCameraMode("FOLLOW_SELECTED_RIDER", {
      selectedRiderId: "rider-b",
    });
    expect(map.getState().camera.mode).toBe("FOLLOW_SELECTED_RIDER");

    map.removeRider("rider-b");

    expect(map.getState().camera.mode).toBe("FOLLOW_USER");
    expect(map.getState().riders).toHaveLength(0);
    map.dispose();
  });

  it("tracks viewport state", () => {
    const map = setup();
    const viewport = {
      region: {
        latitude: 1,
        longitude: 2,
        latitudeDelta: 0.1,
        longitudeDelta: 0.1,
      },
    };

    map.setViewport(viewport);

    expect(map.getState().viewport).toEqual(viewport);
    map.dispose();
  });

  it("notifies subscribers whenever the map changes", () => {
    const map = setup();
    const listener = jest.fn();
    const unsubscribe = map.subscribe(listener);

    map.applyRiderUpdate(update("rider-a"));
    map.setConnectionState("CONNECTED");

    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    map.applyRiderUpdate(update("rider-b"));
    expect(listener).toHaveBeenCalledTimes(2);
    map.dispose();
  });

  it("initializes only once", () => {
    const provider = createMockMapProvider();
    const initialize = jest.spyOn(provider, "initialize");
    const map = createMapController({ provider, currentRiderId: "me" });

    map.initialize();
    map.initialize();

    expect(initialize).toHaveBeenCalledTimes(1);
    map.dispose();
  });

  it("stops accepting updates and clears state after dispose", () => {
    const map = setup();

    map.applyRiderUpdate(update("rider-a"));
    map.dispose();

    expect(map.getState()).toMatchObject({
      ready: false,
      riders: [],
      currentRider: null,
    });

    map.applyRiderUpdate(update("rider-b"));
    map.setConnectionState("CONNECTED");
    map.setCameraMode("FOLLOW_RIDE");

    expect(map.getState().riders).toHaveLength(0);
    expect(map.getState().connection).toBe("DISCONNECTED");
    expect(map.getState().camera.mode).toBe("FREE");
  });

  it("never reaches for location or realtime on its own", () => {
    const map = setup();

    expect(map.getState().riders).toHaveLength(0);
    expect(map.getState().currentRider).toBeNull();

    // The controller only exposes feeds that the owning screen drives.
    expect(map).not.toHaveProperty("startTracking");
    expect(map).not.toHaveProperty("subscribeRideLocations");
    expect(map).not.toHaveProperty("publish");
    map.dispose();
  });
});
