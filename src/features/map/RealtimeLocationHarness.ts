import type {
  LocationSample,
  RealtimeLocationService,
} from "../../core/location";
import type { MapController } from "./MapController";

/**
 * Bridges an existing `RealtimeLocationService` into map state.
 *
 * The harness owns no location and no connection logic of its own: it only
 * forwards updates produced by the realtime layer and mirrors that layer's
 * connection state onto the map.
 */
export function createRealtimeLocationHarness(
  realtime: RealtimeLocationService,
  map: MapController,
  contextId: string,
) {
  const syncConnection = () => {
    map.setConnectionState(realtime.getConnectionState());
  };

  syncConnection();
  const stop = realtime.subscribe(contextId, (update) => {
    syncConnection();
    map.applyRiderUpdate(update);
  });

  return {
    publishClientALocation(location: LocationSample) {
      return realtime.publish(contextId, location);
    },
    refreshConnection: syncConnection,
    stop,
  };
}
