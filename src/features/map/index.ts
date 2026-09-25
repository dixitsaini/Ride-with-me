import { createMapProviderRuntime } from "./providerState";
import type { MapProviderHandle } from "./types";

export * from "./types";
export * from "./identity";
export {
  createMapCameraController,
  isSameMapRegion,
  regionAround,
  regionContaining,
} from "./camera";
export type {
  MapCameraController,
  MapCameraControllerOptions,
  MapCameraSetModeOptions,
} from "./camera";
export { createMapProviderRuntime };
export { createMapController } from "./MapController";
export type {
  CurrentRiderLocationInput,
  MapController,
  MapControllerOptions,
} from "./MapController";
export { currentRiderLocationFromEngineStatus } from "./MapController";

/** Development/test provider. Same contract, no native map behind it. */
export function createMockMapProvider(): MapProviderHandle {
  return createMapProviderRuntime("mock");
}

/** Production provider for the configured native map implementation. */
export function createRealMapProvider(): MapProviderHandle {
  return createMapProviderRuntime("react-native-maps");
}
