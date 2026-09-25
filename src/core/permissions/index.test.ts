import {
  clearPermissionSources,
  getPermissionStatus,
  hasPermissionSource,
  registerPermissionSource,
  requestPermission,
  type PermissionStatus,
} from "./index";

describe("permission registry", () => {
  afterEach(() => {
    clearPermissionSources();
  });

  it("reports unavailable when no source is registered", async () => {
    await expect(getPermissionStatus("location")).resolves.toBe("unavailable");
    await expect(requestPermission("location")).resolves.toBe("unavailable");
    expect(hasPermissionSource("location")).toBe(false);
  });

  it("does not fabricate an undetermined status", async () => {
    expect(
      (await getPermissionStatus("notifications")) as PermissionStatus,
    ).not.toBe("undetermined");
  });

  it("reads status from the registered source", async () => {
    const unregister = registerPermissionSource("location", {
      getStatus: async () => "granted",
    });

    expect(hasPermissionSource("location")).toBe(true);
    await expect(getPermissionStatus("location")).resolves.toBe("granted");

    unregister();
    expect(hasPermissionSource("location")).toBe(false);
    await expect(getPermissionStatus("location")).resolves.toBe("unavailable");
  });

  it("requests through the source when a request handler exists", async () => {
    const request = jest.fn(async (): Promise<PermissionStatus> => "granted");
    registerPermissionSource("location", {
      getStatus: async () => "undetermined",
      request,
    });

    await expect(requestPermission("location")).resolves.toBe("granted");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("falls back to status when the source cannot request", async () => {
    registerPermissionSource("camera", { getStatus: async () => "blocked" });

    await expect(requestPermission("camera")).resolves.toBe("blocked");
  });

  it("swallows source failures instead of throwing", async () => {
    registerPermissionSource("microphone", {
      getStatus: async () => {
        throw new Error("boom");
      },
      request: async () => {
        throw new Error("boom");
      },
    });

    await expect(getPermissionStatus("microphone")).resolves.toBe(
      "unavailable",
    );
    await expect(requestPermission("microphone")).resolves.toBe("unavailable");
  });

  it("unregistering a stale source does not drop a newer registration", () => {
    const first = registerPermissionSource("location", {
      getStatus: async () => "denied",
    });
    registerPermissionSource("location", { getStatus: async () => "granted" });

    first();

    expect(hasPermissionSource("location")).toBe(true);
  });
});
