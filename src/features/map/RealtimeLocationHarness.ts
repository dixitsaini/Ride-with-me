import type {
  LocationSample,
  RealtimeLocationService,
} from "../../core/location";
import type { MapProvider } from "./index";

export function createRealtimeLocationHarness(
  realtime: RealtimeLocationService,
  map: MapProvider,
  contextId: string,
) {
  const stop = realtime.subscribe(contextId, (update) => {
    map.renderMarker(update.location, update.userId);
    map.updateLocation(update.location);
  });

  return {
    publishClientALocation(location: LocationSample) {
      return realtime.publish(contextId, location);
    },
    stop,
  };
}
