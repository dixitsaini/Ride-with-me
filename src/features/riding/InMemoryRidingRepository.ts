import type {
  Group,
  GroupInvitation,
  GroupMember,
  Ride,
  RideState,
} from "./domain";
import type { RidingRepository } from "./repository";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class InMemoryRidingRepository implements RidingRepository {
  private readonly groups = new Map<string, Group>();
  private readonly members = new Map<string, GroupMember>();
  private readonly invitations = new Map<string, GroupInvitation>();
  private readonly rides = new Map<string, Ride>();
  private readonly memberListeners = new Map<
    string,
    Set<(members: GroupMember[]) => void>
  >();
  private readonly rideListeners = new Map<
    string,
    Set<(ride: Ride | null) => void>
  >();

  async listGroups(userId: string): Promise<Group[]> {
    const memberGroups = [...this.members.values()]
      .filter(
        (member) => member.userId === userId && member.status === "ACTIVE",
      )
      .map((member) => member.groupId);
    return [...this.groups.values()]
      .filter((group) => memberGroups.includes(group.id))
      .map(copy);
  }

  async createGroup(
    name: string,
    ownerId: string,
    maxMembers: number,
  ): Promise<Group> {
    const now = Date.now();
    const group: Group = {
      id: `group-${now}-${this.groups.size}`,
      name: name.trim(),
      ownerId,
      state: "ACTIVE",
      settings: { maxMembers },
      createdAt: now,
      updatedAt: now,
    };
    this.groups.set(group.id, group);
    await this.addMember({
      groupId: group.id,
      userId: ownerId,
      role: "ADMIN",
      status: "ACTIVE",
      joinedAt: now,
    });
    return copy(group);
  }

  async getGroup(groupId: string): Promise<Group | null> {
    const group = this.groups.get(groupId);
    return group ? copy(group) : null;
  }

  async updateGroupName(groupId: string, name: string): Promise<Group> {
    const group = this.requireGroup(groupId);
    group.name = name.trim();
    group.updatedAt = Date.now();
    return copy(group);
  }

  async archiveGroup(groupId: string): Promise<Group> {
    const group = this.requireGroup(groupId);
    group.state = "ARCHIVED";
    group.updatedAt = Date.now();
    return copy(group);
  }

  async listMembers(groupId: string): Promise<GroupMember[]> {
    return [...this.members.values()]
      .filter((member) => member.groupId === groupId)
      .map(copy);
  }

  async getMember(
    groupId: string,
    userId: string,
  ): Promise<GroupMember | null> {
    const member = this.members.get(this.memberKey(groupId, userId));
    return member ? copy(member) : null;
  }

  async addMember(member: GroupMember): Promise<GroupMember> {
    const key = this.memberKey(member.groupId, member.userId);
    if (this.members.has(key)) {
      throw new Error("User is already a group member.");
    }
    const group = this.groups.get(member.groupId);
    if (
      group &&
      member.status === "ACTIVE" &&
      this.countActiveMembers(member.groupId) >= group.settings.maxMembers
    ) {
      throw new Error("This group is full.");
    }
    this.members.set(key, copy(member));
    this.notifyMembers(member.groupId);
    return copy(member);
  }

  async updateMember(member: GroupMember): Promise<GroupMember> {
    const key = this.memberKey(member.groupId, member.userId);
    if (!this.members.has(key)) {
      throw new Error("Group member was not found.");
    }
    this.members.set(key, copy(member));
    this.notifyMembers(member.groupId);
    return copy(member);
  }

  subscribeToMembers(
    groupId: string,
    listener: (members: GroupMember[]) => void,
  ): () => void {
    const listeners = this.memberListeners.get(groupId) ?? new Set();
    listeners.add(listener);
    this.memberListeners.set(groupId, listeners);
    listener(this.membersOf(groupId));
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.memberListeners.delete(groupId);
      }
    };
  }

  async createInvitation(
    invitation: GroupInvitation,
  ): Promise<GroupInvitation> {
    this.invitations.set(invitation.id, copy(invitation));
    return copy(invitation);
  }

  async getInvitationByCode(code: string): Promise<GroupInvitation | null> {
    const invitation = [...this.invitations.values()].find(
      (item) => item.code === code,
    );
    return invitation ? copy(invitation) : null;
  }

  async listInvitations(groupId: string): Promise<GroupInvitation[]> {
    return [...this.invitations.values()]
      .filter((invitation) => invitation.groupId === groupId)
      .map(copy);
  }

  async revokeInvitation(invitationId: string): Promise<GroupInvitation> {
    const invitation = this.invitations.get(invitationId);
    if (!invitation) {
      throw new Error("Invitation was not found.");
    }
    invitation.revokedAt = Date.now();
    return copy(invitation);
  }

  async createRide(ride: Ride): Promise<Ride> {
    const duplicate = [...this.rides.values()].find(
      (item) =>
        item.groupId === ride.groupId &&
        ["READY", "ACTIVE", "PAUSED"].includes(item.state),
    );
    if (duplicate) {
      throw new Error("The group already has an active ride.");
    }
    const stored = copy(ride);
    this.rides.set(stored.id, stored);
    this.requireGroup(ride.groupId).activeRideId = stored.id;
    this.notifyRide(stored.id);
    return copy(stored);
  }

  async getRide(rideId: string): Promise<Ride | null> {
    const ride = this.rides.get(rideId);
    return ride ? copy(ride) : null;
  }

  async getActiveRide(groupId: string): Promise<Ride | null> {
    const active = [...this.rides.values()].find(
      (item) =>
        item.groupId === groupId &&
        ["READY", "ACTIVE", "PAUSED"].includes(item.state),
    );
    return active ? copy(active) : null;
  }

  async updateRideState(
    rideId: string,
    state: RideState,
    participants: Ride["participants"],
  ): Promise<Ride> {
    const ride = this.requireRide(rideId);
    ride.state = state;
    ride.participants = copy(participants);
    ride.participantIds = participants.map((participant) => participant.userId);
    ride.updatedAt = Date.now();
    if (state === "COMPLETED" || state === "CANCELLED") {
      const group = this.groups.get(ride.groupId);
      if (group && group.activeRideId === rideId) {
        group.activeRideId = null;
        group.updatedAt = ride.updatedAt;
      }
    }
    this.notifyRide(rideId);
    return copy(ride);
  }

  subscribeToRide(
    rideId: string,
    listener: (ride: Ride | null) => void,
  ): () => void {
    const listeners = this.rideListeners.get(rideId) ?? new Set();
    listeners.add(listener);
    this.rideListeners.set(rideId, listeners);
    const ride = this.rides.get(rideId);
    listener(ride ? copy(ride) : null);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.rideListeners.delete(rideId);
      }
    };
  }

  private countActiveMembers(groupId: string): number {
    return [...this.members.values()].filter(
      (member) => member.groupId === groupId && member.status === "ACTIVE",
    ).length;
  }

  private membersOf(groupId: string): GroupMember[] {
    return [...this.members.values()]
      .filter((member) => member.groupId === groupId)
      .map(copy);
  }

  private notifyMembers(groupId: string): void {
    const members = this.membersOf(groupId);
    this.memberListeners.get(groupId)?.forEach((listener) =>
      listener(members),
    );
  }

  private notifyRide(rideId: string): void {
    const listeners = this.rideListeners.get(rideId);
    if (!listeners || listeners.size === 0) {
      return;
    }
    const ride = this.rides.get(rideId);
    const value = ride ? copy(ride) : null;
    listeners.forEach((listener) => listener(value));
  }

  private requireGroup(groupId: string): Group {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error("Group was not found.");
    }
    return group;
  }

  private requireRide(rideId: string): Ride {
    const ride = this.rides.get(rideId);
    if (!ride) {
      throw new Error("Ride was not found.");
    }
    return ride;
  }

  private memberKey(groupId: string, userId: string): string {
    return `${groupId}:${userId}`;
  }
}
