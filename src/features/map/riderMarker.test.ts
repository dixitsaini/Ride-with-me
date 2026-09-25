import type { RealtimeLocationUpdate } from "../../core/location";
import {
  createMapController,
  createMockMapProvider,
  type MapController,
} from "./index";
import { createRiderFallbackLabel } from "./identity";

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
      heading: 270,
    },
    stale: false,
    ...overrides,
  };
}

function createController(
  options: Partial<Parameters<typeof createMapController>[0]> = {},
): MapController {
  const controller = createMapController({
    provider: createMockMapProvider(),
    currentRiderId: "me",
    ...options,
  });
  controller.initialize();
  return controller;
}

describe("rider marker model", () => {
  it("transforms a realtime update into a map-ready rider marker", () => {
    const map = createController();

    const marker = map.applyRiderUpdate(update("rider-a"));

    expect(marker).toEqual({
      riderId: "rider-a",
      label: createRiderFallbackLabel("rider-a"),
      displayName: null,
      coordinate: { latitude: 40.5, longitude: -74.25 },
      timestamp: 1_700_000_000_000,
      heading: 270,
      state: "LIVE",
      isCurrentUser: false,
    });
    expect(map.getState().riders[0]).toEqual(marker);
    map.dispose();
  });

  it("never surfaces the raw rider id as the marker label", () => {
    const map = createController();

    const marker = map.applyRiderUpdate(update("firebase-uid-123456"));

    expect(marker.label).not.toBe("firebase-uid-123456");
    expect(marker.riderId).toBe("firebase-uid-123456");
    map.dispose();
  });

  it("resolves a stable label for the same rider", () => {
    const map = createController();

    const first = map.applyRiderUpdate(update("rider-a"));
    const second = map.applyRiderUpdate(update("rider-a"));

    expect(second.label).toBe(first.label);
    map.dispose();
  });

  it("uses a display name when a profile source supplies one", () => {
    const map = createController({
      displayNameResolver: (riderId) =>
        riderId === "rider-a" ? "  Dana  " : undefined,
    });

    const named = map.applyRiderUpdate(update("rider-a"));
    const unnamed = map.applyRiderUpdate(update("rider-b"));

    expect(named.displayName).toBe("Dana");
    expect(named.label).toBe("Dana");
    expect(unnamed.displayName).toBeNull();
    expect(unnamed.label).not.toBe("rider-b");
    map.dispose();
  });

  it("keeps a stale rider distinguishable from a live rider", () => {
    const map = createController();

    map.applyRiderUpdate(update("rider-a"));
    map.applyRiderUpdate(update("rider-b", { stale: true }));

    const states = new Map(
      map.getState().riders.map((marker) => [marker.riderId, marker.state]),
    );

    expect(states.get("rider-a")).toBe("LIVE");
    expect(states.get("rider-b")).toBe("STALE");
    map.dispose();
  });

  it("takes freshness from the realtime state instead of recomputing it", () => {
    const map = createController();
    const longAgo = Date.now() - 10 * 60 * 1000;

    const marker = map.applyRiderUpdate(
      update("rider-a", {
        stale: false,
        location: {
          latitude: 1,
          longitude: 2,
          timestamp: longAgo,
          accuracy: 5,
        },
      }),
    );

    expect(marker.state).toBe("LIVE");
    expect(marker.timestamp).toBe(longAgo);
    map.dispose();
  });

  it("passes the heading through when the source provides one", () => {
    const map = createController();

    const withHeading = map.applyRiderUpdate(update("rider-a"));
    const withoutHeading = map.applyRiderUpdate(
      update("rider-b", {
        location: {
          latitude: 1,
          longitude: 2,
          timestamp: 1,
          accuracy: 5,
        },
      }),
    );

    expect(withHeading.heading).toBe(270);
    expect(withoutHeading.heading).toBeNull();
    map.dispose();
  });

  it("marks the current rider from local location state", () => {
    const map = createController();

    map.setCurrentRiderLocation({
      sample: {
        latitude: 10,
        longitude: 20,
        timestamp: 1_700_000_000_000,
        accuracy: 4,
        heading: 90,
      },
      freshness: "FRESH",
    });

    expect(map.getState().currentRider).toEqual({
      riderId: "me",
      label: createRiderFallbackLabel("me"),
      displayName: null,
      coordinate: { latitude: 10, longitude: 20 },
      timestamp: 1_700_000_000_000,
      heading: 90,
      state: "LIVE",
      isCurrentUser: true,
    });
    map.dispose();
  });

  it("marks the current rider stale from the location state freshness", () => {
    const map = createController();

    map.setCurrentRiderLocation({
      sample: {
        latitude: 10,
        longitude: 20,
        timestamp: Date.now(),
        accuracy: 4,
      },
      freshness: "STALE",
    });

    expect(map.getState().currentRider?.state).toBe("STALE");
    map.dispose();
  });

  it("marks the current rider unavailable when there is no sample", () => {
    const map = createController();

    map.setCurrentRiderLocation(null);

    expect(map.getState().currentRider).toMatchObject({
      riderId: "me",
      coordinate: null,
      timestamp: null,
      state: "UNAVAILABLE",
      isCurrentUser: true,
    });
    map.dispose();
  });

  it("seeds the current rider from realtime until local state speaks", () => {
    const map = createController();

    map.applyRiderUpdate(update("me"));

    expect(map.getState().currentRider?.state).toBe("LIVE");
    expect(map.getState().riders).toHaveLength(0);
    map.dispose();
  });

  it("keeps local location state authoritative over realtime echoes", () => {
    const map = createController();

    map.setCurrentRiderLocation({
      sample: {
        latitude: 1,
        longitude: 1,
        timestamp: 100,
        accuracy: 3,
      },
      freshness: "STALE",
    });
    map.applyRiderUpdate(
      update("me", {
        stale: false,
        location: { latitude: 5, longitude: 5, timestamp: 200, accuracy: 3 },
      }),
    );

    expect(map.getState().currentRider).toMatchObject({
      coordinate: { latitude: 1, longitude: 1 },
      state: "STALE",
    });
    map.dispose();
  });

  it("allows realtime to reseed the current rider after it is removed", () => {
    const map = createController();

    map.setCurrentRiderLocation({
      sample: { latitude: 1, longitude: 1, timestamp: 100, accuracy: 3 },
      freshness: "FRESH",
    });
    map.removeRider("me");
    expect(map.getState().currentRider).toBeNull();

    map.applyRiderUpdate(update("me"));

    expect(map.getState().currentRider?.state).toBe("LIVE");
    map.dispose();
  });

  it("does nothing for the current rider when no rider id is configured", () => {
    const provider = createMockMapProvider();
    const map = createMapController({ provider });
    map.initialize();

    map.setCurrentRiderLocation({
      sample: { latitude: 1, longitude: 1, timestamp: 1, accuracy: 1 },
      freshness: "FRESH",
    });

    expect(map.getState().currentRider).toBeNull();
    map.dispose();
  });
});
