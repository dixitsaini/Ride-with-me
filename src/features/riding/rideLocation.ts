import type {
  LocationController,
  LocationSamplePublisher,
  RealtimeLocationService,
} from "../../core/location";
import type { Ride } from "./domain";

export type RideLocationLifecycleOptions = {
  locationController: LocationController;
  realtime: RealtimeLocationService;
};

export type RideLocationLifecycle = {
  onRideStarted: (ride: Ride) => Promise<void>;
  onRidePaused: (ride: Ride) => Promise<void>;
  onRideResumed: (ride: Ride) => Promise<void>;
  onRideEnded: (ride: Ride) => Promise<void>;
  onNoActiveRide: () => Promise<void>;
  getActiveRideId: () => string | null;
};

function publisherFor(
  realtime: RealtimeLocationService,
  contextId: string,
): LocationSamplePublisher {
  return {
    publish: (sample) => realtime.publish(contextId, sample),
    isReachable: () => {
      const connection = realtime.getConnectionState();
      return connection !== "DISCONNECTED" && connection !== "ERROR";
    },
    getConnectionState: () => realtime.getConnectionState(),
  };
}

/**
 * Owns every location side effect of a ride lifecycle.
 *
 * The ride domain stays declarative: it says *what* the ride is doing, this
 * module translates that into `core/location` calls. Every transition is
 * idempotent, so replaying a ride snapshot (reconnect, rehydrate) neither
 * restarts tracking nor re-prompts for permission.
 */
export function createRideLocationLifecycle(
  options: RideLocationLifecycleOptions,
): RideLocationLifecycle {
  const { locationController, realtime } = options;
  let activeRideId: string | null = null;
  let tracking = false;

  async function publishRoster(ride: Ride): Promise<void> {
    realtime.connect();
    locationController.setPublisher?.(publisherFor(realtime, ride.contextId));
    locationController.setContext?.({ rideState: "ACTIVE" });
    await realtime.authorizeContext?.(ride.contextId, ride.participantIds);
  }

  async function stopPublishing(): Promise<void> {
    await locationController.stopBackgroundUpdates?.();
    if (tracking) {
      await locationController.stopTracking();
      tracking = false;
    }
    locationController.setPublisher?.(null);
  }

  return {
    async onRideStarted(ride) {
      if (activeRideId === ride.id && tracking) {
        locationController.setContext?.({ rideState: "ACTIVE" });
        return;
      }
      activeRideId = ride.id;
      await publishRoster(ride);
      await locationController.startTracking();
      tracking = true;
      await locationController.startBackgroundUpdates?.({
        requestPermission: true,
      });
    },

    async onRidePaused(ride) {
      if (activeRideId !== ride.id) {
        return;
      }
      locationController.setContext?.({ rideState: "PAUSED" });
      await locationController.pauseTracking?.();
    },

    async onRideResumed(ride) {
      if (activeRideId !== ride.id) {
        activeRideId = ride.id;
        await publishRoster(ride);
        if (!tracking) {
          await locationController.startTracking();
          tracking = true;
        }
      }
      locationController.setContext?.({ rideState: "ACTIVE" });
      await locationController.resumeTracking?.();
      await locationController.startBackgroundUpdates?.({
        requestPermission: false,
      });
    },

    async onRideEnded(ride) {
      if (activeRideId !== ride.id) {
        return;
      }
      locationController.setContext?.({ rideState: "COMPLETED" });
      await stopPublishing();
      await realtime.revokeContext?.(ride.contextId, ride.participantIds);
      realtime.disconnect();
      activeRideId = null;
    },

    async onNoActiveRide() {
      if (!activeRideId) {
        return;
      }
      await stopPublishing();
      activeRideId = null;
    },

    getActiveRideId: () => activeRideId,
  };
}
