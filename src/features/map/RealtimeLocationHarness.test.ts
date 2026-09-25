import {
  createMockLocationStream,
  createLocationSample,
} from "../../core/location";
import { createRealtimeLocationHarness } from "./RealtimeLocationHarness";
import { createMapController, createMockMapProvider } from "./index";

describe("realtime location map harness", () => {
  it("connects publisher updates to map-facing state", async () => {
    const realtime = createMockLocationStream();
    const map = createMapController({ provider: createMockMapProvider() });
    map.initialize();
    const harness = createRealtimeLocationHarness(realtime, map, "context-a");
    realtime.connect();
    harness.refreshConnection();
    const location = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp: Date.now(),
      accuracy: 5,
    });

    await harness.publishClientALocation(location);

    expect(map.getState().riders[0]).toMatchObject({
      riderId: "mock-user",
      state: "LIVE",
      coordinate: { latitude: 1, longitude: 2 },
    });
    expect(map.getState().connection).toBe("CONNECTED");
    harness.stop();
    map.dispose();
  });

  it("marks a stale realtime update as stale on the map", async () => {
    const realtime = createMockLocationStream();
    const map = createMapController({ provider: createMockMapProvider() });
    map.initialize();
    const harness = createRealtimeLocationHarness(realtime, map, "context-a");
    realtime.connect();
    realtime.markStale();

    await harness.publishClientALocation(
      createLocationSample({
        latitude: 3,
        longitude: 4,
        timestamp: Date.now(),
        accuracy: 5,
      }),
    );

    expect(map.getState().riders[0]?.state).toBe("STALE");
    expect(map.getState().connection).toBe("STALE");
    harness.stop();
    map.dispose();
  });

  it("stops feeding the map after stop()", async () => {
    const realtime = createMockLocationStream();
    const map = createMapController({ provider: createMockMapProvider() });
    map.initialize();
    const harness = createRealtimeLocationHarness(realtime, map, "context-a");
    realtime.connect();

    harness.stop();
    await harness.publishClientALocation(
      createLocationSample({
        latitude: 5,
        longitude: 6,
        timestamp: Date.now(),
        accuracy: 5,
      }),
    );

    expect(map.getState().riders).toHaveLength(0);
    map.dispose();
  });
});
