import {
  collection,
  collectionGroup,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { getFirebaseApp } from "../../core/firebase/config";
import type {
  Group,
  GroupInvitation,
  GroupMember,
  Ride,
  RideParticipant,
  RideState,
} from "./domain";
import type { RidingRepository } from "./repository";

type FirestoreRidingRepositoryOptions = {
  firestore?: Firestore;
};

type FirestoreGroup = Omit<Group, "id"> & { activeRideId?: string };

const groupsCollection = (firestore: Firestore) =>
  collection(firestore, "groups");
const membersCollection = (firestore: Firestore, groupId: string) =>
  collection(firestore, "groups", groupId, "members");
const ridesCollection = (firestore: Firestore) =>
  collection(firestore, "rides");

function toGroup(id: string, data: FirestoreGroup): Group {
  return {
    id,
    name: data.name,
    ownerId: data.ownerId,
    state: data.state,
    settings: data.settings,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function toMember(data: GroupMember): GroupMember {
  return { ...data };
}

function toRide(id: string, data: Omit<Ride, "id">): Ride {
  return {
    id,
    ...data,
    participants: data.participants.map((participant) => ({ ...participant })),
  };
}

export class FirestoreRidingRepository implements RidingRepository {
  private readonly firestore: Firestore;

  constructor(options: FirestoreRidingRepositoryOptions = {}) {
    this.firestore = options.firestore ?? getFirestore(getFirebaseApp());
  }

  async listGroups(userId: string): Promise<Group[]> {
    const memberships = await getDocs(
      query(
        collectionGroup(this.firestore, "members"),
        where("userId", "==", userId),
      ),
    );
    const groups = await Promise.all(
      memberships.docs.map(async (membership) => {
        const group = await getDoc(
          doc(this.firestore, "groups", membership.data().groupId),
        );
        return group.exists()
          ? toGroup(group.id, group.data() as FirestoreGroup)
          : null;
      }),
    );
    return groups.filter((group): group is Group => group !== null);
  }

  async createGroup(
    name: string,
    ownerId: string,
    maxMembers: number,
  ): Promise<Group> {
    const groupReference = doc(groupsCollection(this.firestore));
    const now = Date.now();
    const group: FirestoreGroup = {
      name: name.trim(),
      ownerId,
      state: "ACTIVE",
      settings: { maxMembers },
      createdAt: now,
      updatedAt: now,
    };
    const member: GroupMember = {
      groupId: groupReference.id,
      userId: ownerId,
      role: "ADMIN",
      status: "ACTIVE",
      joinedAt: now,
    };

    await runTransaction(this.firestore, async (transaction) => {
      transaction.set(groupReference, group);
      transaction.set(
        doc(membersCollection(this.firestore, groupReference.id), ownerId),
        member,
      );
    });
    return toGroup(groupReference.id, group);
  }

  async getGroup(groupId: string): Promise<Group | null> {
    const snapshot = await getDoc(doc(this.firestore, "groups", groupId));
    return snapshot.exists()
      ? toGroup(snapshot.id, snapshot.data() as FirestoreGroup)
      : null;
  }

  async updateGroupName(groupId: string, name: string): Promise<Group> {
    await updateDoc(doc(this.firestore, "groups", groupId), {
      name: name.trim(),
      updatedAt: Date.now(),
    });
    const group = await this.getGroup(groupId);
    if (!group) {
      throw new Error("Group was not found.");
    }
    return group;
  }

  async archiveGroup(groupId: string): Promise<Group> {
    await updateDoc(doc(this.firestore, "groups", groupId), {
      state: "ARCHIVED",
      updatedAt: Date.now(),
    });
    const group = await this.getGroup(groupId);
    if (!group) {
      throw new Error("Group was not found.");
    }
    return group;
  }

  async listMembers(groupId: string): Promise<GroupMember[]> {
    const snapshot = await getDocs(membersCollection(this.firestore, groupId));
    return snapshot.docs.map((item) => toMember(item.data() as GroupMember));
  }

  async getMember(
    groupId: string,
    userId: string,
  ): Promise<GroupMember | null> {
    const snapshot = await getDoc(
      doc(membersCollection(this.firestore, groupId), userId),
    );
    return snapshot.exists() ? toMember(snapshot.data() as GroupMember) : null;
  }

  async addMember(member: GroupMember): Promise<GroupMember> {
    const reference = doc(
      membersCollection(this.firestore, member.groupId),
      member.userId,
    );
    const existing = await getDoc(reference);
    if (
      existing.exists() &&
      (existing.data() as GroupMember).status === "ACTIVE"
    ) {
      throw new Error("User is already a group member.");
    }
    await setDoc(reference, member);
    return member;
  }

  async updateMember(member: GroupMember): Promise<GroupMember> {
    await setDoc(
      doc(membersCollection(this.firestore, member.groupId), member.userId),
      member,
    );
    return member;
  }

  async createInvitation(
    invitation: GroupInvitation,
  ): Promise<GroupInvitation> {
    await setDoc(
      doc(this.firestore, "groupInvitations", invitation.id),
      invitation,
    );
    return invitation;
  }

  async getInvitationByCode(code: string): Promise<GroupInvitation | null> {
    const snapshot = await getDocs(
      query(
        collection(this.firestore, "groupInvitations"),
        where("code", "==", code),
      ),
    );
    const invitation = snapshot.docs[0];
    return invitation ? (invitation.data() as GroupInvitation) : null;
  }

  async revokeInvitation(invitationId: string): Promise<GroupInvitation> {
    const reference = doc(this.firestore, "groupInvitations", invitationId);
    const invitationSnapshot = await getDoc(reference);
    if (!invitationSnapshot.exists()) {
      throw new Error("Invitation was not found.");
    }
    const invitation = invitationSnapshot.data() as GroupInvitation;
    invitation.revokedAt = Date.now();
    await updateDoc(reference, { revokedAt: invitation.revokedAt });
    return invitation;
  }

  async createRide(ride: Ride): Promise<Ride> {
    const rideReference = doc(ridesCollection(this.firestore), ride.id);
    await runTransaction(this.firestore, async (transaction) => {
      const groupReference = doc(this.firestore, "groups", ride.groupId);
      const groupSnapshot = await transaction.get(groupReference);
      const group = groupSnapshot.data() as FirestoreGroup | undefined;
      if (group?.activeRideId) {
        throw new Error("The group already has an active ride.");
      }
      transaction.set(rideReference, ride);
      transaction.update(groupReference, {
        activeRideId: ride.id,
        updatedAt: Date.now(),
      });
    });
    return ride;
  }

  async getRide(rideId: string): Promise<Ride | null> {
    const snapshot = await getDoc(doc(this.firestore, "rides", rideId));
    return snapshot.exists()
      ? toRide(snapshot.id, snapshot.data() as Omit<Ride, "id">)
      : null;
  }

  async updateRideState(
    rideId: string,
    state: RideState,
    participants: RideParticipant[],
  ): Promise<Ride> {
    const rideReference = doc(this.firestore, "rides", rideId);
    const rideSnapshot = await getDoc(rideReference);
    if (!rideSnapshot.exists()) {
      throw new Error("Ride was not found.");
    }
    const currentRide = rideSnapshot.data() as Omit<Ride, "id">;
    await runTransaction(this.firestore, async (transaction) => {
      transaction.update(rideReference, {
        state,
        participants,
        updatedAt: Date.now(),
      });
      if (state === "COMPLETED" || state === "CANCELLED") {
        transaction.update(doc(this.firestore, "groups", currentRide.groupId), {
          activeRideId: deleteField(),
          updatedAt: Date.now(),
        });
      }
    });
    return toRide(rideId, {
      ...currentRide,
      state,
      participants,
      updatedAt: Date.now(),
    });
  }
}
