import type { LocationBufferState, LocationSample } from "./index";

export type LocationBufferSnapshot = {
  pending: number;
  state: LocationBufferState;
  lastSyncedAt: number | null;
  lastReconciledAt: number | null;
  lastError: string | null;
  dropped: number;
};

export type BufferedLocationSample = LocationSample & {
  id: string;
  publishable: boolean;
  attempts: number;
  createdAt: number;
  lastAttemptAt: number | null;
  lastError: string | null;
};

export type LocationBufferEntryState =
  "PENDING" | "SYNCING" | "FAILED" | "RECONCILED";

export type LocationBufferStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type LocationBufferRetention = {
  maxSamples: number;
  maxAgeMs: number;
};

export type LocationBufferOptions = {
  storage?: LocationBufferStorage;
  storageKey?: string;
  retention?: Partial<LocationBufferRetention>;
  now?: () => number;
};

export type LocationBuffer = {
  load: () => Promise<void>;
  append: (
    sample: LocationSample,
    publishable: boolean,
  ) => Promise<BufferedLocationSample | null>;
  pending: () => BufferedLocationSample[];
  pendingCount: () => number;
  markSyncing: (id: string) => Promise<void>;
  markSynced: (id: string) => Promise<void>;
  markReconciled: (id: string) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  clear: () => Promise<void>;
  state: () => LocationBufferState;
  snapshot: () => LocationBufferSnapshot;
};

export const DEFAULT_LOCATION_BUFFER_RETENTION: LocationBufferRetention = {
  maxSamples: 1_000,
  maxAgeMs: 24 * 60 * 60 * 1_000,
};

const DEFAULT_STORAGE_KEY = "location.buffer.v1";

export function createMemoryLocationBufferStorage(): LocationBufferStorage {
  const values = new Map<string, string>();
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

async function resolveDefaultStorage(): Promise<LocationBufferStorage> {
  try {
    // Deferred so importing this module never pulls in the native storage
    // module before a buffer actually needs to persist.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { storage } = require("../storage") as typeof import("../storage");
    return storage;
  } catch {
    return createMemoryLocationBufferStorage();
  }
}

function parseStored(raw: string | null): BufferedLocationSample[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is BufferedLocationSample =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as BufferedLocationSample).latitude === "number" &&
        typeof (entry as BufferedLocationSample).longitude === "number" &&
        typeof (entry as BufferedLocationSample).timestamp === "number" &&
        typeof (entry as BufferedLocationSample).id === "string",
    );
  } catch {
    return [];
  }
}

export function createPersistentLocationBuffer(
  options: LocationBufferOptions = {},
): LocationBuffer {
  const now = options.now ?? Date.now;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const retention: LocationBufferRetention = {
    ...DEFAULT_LOCATION_BUFFER_RETENTION,
    ...options.retention,
  };

  let storage: LocationBufferStorage | null = options.storage ?? null;
  let entries: BufferedLocationSample[] = [];
  let loaded = false;
  let lastSyncedAt: number | null = null;
  let lastReconciledAt: number | null = null;
  let lastError: string | null = null;
  let dropped = 0;
  let writeChain: Promise<void> = Promise.resolve();

  const state = (): LocationBufferState => {
    if (lastError && entries.length === 0) {
      return "ERROR";
    }
    return entries.length === 0 ? "EMPTY" : "PENDING";
  };

  const snapshot = (): LocationBufferSnapshot => ({
    pending: entries.length,
    state: state(),
    lastSyncedAt,
    lastReconciledAt,
    lastError,
    dropped,
  });

  const serialize = () => JSON.stringify(entries);

  const persist = (): Promise<void> => {
    writeChain = writeChain
      .then(async () => {
        if (!storage) {
          storage = await resolveDefaultStorage();
        }
        if (entries.length === 0) {
          await storage.removeItem(storageKey);
          return;
        }
        await storage.setItem(storageKey, serialize());
        lastError = null;
      })
      .catch((error: unknown) => {
        lastError =
          error instanceof Error ? error.message : "buffer write failed";
      });
    return writeChain;
  };

  const applyRetention = () => {
    const cutoff = now() - retention.maxAgeMs;
    const before = entries.length;
    entries = entries.filter((entry) => entry.createdAt >= cutoff);
    dropped += before - entries.length;

    if (entries.length > retention.maxSamples) {
      const overflow = entries.length - retention.maxSamples;
      entries.splice(0, overflow);
      dropped += overflow;
    }
  };

  return {
    async load() {
      if (loaded) {
        return;
      }
      loaded = true;
      try {
        if (!storage) {
          storage = await resolveDefaultStorage();
        }
        const raw = await storage.getItem(storageKey);
        entries = parseStored(raw).sort((a, b) => a.timestamp - b.timestamp);
        applyRetention();
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "buffer read failed";
        entries = [];
      }
    },

    async append(sample, publishable) {
      if (!loaded) {
        await this.load();
      }

      const duplicate = entries.some(
        (entry) =>
          entry.timestamp === sample.timestamp &&
          entry.latitude === sample.latitude &&
          entry.longitude === sample.longitude,
      );
      if (duplicate) {
        return null;
      }

      const newest = entries[entries.length - 1];
      if (newest && sample.timestamp <= newest.timestamp) {
        return null;
      }

      const entry: BufferedLocationSample = {
        ...sample,
        id: `${sample.timestamp}-${Math.random().toString(36).slice(2, 10)}`,
        publishable,
        attempts: 0,
        createdAt: now(),
        lastAttemptAt: null,
        lastError: null,
      };

      entries.push(entry);
      applyRetention();
      const retained = entries.includes(entry);
      if (retained) {
        await persist();
      }
      return retained ? entry : null;
    },

    pending() {
      return [...entries].sort((a, b) => a.timestamp - b.timestamp);
    },

    pendingCount() {
      return entries.length;
    },

    async markSyncing(id) {
      const entry = entries.find((item) => item.id === id);
      if (entry) {
        entry.lastAttemptAt = now();
        entry.attempts += 1;
        await persist();
      }
    },

    async markSynced(id) {
      const index = entries.findIndex((item) => item.id === id);
      if (index >= 0) {
        entries.splice(index, 1);
        lastSyncedAt = now();
        lastError = null;
        await persist();
      }
    },

    async markReconciled(id) {
      const index = entries.findIndex((item) => item.id === id);
      if (index >= 0) {
        entries.splice(index, 1);
        lastReconciledAt = now();
        await persist();
      }
    },

    async markFailed(id, error) {
      const entry = entries.find((item) => item.id === id);
      if (entry) {
        entry.lastAttemptAt = now();
        entry.attempts += 1;
        entry.lastError = error;
        await persist();
      }
    },

    async clear() {
      entries = [];
      lastSyncedAt = null;
      lastReconciledAt = null;
      lastError = null;
      dropped = 0;
      if (!storage) {
        storage = await resolveDefaultStorage();
      }
      await storage.removeItem(storageKey);
    },

    state,

    snapshot,
  };
}
