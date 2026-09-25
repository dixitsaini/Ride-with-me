import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  signOut,
  type Auth,
} from "firebase/auth";
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  goOffline,
  ref,
  set,
  type Database,
} from "firebase/database";
import { clearPermissionSources } from "../permissions";
import { createInMemoryAppStateSource } from "./appStateSource";
import type {
  BackgroundLocationService,
  BackgroundLocationState,
} from "./backgroundLocation";
import { pushBackgroundLocation } from "./backgroundSink";
import { FirebaseRealtimeLocationAdapter } from "./FirebaseRealtimeLocationAdapter";
import type {
  LocationSample,
  LocationSamplePublisher,
  RealtimeLocationUpdate,
} from "./index";
import { createLocationEngine, type LocationEngine } from "./LocationEngine";
import {
  createPersistentLocationBuffer,
  type LocationBufferStorage,
} from "./persistentBuffer";
import { createFakeLocationProvider } from "./testing/fakeLocationProvider";
import type { FakeLocationProvider } from "./testing/fakeLocationProvider";

jest.mock("../firebase/config", () => ({
  getFirebaseApp: jest.fn(),
}));

const projectId = "rider-app-emulator";
// The emulator applies `database.rules.json` to the project's default
// namespace; pointing at it is what a real `databaseURL` resolves to.
const databaseUrl = "http://127.0.0.1:9000?ns=rider-app-emulator-default-rtdb";
const staleThresholdMs = 500;

type LocationClient = {
  app: FirebaseApp;
  auth: Auth;
  database: Database;
  userId: string;
  realtime: FirebaseRealtimeLocationAdapter;
};

const apps: FirebaseApp[] = [];
const clients: LocationClient[] = [];

async function createClient(name: string): Promise<LocationClient> {
  const app = initializeApp(
    {
      apiKey: "emulator-api-key",
      authDomain: "localhost",
      databaseURL: databaseUrl,
      projectId,
      appId: `${name}-app-id`,
    },
    name,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await signInAnonymously(auth);
  const database = getDatabase(app);
  connectDatabaseEmulator(database, "127.0.0.1", 9000);
  const realtime = new FirebaseRealtimeLocationAdapter({
    database,
    identity: {
      async getIdentity() {
        return { userId: credential.user.uid };
      },
    },
    staleThresholdMs,
  });

  const client: LocationClient = {
    app,
    auth,
    database,
    userId: credential.user.uid,
    realtime,
  };
  clients.push(client);
  return client;
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for emulator-backed realtime state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMemoryStorage(): LocationBufferStorage {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

function createBackgroundStub(): BackgroundLocationService {
  let state: BackgroundLocationState = "STOPPED";
  return {
    isSupported: () => true,
    status: () => state,
    permissionState: async () => "GRANTED",
    requestPermission: async () => "GRANTED",
    start: async () => {
      state = "RUNNING";
      return state;
    },
    stop: async () => {
      state = "STOPPED";
    },
    getError: () => null,
  };
}

type EngineHarness = {
  engine: LocationEngine;
  provider: FakeLocationProvider;
  setReachable: (value: boolean) => void;
};

const engines: EngineHarness[] = [];

function createEngine(
  client: LocationClient,
  contextId: string,
): EngineHarness {
  let reachable = true;
  const publisher: LocationSamplePublisher = {
    publish: async (sample) => {
      await client.realtime.publish(contextId, sample);
    },
    isReachable: () => reachable,
    getConnectionState: () => client.realtime.getConnectionState(),
  };
  const provider = createFakeLocationProvider({
    permission: "GRANTED",
    servicesEnabled: true,
    grantOnRequest: true,
  });
  const engine = createLocationEngine({
    provider,
    buffer: createPersistentLocationBuffer({
      storage: createMemoryStorage(),
    }),
    publisher,
    appStateSource: createInMemoryAppStateSource("foreground"),
    background: createBackgroundStub(),
  });
  const harness: EngineHarness = {
    engine,
    provider,
    setReachable: (value) => {
      reachable = value;
    },
  };
  engines.push(harness);
  return harness;
}

function record(overrides: Partial<LocationSample> = {}): LocationSample {
  return {
    latitude: 40.7128,
    longitude: -74.006,
    timestamp: Date.now(),
    accuracy: 10,
    source: "gps",
    ...overrides,
  };
}

let clientA: LocationClient;
let clientB: LocationClient;

beforeAll(async () => {
  clientA = await createClient("two-client-a");
  clientB = await createClient("two-client-b");
});

afterAll(async () => {
  clients.forEach((client) => client.realtime.dispose());
  // Signing out cancels Firebase Auth's proactive token refresh timer, and
  // goOffline closes the Realtime Database socket; without both the process
  // keeps a ref'd handle open and Jest never exits.
  await Promise.all(clients.map((client) => signOut(client.auth)));
  clients.forEach((client) => goOffline(client.database));
  await Promise.all(apps.map((app) => deleteApp(app)));
});

afterEach(() => {
  while (engines.length > 0) {
    engines.pop()?.engine.dispose();
  }
  clearPermissionSources();
});

function createContextId(name: string): string {
  return `ctx-${name}-${Date.now()}`;
}

it("delivers a background location sample from Client A's engine to Client B", async () => {
  const contextId = createContextId("background-delivery");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const updates: RealtimeLocationUpdate[] = [];
  const unsubscribe = clientB.realtime.subscribe(contextId, (update) => {
    updates.push(update);
  });
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  const harness = createEngine(clientA, contextId);
  await harness.engine.startTracking();
  await harness.engine.startBackgroundUpdates();

  const expected = record({
    latitude: 40.758,
    longitude: -73.9855,
    accuracy: 12,
  });
  pushBackgroundLocation(expected);
  await harness.engine.settled();

  await waitFor(() => updates.length > 0);
  const update = updates.find(
    (entry) => entry.userId === clientA.userId && !entry.stale,
  );
  expect(update).toBeDefined();
  expect(update?.contextId).toBe(contextId);
  expect(update?.location.latitude).toBe(expected.latitude);
  expect(update?.location.longitude).toBe(expected.longitude);
  expect(update?.location.timestamp).toBe(expected.timestamp);
  expect(update?.location.accuracy).toBe(expected.accuracy);
  unsubscribe();
});

it("reports an old location as stale to the subscriber", async () => {
  const contextId = createContextId("staleness");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const updates: RealtimeLocationUpdate[] = [];
  const unsubscribe = clientB.realtime.subscribe(contextId, (update) => {
    updates.push(update);
  });
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  await clientA.realtime.publish(
    contextId,
    record({ timestamp: Date.now() - 5_000 }),
  );

  await waitFor(() => updates.some((entry) => entry.stale));
  const stale = updates.find((entry) => entry.stale);
  expect(stale?.userId).toBe(clientA.userId);
  expect(stale?.stale).toBe(true);
  unsubscribe();
});

it("flushes buffered samples to Client B once the publisher is reachable", async () => {
  const contextId = createContextId("offline-buffer");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const updates: RealtimeLocationUpdate[] = [];
  const unsubscribe = clientB.realtime.subscribe(contextId, (update) => {
    updates.push(update);
  });
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  const harness = createEngine(clientA, contextId);
  await harness.engine.startTracking();
  harness.setReachable(false);

  const first = record({ latitude: 40.7, timestamp: Date.now() });
  const second = record({ latitude: 40.71, timestamp: Date.now() + 1 });
  harness.provider.emit({
    latitude: first.latitude,
    timestamp: first.timestamp,
  });
  harness.provider.emit({
    latitude: second.latitude,
    timestamp: second.timestamp,
  });
  await harness.engine.settled();

  expect(harness.engine.getPendingLocationCount()).toBe(2);
  expect(updates).toHaveLength(0);

  harness.setReachable(true);
  await harness.engine.flush();
  await harness.engine.settled();

  await waitFor(() => updates.length >= 2);
  expect(updates.map((entry) => entry.location.latitude).sort()).toEqual([
    first.latitude,
    second.latitude,
  ]);
  expect(harness.engine.getPendingLocationCount()).toBe(0);
  unsubscribe();
});

it("does not let a client read a context it has no access to", async () => {
  const contextId = createContextId("unreadable");
  await clientA.realtime.authorizeContext(contextId);
  await clientA.realtime.publish(contextId, record());

  await expect(
    get(ref(clientB.database, `liveLocations/${contextId}`)),
  ).rejects.toThrow();
});

it("does not let a client write another user's location", async () => {
  const contextId = createContextId("foreign-write");
  await clientA.realtime.authorizeContext(contextId);

  await expect(
    set(
      ref(
        clientB.database,
        `liveLocations/${contextId}/locations/${clientA.userId}`,
      ),
      {
        latitude: 1,
        longitude: 2,
        timestamp: Date.now(),
        accuracy: 5,
      },
    ),
  ).rejects.toThrow();
});

it("does not let a client write its own location without access", async () => {
  const contextId = createContextId("no-access-write");

  await expect(
    set(
      ref(
        clientB.database,
        `liveLocations/${contextId}/locations/${clientB.userId}`,
      ),
      {
        latitude: 1,
        longitude: 2,
        timestamp: Date.now(),
        accuracy: 5,
      },
    ),
  ).rejects.toThrow();
});

it("rejects an out-of-range location payload", async () => {
  const contextId = createContextId("invalid-payload");
  await clientA.realtime.authorizeContext(contextId);

  await expect(
    set(
      ref(
        clientA.database,
        `liveLocations/${contextId}/locations/${clientA.userId}`,
      ),
      {
        latitude: 999,
        longitude: 2,
        timestamp: Date.now(),
        accuracy: 5,
      },
    ),
  ).rejects.toThrow();
});

it("stops delivering to a client whose access has been removed", async () => {
  const contextId = createContextId("revoked");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const updates: RealtimeLocationUpdate[] = [];
  const unsubscribe = clientB.realtime.subscribe(contextId, (update) => {
    updates.push(update);
  });
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");
  await clientA.realtime.publish(contextId, record({ latitude: 40.72 }));
  await waitFor(() => updates.length > 0);

  await clientB.realtime.revokeContext(contextId);
  const access = await get(
    ref(
      clientA.database,
      `liveLocations/${contextId}/access/${clientB.userId}`,
    ),
  );
  expect(access.exists()).toBe(false);

  const deliveredBefore = updates.length;
  await clientA.realtime.publish(
    contextId,
    record({ latitude: 40.73, timestamp: Date.now() + 1 }),
  );
  await delay(300);
  expect(updates.length).toBe(deliveredBefore);
  unsubscribe();
});

it("does not emit a duplicate update when an identical sample is republished", async () => {
  const contextId = createContextId("dedupe");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const updates: RealtimeLocationUpdate[] = [];
  const unsubscribe = clientB.realtime.subscribe(contextId, (update) => {
    updates.push(update);
  });
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  const sample = record({ latitude: 40.8, timestamp: Date.now() });
  await clientA.realtime.publish(contextId, sample);
  await waitFor(() => updates.length > 0);
  const delivered = updates.length;

  await clientA.realtime.publish(contextId, sample);
  await delay(300);
  expect(updates.length).toBe(delivered);
  unsubscribe();
});

it("lets both clients observe each other's latest position", async () => {
  const contextId = createContextId("mutual");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const seenByB: RealtimeLocationUpdate[] = [];
  const unsubscribe = clientB.realtime.subscribe(contextId, (update) => {
    seenByB.push(update);
  });
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  const harness = createEngine(clientA, contextId);
  await harness.engine.startTracking();
  harness.provider.emit({ latitude: 40.75, timestamp: Date.now() });
  await harness.engine.settled();

  await clientB.realtime.publish(contextId, record({ latitude: 41.85 }));

  await waitFor(
    () =>
      seenByB.some(
        (entry) => entry.userId === clientA.userId && !entry.stale,
      ) &&
      seenByB.some((entry) => entry.userId === clientB.userId && !entry.stale),
  );

  const stored = await get(
    ref(clientA.database, `liveLocations/${contextId}/locations`),
  );
  const value = stored.val() as Record<string, { latitude: number }>;
  expect(Object.keys(value).sort()).toEqual(
    [clientA.userId, clientB.userId].sort(),
  );
  expect(value[clientB.userId].latitude).toBe(41.85);
  unsubscribe();
});

it("keeps the newest position when an older fix arrives late", async () => {
  const contextId = createContextId("ordering");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const updates: RealtimeLocationUpdate[] = [];
  const unsubscribe = clientB.realtime.subscribe(contextId, (update) => {
    updates.push(update);
  });
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  const harness = createEngine(clientA, contextId);
  await harness.engine.startTracking();

  const newerTimestamp = Date.now();
  harness.provider.emit({ latitude: 40.9, timestamp: newerTimestamp });
  await harness.engine.settled();
  await waitFor(() =>
    updates.some((entry) => entry.location.latitude === 40.9),
  );

  harness.provider.emit({ latitude: 40.1, timestamp: newerTimestamp - 30_000 });
  await harness.engine.settled();
  await delay(300);

  expect(harness.engine.getLatestSample()?.latitude).toBe(40.9);

  const stored = await get(
    ref(
      clientA.database,
      `liveLocations/${contextId}/locations/${clientA.userId}`,
    ),
  );
  expect((stored.val() as { latitude: number }).latitude).toBe(40.9);
  unsubscribe();
});

it("moves a subscriber from stale back to fresh when a new fix arrives", async () => {
  const contextId = createContextId("stale-recovery");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const updates: RealtimeLocationUpdate[] = [];
  const unsubscribe = clientB.realtime.subscribe(contextId, (update) => {
    updates.push(update);
  });
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  await clientA.realtime.publish(
    contextId,
    record({ latitude: 40.6, timestamp: Date.now() - 5_000 }),
  );
  await waitFor(() => updates.some((entry) => entry.stale));

  await clientA.realtime.publish(
    contextId,
    record({ latitude: 40.61, timestamp: Date.now() }),
  );
  await waitFor(
    () =>
      updates.some(
        (entry) => entry.location.latitude === 40.61 && !entry.stale,
      ),
    5000,
  );

  expect(
    updates
      .filter((entry) => entry.location.latitude === 40.61)
      .every((entry) => !entry.stale),
  ).toBe(true);
  unsubscribe();
});

it("shares one realtime subscription between listeners and tears it down with the last one", async () => {
  const contextId = createContextId("ref-count");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const first: RealtimeLocationUpdate[] = [];
  const second: RealtimeLocationUpdate[] = [];
  const stopFirst = clientB.realtime.subscribe(contextId, (update) =>
    first.push(update),
  );
  const stopSecond = clientB.realtime.subscribe(contextId, (update) =>
    second.push(update),
  );
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  await clientA.realtime.publish(contextId, record({ latitude: 40.77 }));
  await waitFor(() => first.length > 0 && second.length > 0);

  stopFirst();
  const deliveredToFirst = first.length;
  await clientA.realtime.publish(
    contextId,
    record({ latitude: 40.78, timestamp: Date.now() + 1_000 }),
  );
  await waitFor(() => second.length > 1);
  expect(first.length).toBe(deliveredToFirst);

  stopSecond();
  expect(clientB.realtime.getConnectionState()).toBe("DISCONNECTED");

  const deliveredToSecond = second.length;
  await clientA.realtime.publish(
    contextId,
    record({ latitude: 40.79, timestamp: Date.now() + 2_000 }),
  );
  await delay(300);
  expect(second.length).toBe(deliveredToSecond);
});

it("keeps delivering after the subscriber reconnects", async () => {
  const contextId = createContextId("reconnect");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const updates: RealtimeLocationUpdate[] = [];
  const unsubscribe = clientB.realtime.subscribe(contextId, (update) => {
    updates.push(update);
  });
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  await clientA.realtime.publish(contextId, record({ latitude: 40.74 }));
  await waitFor(() => updates.length > 0);

  clientB.realtime.disconnect();
  expect(clientB.realtime.getConnectionState()).toBe("DISCONNECTED");

  clientB.realtime.connect();
  await waitFor(() => clientB.realtime.getConnectionState() === "CONNECTED");

  await clientA.realtime.publish(
    contextId,
    record({ latitude: 40.745, timestamp: Date.now() + 1_000 }),
  );
  await waitFor(() =>
    updates.some((entry) => entry.location.latitude === 40.745),
  );
  unsubscribe();
});

it("does not let a second client bootstrap access on a context it does not own", async () => {
  const contextId = createContextId("owner-claim");
  await clientB.realtime.authorizeContext(contextId);

  await expect(
    clientA.realtime.authorizeContext(contextId, [clientA.userId]),
  ).rejects.toThrow();
});

it("does not let a participant grant itself access on someone else's context", async () => {
  const contextId = createContextId("self-grant");
  await clientA.realtime.authorizeContext(contextId);

  await expect(
    set(
      ref(
        clientB.database,
        `liveLocations/${contextId}/access/${clientB.userId}`,
      ),
      true,
    ),
  ).rejects.toThrow();
});

it("lets the owner grant a whole roster in one write and revoke it again", async () => {
  const contextId = createContextId("roster");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  const granted = await get(
    ref(clientB.database, `liveLocations/${contextId}`),
  );
  expect(granted.child("owner").val()).toBe(clientA.userId);
  expect(granted.child(`access/${clientB.userId}`).val()).toBe(true);

  await clientA.realtime.revokeContext(contextId, [clientB.userId]);
  const revoked = await get(
    ref(clientA.database, `liveLocations/${contextId}/access/${clientB.userId}`),
  );
  expect(revoked.exists()).toBe(false);

  const owner = await get(
    ref(clientA.database, `liveLocations/${contextId}/owner`),
  );
  expect(owner.val()).toBe(clientA.userId);
});

it("does not let a participant revoke another participant's access", async () => {
  const contextId = createContextId("foreign-revoke");
  await clientA.realtime.authorizeContext(contextId, [clientB.userId]);

  await expect(
    set(
      ref(
        clientB.database,
        `liveLocations/${contextId}/access/${clientA.userId}`,
      ),
      null,
    ),
  ).rejects.toThrow();

  const owner = await get(
    ref(clientA.database, `liveLocations/${contextId}/access/${clientA.userId}`),
  );
  expect(owner.exists()).toBe(true);
});
