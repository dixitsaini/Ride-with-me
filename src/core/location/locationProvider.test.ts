import { ExpoLocationAdapter } from "./ExpoLocationAdapter";
import {
  createLocationProvider,
  getConfiguredLocationProviderKind,
} from "./locationProvider";

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: "granted",
  })),
  hasServicesEnabledAsync: jest.fn(async () => true),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 1, longitude: 2, accuracy: 5 },
    timestamp: 1700000000000,
  })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
}));

describe("location provider", () => {
  const original = process.env.EXPO_PUBLIC_LOCATION_PROVIDER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.EXPO_PUBLIC_LOCATION_PROVIDER;
    } else {
      process.env.EXPO_PUBLIC_LOCATION_PROVIDER = original;
    }
  });

  it("defaults to the real provider", () => {
    delete process.env.EXPO_PUBLIC_LOCATION_PROVIDER;

    expect(getConfiguredLocationProviderKind()).toBe("real");
    expect(createLocationProvider()).toBeInstanceOf(ExpoLocationAdapter);
  });

  it("keeps the real provider unless mock is explicitly requested", () => {
    process.env.EXPO_PUBLIC_LOCATION_PROVIDER = "real";

    expect(getConfiguredLocationProviderKind()).toBe("real");
    expect(createLocationProvider()).toBeInstanceOf(ExpoLocationAdapter);
  });

  it("returns the mock only when configured for it", () => {
    process.env.EXPO_PUBLIC_LOCATION_PROVIDER = "mock";

    expect(getConfiguredLocationProviderKind()).toBe("mock");
    const provider = createLocationProvider();
    expect(provider).not.toBeInstanceOf(ExpoLocationAdapter);
    expect(typeof provider.startTracking).toBe("function");
    expect(typeof provider.subscribe).toBe("function");
  });

  it("honours an explicit kind over the environment", () => {
    process.env.EXPO_PUBLIC_LOCATION_PROVIDER = "mock";

    expect(createLocationProvider("real")).toBeInstanceOf(ExpoLocationAdapter);
    expect(createLocationProvider("mock")).not.toBeInstanceOf(
      ExpoLocationAdapter,
    );
  });
});
