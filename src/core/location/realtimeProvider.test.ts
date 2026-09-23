import {
  createRealtimeLocationService,
  getConfiguredRealtimeProviderKind,
} from "./realtimeProvider";

jest.mock("firebase/database", () => ({
  getDatabase: jest.fn(),
  onValue: jest.fn(),
  ref: jest.fn(),
  set: jest.fn(),
}));

jest.mock("firebase/app", () => ({
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: "test-app" })),
}));

describe("realtime provider selection", () => {
  afterEach(() => {
    delete process.env.EXPO_PUBLIC_REALTIME_PROVIDER;
  });

  it("defaults to the mock provider", () => {
    expect(getConfiguredRealtimeProviderKind()).toBe("mock");
    expect(createRealtimeLocationService()).toBeDefined();
  });

  it("selects Firebase only when configured and supplied an identity boundary", () => {
    process.env.EXPO_PUBLIC_REALTIME_PROVIDER = "firebase";
    const service = createRealtimeLocationService("firebase", {
      identity: { getIdentity: jest.fn(async () => ({ userId: "user-a" })) },
      database: {} as never,
    });

    expect(service.getConnectionState()).toBe("DISCONNECTED");
    expect(() => createRealtimeLocationService("firebase")).toThrow(
      "identity service",
    );
  });
});
