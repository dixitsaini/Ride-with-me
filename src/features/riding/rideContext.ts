import type {
  ConnectionState,
  LocationController,
  RealtimeLocationService,
} from "../../core/location";
import { createLogger } from "../../core/logger";
import {
  currentRiderLocationFromEngineStatus,
  type MapController,
} from "../map";
import type { GroupMember, Ride, RideState } from "./domain";
import type { RidingRepository } from "./repository";
import {
  createRideLocationLifecycle,
  type RideLocationLifecycle,
} from "./rideLocation";

export type RideContextEventType =
  | "RIDE_STARTED"
  | "RIDE_PAUSED"
  | "RIDE_RESUMED"
  | "RIDE_ENDED"
  | "PARTICIPANT_JOINED"
  | "PARTICIPANT_REMOVED"
  | "ACCESS_REVOKED";

export type RideContextEvent = {
  type: RideContextEventType;
  /** Affected participant for membership events; omitted otherwise. */
  userId?: string;
  rideId: string;
};

export type RideContextState = {
  ride: Ride | null;
  /** Participants that are still active group members (and so may be seen). */
  authorizedRiderIds: string[];
  connection: ConnectionState;
};

export type RideContext = {
  start: () => Promise<void>;
  getState: () => RideContextState;
  subscribe: (
    listener: (state: RideContextState, event: RideContextEvent | null) => void,
  ) => () => void;
  destroy: () => void;
};

export type RideContextOptions = {
  rideId: string;
  userId: string;
  repository: RidingRepository;
  realtime: RealtimeLocationService;
  locationController: LocationController;
  map?: MapController | null;
  lifecycle?: RideLocationLifecycle;
};

const TERMINAL_STATES: RideState[] = ["COMPLETED", "CANCELLED"];

function isTerminal(state: RideState): boolean {
  return TERMINAL_STATES.includes(state);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

/**
 * Binds one ride to the location engine, the realtime location feed and (when
 * supplied) the map controller.
 *
 * Authorization model: a participant is only *visible* while it is both on the
 * ride roster and an active member of the group. Losing either side removes
 * the participant from the map immediately, and a rider that loses its own
 * access revokes its realtime context on the spot instead of waiting for the
 * ride to end.
 */
export function createRideContext(options: RideContextOptions): RideContext {
  const { rideId, userId, repository, realtime, locationController, map } =
    options;
  const lifecycle =
    options.lifecycle ??
    createRideLocationLifecycle({ locationController, realtime });
  const log = createLogger("riding.rideContext");

  const listeners = new Set<
    (state: RideContextState, event: RideContextEvent | null) => void
  >();
  const teardowns: (() => void)[] = [];
  let stopRealtime: (() => void) | null = null;
  let queue: Promise<void> = Promise.resolve();
  let destroyed = false;
  let started = false;
  let ride: Ride | null = null;
  let members: GroupMember[] = [];
  let authorized: string[] = [];

  const state = (): RideContextState => ({
    ride,
    authorizedRiderIds: [...authorized],
    connection: realtime.getConnectionState(),
  });

  const emit = (event: RideContextEvent | null = null): void => {
    const snapshot = state();
    listeners.forEach((listener) => listener(snapshot, event));
  };

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((error) => {
      log.warn("context update failed", { reason: reasonOf(error) });
    });
    return queue;
  };

  const activeMemberIds = (): Set<string> =>
    new Set(
      members
        .filter((member) => member.status === "ACTIVE")
        .map((member) => member.userId),
    );

  const computeAuthorized = (): string[] => {
    if (!ride || isTerminal(ride.state)) {
      return [];
    }
    const active = activeMemberIds();
    return ride.participantIds.filter((id) => active.has(id));
  };

  const removeMarkers = (userIds: string[]): void => {
    if (!map) {
      return;
    }
    userIds.filter((id) => id !== userId).forEach((id) => map.removeRider(id));
  };

  async function syncAuthorization(): Promise<void> {
    const previous = authorized;
    const next = computeAuthorized();
    const added = next.filter((id) => !previous.includes(id));
    const removed = previous.filter((id) => !next.includes(id));
    authorized = next;

    if (ride && !isTerminal(ride.state) && ride.createdBy === userId) {
      try {
        await realtime.authorizeContext?.(ride.contextId, next);
      } catch (error) {
        log.warn("roster grant failed", { reason: reasonOf(error) });
      }
    }

    if (ride && !isTerminal(ride.state) && !next.includes(userId)) {
      try {
        await realtime.revokeContext?.(ride.contextId);
      } catch (error) {
        log.warn("self revoke failed", { reason: reasonOf(error) });
      }
      map?.removeRider(userId);
      emit({ type: "ACCESS_REVOKED", rideId });
      return;
    }

    removeMarkers(removed);
    removed.forEach((id) =>
      emit({ type: "PARTICIPANT_REMOVED", userId: id, rideId }),
    );
    added.forEach((id) =>
      emit({ type: "PARTICIPANT_JOINED", userId: id, rideId }),
    );
  }

  function ensureRealtimeSubscription(): void {
    if (stopRealtime || !ride || isTerminal(ride.state)) {
      return;
    }
    stopRealtime = realtime.subscribe(ride.contextId, (update) => {
      if (destroyed || !authorized.includes(update.userId)) {
        return;
      }
      map?.setConnectionState(realtime.getConnectionState());
      map?.applyRiderUpdate(update);
    });
    map?.setConnectionState(realtime.getConnectionState());
  }

  function stopRealtimeSubscription(): void {
    stopRealtime?.();
    stopRealtime = null;
  }

  async function applyRide(next: Ride | null, initial: boolean): Promise<void> {
    const previous = ride;
    ride = next;

    if (!next) {
      if (previous && !isTerminal(previous.state)) {
        await lifecycle.onNoActiveRide();
        stopRealtimeSubscription();
        emit({ type: "RIDE_ENDED", rideId });
      }
      return;
    }

    const previousState = previous?.state ?? null;
    if (initial) {
      if (next.state === "ACTIVE") {
        await lifecycle.onRideStarted(next);
        emit({ type: "RIDE_STARTED", rideId });
      } else if (next.state === "PAUSED") {
        await lifecycle.onRideStarted(next);
        await lifecycle.onRidePaused(next);
        emit({ type: "RIDE_PAUSED", rideId });
      }
    } else if (previousState !== next.state) {
      if (next.state === "ACTIVE" && previousState === "PAUSED") {
        await lifecycle.onRideResumed(next);
        emit({ type: "RIDE_RESUMED", rideId });
      } else if (next.state === "ACTIVE") {
        await lifecycle.onRideStarted(next);
        emit({ type: "RIDE_STARTED", rideId });
      } else if (next.state === "PAUSED") {
        await lifecycle.onRidePaused(next);
        emit({ type: "RIDE_PAUSED", rideId });
      } else if (isTerminal(next.state)) {
        await lifecycle.onRideEnded(next);
        stopRealtimeSubscription();
        removeMarkers(authorized);
        authorized = [];
        emit({ type: "RIDE_ENDED", rideId });
        return;
      }
    }

    ensureRealtimeSubscription();
    await syncAuthorization();
  }

  async function applyMembers(next: GroupMember[]): Promise<void> {
    members = next;
    await syncAuthorization();
  }

  function bindMap(): void {
    if (!map) {
      return;
    }
    if (locationController.subscribeToEngineStatus) {
      teardowns.push(
        locationController.subscribeToEngineStatus((status) =>
          map.setCurrentRiderLocation(
            currentRiderLocationFromEngineStatus(status),
          ),
        ),
      );
      return;
    }
    teardowns.push(
      locationController.subscribeToLocationChanges((sample) =>
        map.setCurrentRiderLocation({
          sample,
          freshness: locationController.getStatus().freshness,
        }),
      ),
    );
  }

  return {
    async start() {
      if (started || destroyed) {
        return;
      }
      started = true;

      let firstRide = true;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        teardowns.push(
          repository.subscribeToRide(
            rideId,
            (next) => {
              if (firstRide) {
                firstRide = false;
                settled = true;
                enqueue(() => applyRide(next, true)).then(resolve, reject);
                return;
              }
              void enqueue(() => applyRide(next, false));
            },
            (error) => {
              if (!settled) {
                settled = true;
                reject(error);
              }
            },
          ),
        );
      });
      if (destroyed) {
        return;
      }

      const groupId = ride?.groupId;
      if (groupId) {
        let firstMembers = true;
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          teardowns.push(
            repository.subscribeToMembers(
              groupId,
              (next) => {
                if (firstMembers) {
                  firstMembers = false;
                  settled = true;
                  enqueue(() => applyMembers(next)).then(resolve, reject);
                  return;
                }
                void enqueue(() => applyMembers(next));
              },
              (error) => {
                if (!settled) {
                  settled = true;
                  reject(error);
                }
              },
            ),
          );
        });
        if (destroyed) {
          return;
        }
      }

      bindMap();
      emit(null);
    },

    getState: state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      stopRealtimeSubscription();
      teardowns.splice(0).forEach((teardown) => teardown());
      listeners.clear();
      removeMarkers(authorized);
      authorized = [];
      ride = null;
      members = [];
      started = false;
    },
  };
}
