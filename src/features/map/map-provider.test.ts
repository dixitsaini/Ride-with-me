import { createMockMapProvider, createRealMapProvider } from "./index";

describe("map provider", () => {
  it("creates a development-safe provider that tracks markers and follow mode", () => {
    const provider = createMockMapProvider();
    provider.renderMarker(
      { latitude: 1, longitude: 2, timestamp: Date.now(), accuracy: 5 },
      "a",
    );
    provider.followLocation(true);

    expect(provider.getState().markers[0]?.id).toBe("a");
    expect(provider.getState().following).toBe(true);
  });

  it("exposes a real map adapter behind the same contract", () => {
    const provider = createRealMapProvider();

    expect(provider).toBeDefined();
    expect(typeof provider.setCamera).toBe("function");
    expect(typeof provider.updateLocation).toBe("function");
  });
});
