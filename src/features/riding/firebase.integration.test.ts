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
  getDatabase,
  goOffline,
  ref,
  get,
  type Database,
} from "firebase/database";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";
import type { IdentityService } from "../../core/identity";
import {
  createMockLocationService,
  createLocationController,
} from "../../core/location";
import { FirebaseRealtimeLocationAdapter } from "../../core/location/FirebaseRealtimeLocationAdapter";
import { createDevelopmentEntitlements } from "./entitlements";
import { FirestoreRidingRepository } from "./FirestoreRidingRepository";
import { createRidingService, type RidingService } from "./service";

jest.mock("../../core/firebase/config", () => ({
  getFirebaseApp: jest.fn(),
}));

const projectId = "rider-app-emulator";
const databaseUrl = "http://127.0.0.1:9000?ns=rider-app-emulator";
const apps: FirebaseApp[] = [];
const clients: TestClient[] = [];

type TestClient = {
  app: FirebaseApp;
  auth: Auth;
  database: Database;
  firestore: Firestore;
  identity: IdentityService;
  riding: RidingService;
  realtime: FirebaseRealtimeLocationAdapter;
};

async function createClient(name: string): Promise<TestClient> {
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
  const user = await signInAnonymously(auth);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  const database = getDatabase(app);
  connectDatabaseEmulator(database, "127.0.0.1", 9000);
  const identity: IdentityService = {
    async getIdentity() {
      return { userId: user.user.uid };
    },
  };
  const realtime = new FirebaseRealtimeLocationAdapter({
    database,
    identity,
    staleThresholdMs: 100,
  });
  const riding = createRidingService({
    identity,
    repository: new FirestoreRidingRepository({ firestore }),
    realtime,
    locationController: createLocationController(createMockLocationService()),
    entitlements: createDevelopmentEntitlements(),
  });

  const client = { app, auth, database, firestore, identity, riding, realtime };
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

afterAll(async () => {
  clients.forEach((client) => client.realtime.dispose());
  // Signing out cancels Firebase Auth's proactive token refresh timer, and
  // goOffline closes the Realtime Database socket; without both the process
  // keeps a ref'd handle open and Jest never exits.
  await Promise.all(clients.map((client) => signOut(client.auth)));
  clients.forEach((client) => goOffline(client.database));
  await Promise.all(apps.map((app) => deleteApp(app)));
});

it("runs the two-user ride flow through Firestore and Realtime adapters", async () => {
  const clientA = await createClient("client-a");
  const clientB = await createClient("client-b");
  const group = await clientA.riding.createGroup(
    `Emulator Riders ${Date.now()}`,
  );
  const invitation = await clientA.riding.createInvitation(group.id);
  await clientB.riding.joinGroup(invitation.code);

  const ride = await clientA.riding.startRide(group.id);
  const updates: { userId: string; stale: boolean }[] = [];
  const unsubscribe = await clientB.riding.subscribeRideLocations(
    ride.id,
    (update) => {
      updates.push({ userId: update.userId, stale: update.stale });
    },
  );
  await waitFor(
    () => clientB.riding.getLocationConnectionState() === "CONNECTED",
  );

  await clientA.riding.publishCurrentLocation(ride.id);
  await waitFor(() => updates.some((update) => !update.stale));
  const freshUpdate = updates.find((update) => !update.stale);
  expect(freshUpdate?.userId).toBe(
    (await clientA.identity.getIdentity()).userId,
  );

  await waitFor(() => updates.some((update) => update.stale));
  await clientA.riding.publishCurrentLocation(ride.id);
  await waitFor(() => updates.filter((update) => !update.stale).length >= 2);

  const completed = await clientA.riding.updateRideState(ride.id, "COMPLETED");
  expect(completed.state).toBe("COMPLETED");
  const accessAfterCompletion = await get(
    ref(
      clientA.database,
      `liveLocations/${ride.contextId}/access/${(await clientA.identity.getIdentity()).userId}`,
    ),
  );
  expect(accessAfterCompletion.exists()).toBe(false);
  unsubscribe();
});
