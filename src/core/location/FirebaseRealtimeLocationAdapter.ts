import {
  getDatabase,
  onValue,
  ref,
  set,
  update,
  type Database,
  type DataSnapshot,
  type Unsubscribe,
} from "firebase/database";
import {
  DEFAULT_LOCATION_STALE_THRESHOLD_MS,
  isLocationStale,
  type ConnectionState,
  type LocationSample,
  type RealtimeLocationService,
  type RealtimeLocationUpdate,
} from "./index";
import { getFirebaseApp } from "../firebase/config";
import { createLogger } from "../logger";
import type { IdentityService } from "../identity";

export type FirebaseRealtimeLocationAdapterOptions = {
  database?: Database;
  identity: IdentityService;
  staleThresholdMs?: number;
};

type StoredLocation = {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number;
  speed?: number;
  heading?: number;
};

function normalizeLocation(value: unknown): LocationSample | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const latitude = record.latitude;
  const longitude = record.longitude;
  const timestamp = record.timestamp;
  const accuracy = record.accuracy;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    typeof timestamp !== "number" ||
    typeof accuracy !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(timestamp) ||
    !Number.isFinite(accuracy)
  ) {
    return null;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  return {
    latitude,
    longitude,
    timestamp,
    accuracy,
    ...(typeof record.speed === "number" ? { speed: record.speed } : {}),
    ...(typeof record.heading === "number" ? { heading: record.heading } : {}),
  };
}

export class FirebaseRealtimeLocationAdapter implements RealtimeLocationService {
  private readonly database: Database;
  private readonly identity: IdentityService;
  private readonly staleThresholdMs: number;
  private readonly listeners = new Map<
    string,
    Set<(update: RealtimeLocationUpdate) => void>
  >();
  private readonly subscriptions = new Map<string, Unsubscribe>();
  private readonly pendingSubscriptions = new Set<string>();
  private readonly staleTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private connectionState: ConnectionState = "DISCONNECTED";
  private lastPublishedKey: string | null = null;
  private connectionSubscription: Unsubscribe | null = null;
  private readonly log = createLogger("location.realtime");

  constructor(options: FirebaseRealtimeLocationAdapterOptions) {
    this.database = options.database ?? getDatabase(getFirebaseApp());
    this.identity = options.identity;
    this.staleThresholdMs =
      options.staleThresholdMs ?? DEFAULT_LOCATION_STALE_THRESHOLD_MS;
  }

  private setConnectionState(next: ConnectionState): void {
    if (this.connectionState === next) {
      return;
    }
    this.log.debug("connection state", {
      from: this.connectionState,
      to: next,
    });
    this.connectionState = next;
  }

  async publish(contextId: string, location: LocationSample): Promise<void> {
    const identity = await this.identity.getIdentity();
    const key = `${contextId}/${identity.userId}/${location.timestamp}/${location.latitude}/${location.longitude}`;
    if (key === this.lastPublishedKey) {
      return;
    }

    const record: StoredLocation = {
      latitude: location.latitude,
      longitude: location.longitude,
      timestamp: location.timestamp,
      accuracy: location.accuracy,
      ...(location.speed === undefined ? {} : { speed: location.speed }),
      ...(location.heading === undefined ? {} : { heading: location.heading }),
    };

    try {
      await set(
        ref(
          this.database,
          `liveLocations/${contextId}/locations/${identity.userId}`,
        ),
        record,
      );
      this.lastPublishedKey = key;
    } catch (error) {
      this.setConnectionState("ERROR");
      this.log.warn("publish failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      throw new Error(
        `Realtime location publish failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  async authorizeContext(
    contextId: string,
    participants: readonly string[] = [],
  ): Promise<void> {
    const identity = await this.identity.getIdentity();
    const contextReference = ref(this.database, `liveLocations/${contextId}`);
    const updates: Record<string, unknown> = {
      owner: identity.userId,
      [`access/${identity.userId}`]: true,
    };
    const seen = new Set<string>([identity.userId]);
    for (const participant of participants) {
      if (!participant || seen.has(participant)) {
        continue;
      }
      seen.add(participant);
      updates[`access/${participant}`] = true;
    }

    await update(contextReference, updates);
  }

  async revokeContext(
    contextId: string,
    participants?: readonly string[],
  ): Promise<void> {
    const identity = await this.identity.getIdentity();
    const targets =
      participants === undefined ? [identity.userId] : [...participants];
    const updates: Record<string, null> = {};
    const seen = new Set<string>();
    for (const participant of targets) {
      if (!participant || seen.has(participant)) {
        continue;
      }
      seen.add(participant);
      updates[`access/${participant}`] = null;
    }
    if (Object.keys(updates).length === 0) {
      return;
    }

    await update(ref(this.database, `liveLocations/${contextId}`), updates);
  }

  dispose(): void {
    this.disconnect();
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions.clear();
    this.listeners.clear();
    this.staleTimers.forEach((timer) => clearTimeout(timer));
    this.staleTimers.clear();
  }

  subscribe(
    contextId: string,
    listener: (update: RealtimeLocationUpdate) => void,
  ): () => void {
    const contextListeners = this.listeners.get(contextId) ?? new Set();
    contextListeners.add(listener);
    this.listeners.set(contextId, contextListeners);
    this.log.debug("subscribe", { listeners: contextListeners.size });

    if (
      !this.subscriptions.has(contextId) &&
      !this.pendingSubscriptions.has(contextId)
    ) {
      this.setConnectionState("CONNECTING");
      this.pendingSubscriptions.add(contextId);
      void this.identity
        .getIdentity()
        .then(() => {
          if (!this.listeners.has(contextId)) {
            return;
          }

          const contextReference = ref(
            this.database,
            `liveLocations/${contextId}`,
          );
          const unsubscribe = onValue(
            contextReference,
            (snapshot) => this.handleSnapshot(contextId, snapshot),
            () => {
              this.setConnectionState("ERROR");
            },
          );
          this.subscriptions.set(contextId, unsubscribe);
          this.setConnectionState("CONNECTED");
        })
        .catch(() => {
          this.setConnectionState("ERROR");
        })
        .finally(() => {
          this.pendingSubscriptions.delete(contextId);
        });
    }

    return () => {
      contextListeners.delete(listener);
      this.log.debug("unsubscribe", { listeners: contextListeners.size });
      if (contextListeners.size > 0) {
        return;
      }

      this.listeners.delete(contextId);
      this.subscriptions.get(contextId)?.();
      this.subscriptions.delete(contextId);
      this.pendingSubscriptions.delete(contextId);
      [...this.staleTimers.keys()]
        .filter((key) => key.startsWith(`${contextId}/`))
        .forEach((key) => {
          clearTimeout(this.staleTimers.get(key));
          this.staleTimers.delete(key);
        });
      if (this.subscriptions.size === 0) {
        this.setConnectionState("DISCONNECTED");
      }
    };
  }

  connect(): void {
    this.setConnectionState("CONNECTING");
    const connectedReference = ref(this.database, ".info/connected");
    this.connectionSubscription?.();
    this.connectionSubscription = onValue(connectedReference, (snapshot) => {
      this.setConnectionState(
        snapshot.val() === true ? "CONNECTED" : "RECONNECTING",
      );
    });
  }

  disconnect(): void {
    this.connectionSubscription?.();
    this.connectionSubscription = null;
    this.setConnectionState("DISCONNECTED");
  }

  reconnect(): void {
    this.setConnectionState("RECONNECTING");
    this.connect();
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  private handleSnapshot(contextId: string, snapshot: DataSnapshot): void {
    const snapshotValue = snapshot.val();
    const values =
      snapshotValue &&
      typeof snapshotValue === "object" &&
      "locations" in snapshotValue
        ? (snapshotValue as { locations: unknown }).locations
        : snapshotValue;
    if (!values || typeof values !== "object") {
      return;
    }

    Object.entries(values as Record<string, unknown>).forEach(
      ([userId, value]) => {
        const location = normalizeLocation(value);
        if (!location) {
          return;
        }

        const update: RealtimeLocationUpdate = {
          contextId,
          userId,
          location,
          stale: isLocationStale(location, this.staleThresholdMs),
        };
        const updateKey = `${contextId}/${userId}`;
        clearTimeout(this.staleTimers.get(updateKey));
        this.listeners.get(contextId)?.forEach((listener) => listener(update));

        if (!update.stale) {
          this.setConnectionState("CONNECTED");
          const delay = Math.max(
            0,
            this.staleThresholdMs - (Date.now() - location.timestamp),
          );
          this.staleTimers.set(
            updateKey,
            setTimeout(() => {
              const staleUpdate = { ...update, stale: true };
              this.setConnectionState("STALE");
              this.listeners
                .get(contextId)
                ?.forEach((listener) => listener(staleUpdate));
              this.staleTimers.delete(updateKey);
            }, delay),
          );
        }
      },
    );
  }
}

export { normalizeLocation };
