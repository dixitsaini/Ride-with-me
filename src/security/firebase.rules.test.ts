import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const projectId = "rider-app-emulator";
let testEnvironment: RulesTestEnvironment;

const group = {
  name: "Rules Riders",
  ownerId: "admin-a",
  state: "ACTIVE",
  settings: { maxMembers: 10 },
  createdAt: 1,
  updatedAt: 1,
};

async function seedFirestore() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await setDoc(doc(database, "groups/group-a"), group);
    await setDoc(doc(database, "groups/group-a/members/admin-a"), {
      groupId: "group-a",
      userId: "admin-a",
      role: "ADMIN",
      status: "ACTIVE",
      joinedAt: 1,
    });
    await setDoc(doc(database, "groups/group-a/members/rider-a"), {
      groupId: "group-a",
      userId: "rider-a",
      role: "RIDER",
      status: "ACTIVE",
      joinedAt: 1,
    });
    await setDoc(doc(database, "groupInvitations/invite-a"), {
      id: "invite-a",
      groupId: "group-a",
      code: "JOIN01",
      expiresAt: Date.now() + 60_000,
      revokedAt: null,
    });
    await setDoc(doc(database, "rides/ride-a"), {
      id: "ride-a",
      groupId: "group-a",
      createdBy: "admin-a",
      state: "ACTIVE",
      contextId: "ride-a",
      participantIds: ["admin-a", "rider-a"],
      participants: [],
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function seedRealtime() {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.database();
    await database.ref("liveLocations/ride-a/access/admin-a").set(true);
    await database.ref("liveLocations/ride-a/access/rider-a").set(true);
    await database.ref("liveLocations/ride-a/locations/admin-a").set({
      latitude: 1,
      longitude: 2,
      timestamp: Date.now(),
      accuracy: 5,
    });
  });
}

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(join(__dirname, "../../firestore.rules"), "utf8"),
    },
    database: {
      rules: readFileSync(join(__dirname, "../../database.rules.json"), "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.clearDatabase();
  await seedFirestore();
  await seedRealtime();
});

afterAll(async () => {
  await testEnvironment?.cleanup();
});

describe("Firestore security rules", () => {
  it("deny unauthenticated access and private group access", async () => {
    const unauthenticated = testEnvironment
      .unauthenticatedContext()
      .firestore();
    const stranger = testEnvironment
      .authenticatedContext("stranger")
      .firestore();

    await assertFails(getDoc(doc(unauthenticated, "groups/group-a")));
    await assertFails(getDoc(doc(stranger, "groups/group-a")));
  });

  it("allow members to read and admins to manage groups", async () => {
    const member = testEnvironment.authenticatedContext("rider-a").firestore();
    const admin = testEnvironment.authenticatedContext("admin-a").firestore();

    await assertSucceeds(getDoc(doc(member, "groups/group-a")));
    await assertSucceeds(
      updateDoc(doc(admin, "groups/group-a"), { name: "Updated Riders" }),
    );
    await assertFails(
      updateDoc(doc(member, "groups/group-a"), { name: "Unauthorized" }),
    );
  });

  it("protect membership mutations and validate invitation joins", async () => {
    const rider = testEnvironment.authenticatedContext("rider-a").firestore();
    const newRider = testEnvironment
      .authenticatedContext("rider-b")
      .firestore();

    await assertFails(
      updateDoc(doc(rider, "groups/group-a/members/rider-a"), {
        role: "ADMIN",
      }),
    );
    await assertSucceeds(
      setDoc(doc(newRider, "groups/group-a/members/rider-b"), {
        groupId: "group-a",
        userId: "rider-b",
        role: "RIDER",
        status: "ACTIVE",
        joinedAt: Date.now(),
        invitationId: "invite-a",
      }),
    );
  });

  it("protect ride access and mutations by participant/admin role", async () => {
    const participant = testEnvironment
      .authenticatedContext("rider-a")
      .firestore();
    const stranger = testEnvironment
      .authenticatedContext("stranger")
      .firestore();

    await assertSucceeds(getDoc(doc(participant, "rides/ride-a")));
    await assertFails(getDoc(doc(stranger, "rides/ride-a")));
    await assertFails(
      updateDoc(doc(participant, "rides/ride-a"), { state: "COMPLETED" }),
    );
  });

  it("protect invitations and reject revoked invitations", async () => {
    const rider = testEnvironment.authenticatedContext("rider-a").firestore();
    const admin = testEnvironment.authenticatedContext("admin-a").firestore();

    await assertFails(
      setDoc(doc(rider, "groupInvitations/invite-b"), {
        id: "invite-b",
        groupId: "group-a",
        code: "NOPE01",
        expiresAt: Date.now() + 60_000,
        revokedAt: null,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(admin, "groupInvitations/invite-a"), {
        revokedAt: Date.now(),
      }),
    );
    await assertFails(
      setDoc(
        doc(
          testEnvironment.authenticatedContext("rider-c").firestore(),
          "groups/group-a/members/rider-c",
        ),
        {
          groupId: "group-a",
          userId: "rider-c",
          role: "RIDER",
          status: "ACTIVE",
          joinedAt: Date.now(),
          invitationId: "invite-a",
        },
      ),
    );
  });
});

describe("Realtime Database security rules", () => {
  function databaseFor(
    userId?: string,
  ): ReturnType<RulesTestContext["database"]> {
    return (
      userId
        ? testEnvironment.authenticatedContext(userId)
        : testEnvironment.unauthenticatedContext()
    ).database();
  }

  it("requires authentication and context access for reads", async () => {
    await assertFails(databaseFor().ref("liveLocations/ride-a").once("value"));
    await assertSucceeds(
      databaseFor("rider-a").ref("liveLocations/ride-a").once("value"),
    );
    await assertFails(
      databaseFor("stranger").ref("liveLocations/ride-a").once("value"),
    );
  });

  it("allows only an authorized user to write their own valid location", async () => {
    await assertSucceeds(
      databaseFor("rider-a").ref("liveLocations/ride-a/locations/rider-a").set({
        latitude: 3,
        longitude: 4,
        timestamp: Date.now(),
        accuracy: 6,
      }),
    );
    await assertFails(
      databaseFor("rider-a").ref("liveLocations/ride-a/locations/admin-a").set({
        latitude: 3,
        longitude: 4,
        timestamp: Date.now(),
        accuracy: 6,
      }),
    );
    await assertFails(
      databaseFor("stranger")
        .ref("liveLocations/ride-a/locations/stranger")
        .set({
          latitude: 3,
          longitude: 4,
          timestamp: Date.now(),
          accuracy: 6,
        }),
    );
    await assertFails(
      databaseFor("rider-a").ref("liveLocations/ride-a/locations/rider-a").set({
        latitude: 300,
        longitude: 4,
        timestamp: Date.now(),
        accuracy: 6,
      }),
    );
  });
});
