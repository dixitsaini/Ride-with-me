import { getApps, initializeApp } from "firebase/app";
import { getFirebaseApp, getFirebaseConfig } from "./config";

jest.mock("firebase/app", () => ({
  getApps: jest.fn(),
  initializeApp: jest.fn((options) => ({ name: "test-app", options })),
}));

describe("Firebase configuration", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY = "test-api-key";
    process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL =
      "https://test.firebaseio.com";
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = "test-project";
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID = "test-app-id";
    jest.clearAllMocks();
  });

  it("reads configuration from environment values", () => {
    expect(getFirebaseConfig()).toMatchObject({
      apiKey: "test-api-key",
      databaseURL: "https://test.firebaseio.com",
      projectId: "test-project",
      appId: "test-app-id",
    });
  });

  it("initializes exactly once when Fast Refresh reuses an existing app", () => {
    const getAppsMock = getApps as jest.MockedFunction<typeof getApps>;
    const initializeAppMock = initializeApp as jest.MockedFunction<
      typeof initializeApp
    >;
    getAppsMock.mockReturnValueOnce([]);

    const first = getFirebaseApp();
    getAppsMock.mockReturnValue([first]);
    const second = getFirebaseApp();

    expect(first).toBe(second);
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
  });
});
