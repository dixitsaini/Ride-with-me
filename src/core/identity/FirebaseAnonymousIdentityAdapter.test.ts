import { signInAnonymously } from "firebase/auth";
import { FirebaseAnonymousIdentityAdapter } from "./FirebaseAnonymousIdentityAdapter";

jest.mock("firebase/auth", () => ({
  getAuth: jest.fn(),
  signInAnonymously: jest.fn(async () => ({ user: { uid: "anonymous-user" } })),
}));

jest.mock("../firebase/config", () => ({
  getFirebaseApp: jest.fn(() => ({ name: "test-app" })),
}));

describe("FirebaseAnonymousIdentityAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a stable authenticated development identity", async () => {
    const auth = { currentUser: null };
    const adapter = new FirebaseAnonymousIdentityAdapter(auth as never);

    await expect(adapter.getIdentity()).resolves.toEqual({
      userId: "anonymous-user",
    });
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("reuses the current Firebase user", async () => {
    const auth = { currentUser: { uid: "existing-user" } };
    const adapter = new FirebaseAnonymousIdentityAdapter(auth as never);

    await expect(adapter.getIdentity()).resolves.toEqual({
      userId: "existing-user",
    });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});
