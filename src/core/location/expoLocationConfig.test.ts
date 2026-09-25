import { readFileSync } from "fs";
import { join } from "path";

type ExpoPluginEntry = string | [string, Record<string, unknown>];

type ExpoConfig = {
  expo?: {
    plugins?: ExpoPluginEntry[];
    android?: { permissions?: string[] };
  };
};

const APP_JSON_PATH = join(__dirname, "..", "..", "..", "app.json");

function readExpoConfig(): ExpoConfig {
  return JSON.parse(readFileSync(APP_JSON_PATH, "utf8")) as ExpoConfig;
}

function locationPluginConfig(): Record<string, unknown> {
  const plugins = readExpoConfig().expo?.plugins ?? [];
  for (const entry of plugins) {
    if (Array.isArray(entry) && entry[0] === "expo-location") {
      return entry[1] ?? {};
    }
    if (entry === "expo-location") {
      return {};
    }
  }
  throw new Error("expo-location is not configured in app.json");
}

/**
 * Guards the native location configuration this feature depends on.
 *
 * The values here decide what the OS will even allow at build time: whether
 * iOS prompts for Always, whether Android gets a manifest background
 * permission, and whether a foreground service is declared. A silent revert
 * of any of them breaks background tracking with no runtime error, so they
 * are asserted rather than left to review.
 */
describe("app.json expo-location configuration", () => {
  it("declares the expo-location config plugin", () => {
    expect(() => locationPluginConfig()).not.toThrow();
  });

  it("keeps both iOS permission descriptions user-facing and non-empty", () => {
    const config = locationPluginConfig();

    for (const key of [
      "locationWhenInUsePermission",
      "locationAlwaysAndWhenInUsePermission",
      "locationAlwaysPermission",
    ]) {
      const description = config[key];
      expect(typeof description).toBe("string");
      expect((description as string).trim().length).toBeGreaterThan(0);
      expect((description as string).toLowerCase()).toContain("location");
    }
  });

  it("enables iOS background (Always) location", () => {
    expect(locationPluginConfig().isIosBackgroundLocationEnabled).toBe(true);
  });

  it("declares the Android foreground service and skips the manifest background permission", () => {
    const config = locationPluginConfig();

    // Android background delivery runs inside the foreground service, so the
    // ACCESS_BACKGROUND_LOCATION manifest entry must stay out of the build.
    expect(config.isAndroidForegroundServiceEnabled).toBe(true);
    expect(config.isAndroidBackgroundLocationEnabled).toBe(false);
  });

  it("requests only the coarse and fine location permissions from Android", () => {
    const permissions = readExpoConfig().expo?.android?.permissions ?? [];

    expect(permissions).toEqual([
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ]);
    expect(permissions).not.toContain(
      "android.permission.ACCESS_BACKGROUND_LOCATION",
    );
  });
});
