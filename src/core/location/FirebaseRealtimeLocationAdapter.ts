import {
  getDatabase,
  onValue,
  ref,
  set,
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

  constructor(options: FirebaseRealtimeLocationAdapterOptions) {
    this.database = options.database ?? getDatabase(getFirebaseApp());
    this.identity = options.identity;
    this.staleThresholdMs =
      options.staleThresholdMs ?? DEFAULT_LOCATION_STALE_THRESHOLD_MS;
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
      this.connectionState = "ERROR";
      throw new Error(
        `Realtime location publish failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  async authorizeContext(contextId: string): Promise<void> {
    const identity = await this.identity.getIdentity();
    await set(
      ref(
        this.database,
        `liveLocations/${contextId}/access/${identity.userId}`,
      ),
      true,
    );
  }

  async revokeContext(contextId: string): Promise<void> {
    const identity = await this.identity.getIdentity();
    await set(
      ref(
        this.database,
        `liveLocations/${contextId}/access/${identity.userId}`,
      ),
      null,
    );
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

    if (
      !this.subscriptions.has(contextId) &&
      !this.pendingSubscriptions.has(contextId)
    ) {
      this.connectionState = "CONNECTING";
      this.pendingSubscriptions.add(contextId);
      void this.identity
        .getIdentity()
        .then(() => this.authorizeContext(contextId))
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
              this.connectionState = "ERROR";
            },
          );
          this.subscriptions.set(contextId, unsubscribe);
          this.connectionState = "CONNECTED";
        })
        .catch(() => {
          this.connectionState = "ERROR";
        })
        .finally(() => {
          this.pendingSubscriptions.delete(contextId);
        });
    }

    return () => {
      contextListeners.delete(listener);
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
        this.connectionState = "DISCONNECTED";
      }
    };
  }

  connect(): void {
    this.connectionState = "CONNECTING";
    const connectedReference = ref(this.database, ".info/connected");
    this.connectionSubscription?.();
    this.connectionSubscription = onValue(connectedReference, (snapshot) => {
      this.connectionState =
        snapshot.val() === true ? "CONNECTED" : "RECONNECTING";
    });
  }

  disconnect(): void {
    this.connectionSubscription?.();
    this.connectionSubscription = null;
    this.connectionState = "DISCONNECTED";
  }

  reconnect(): void {
    this.connectionState = "RECONNECTING";
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
          this.connectionState = "CONNECTED";
          const delay = Math.max(
            0,
            this.staleThresholdMs - (Date.now() - location.timestamp),
          );
          this.staleTimers.set(
            updateKey,
            setTimeout(() => {
              const staleUpdate = { ...update, stale: true };
              this.connectionState = "STALE";
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
