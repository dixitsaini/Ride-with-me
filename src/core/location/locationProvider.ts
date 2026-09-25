import {
  createExpoBackgroundLocationService,
  createUnsupportedBackgroundLocationService,
  type BackgroundLocationService,
} from "./backgroundLocation";
import { ExpoLocationAdapter } from "./ExpoLocationAdapter";
import { createMockLocationService, type LocationService } from "./index";

export type LocationProviderKind = "real" | "mock";

export function getConfiguredLocationProviderKind(): LocationProviderKind {
  return process.env.EXPO_PUBLIC_LOCATION_PROVIDER === "mock" ? "mock" : "real";
}

export function createLocationProvider(
  kind: LocationProviderKind = getConfiguredLocationProviderKind(),
): LocationService {
  if (kind === "mock") {
    return createMockLocationService();
  }

  return new ExpoLocationAdapter();
}

export function createBackgroundLocationProvider(
  kind: LocationProviderKind = getConfiguredLocationProviderKind(),
): BackgroundLocationService {
  if (kind === "mock") {
    return createUnsupportedBackgroundLocationService(
      "Background location is not available with the mock location provider.",
    );
  }

  return createExpoBackgroundLocationService();
}
