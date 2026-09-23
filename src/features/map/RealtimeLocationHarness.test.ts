import {
  createMockLocationStream,
  createLocationSample,
} from "../../core/location";
import { createRealtimeLocationHarness } from "./RealtimeLocationHarness";
import { createMockMapProvider } from "./index";

describe("realtime location map harness", () => {
  it("connects publisher updates to map-facing state", async () => {
    const realtime = createMockLocationStream();
    const map = createMockMapProvider();
    const harness = createRealtimeLocationHarness(realtime, map, "context-a");
    const location = createLocationSample({
      latitude: 1,
      longitude: 2,
      timestamp: Date.now(),
      accuracy: 5,
    });

    await harness.publishClientALocation(location);

    expect(map.getState().markers[0]).toMatchObject({
      id: "mock-user",
      location,
    });
    harness.stop();
  });
});
