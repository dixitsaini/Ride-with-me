import type { IdentityService } from "../../core/identity";
import type {
  ConnectionState,
  LocationController,
  LocationSample,
  RealtimeLocationService,
  RealtimeLocationUpdate,
} from "../../core/location";
import {
  createInviteCode,
  isActiveMember,
  isGroupAdmin,
  isInvitationValid,
  transitionRideState,
  type Group,
  type GroupInvitation,
  type GroupMember,
  type Ride,
  type RideParticipationState,
} from "./domain";
import type { RidingEntitlements } from "./entitlements";
import type { RidingRepository } from "./repository";

export type RidingService = {
  listGroups: () => Promise<Group[]>;
  getGroup: (groupId: string) => Promise<Group | null>;
  createGroup: (name: string) => Promise<Group>;
  updateGroupName: (groupId: string, name: string) => Promise<Group>;
  archiveGroup: (groupId: string) => Promise<Group>;
  listMembers: (groupId: string) => Promise<GroupMember[]>;
  createInvitation: (groupId: string) => Promise<GroupInvitation>;
  revokeInvitation: (
    groupId: string,
    invitationId: string,
  ) => Promise<GroupInvitation>;
  joinGroup: (code: string) => Promise<Group>;
  leaveGroup: (groupId: string) => Promise<GroupMember>;
  removeMember: (groupId: string, userId: string) => Promise<GroupMember>;
  startRide: (groupId: string) => Promise<Ride>;
  getRide: (rideId: string) => Promise<Ride | null>;
  updateRideState: (rideId: string, nextState: Ride["state"]) => Promise<Ride>;
  publishCurrentLocation: (rideId: string) => Promise<LocationSample | null>;
  subscribeRideLocations: (
    rideId: string,
    listener: (update: RealtimeLocationUpdate) => void,
  ) => Promise<() => void>;
  getLocationConnectionState: () => ConnectionState;
};

export type RidingServiceDependencies = {
  identity: IdentityService;
  repository: RidingRepository;
  realtime: RealtimeLocationService;
  locationController: LocationController;
  entitlements: RidingEntitlements;
};

export function createRidingService(
  dependencies: RidingServiceDependencies,
): RidingService {
  const { identity, repository, realtime, locationController, entitlements } =
    dependencies;

  async function currentUserId(): Promise<string> {
    return (await identity.getIdentity()).userId;
  }

  async function requireGroupMember(
    groupId: string,
    userId: string,
  ): Promise<{
    group: Group;
    member: GroupMember;
  }> {
    const group = await repository.getGroup(groupId);
    const member = await repository.getMember(groupId, userId);
    if (!group || !member || !isActiveMember(member)) {
      throw new Error("An active group membership is required.");
    }
    return { group, member };
  }

  return {
    async listGroups() {
      return repository.listGroups(await currentUserId());
    },
    getGroup(groupId) {
      return repository.getGroup(groupId);
    },
    async createGroup(name) {
      if (!entitlements.canCreateGroup()) {
        throw new Error("Group creation is not available for this account.");
      }
      if (!name.trim()) {
        throw new Error("Group name is required.");
      }
      return repository.createGroup(
        name,
        await currentUserId(),
        entitlements.maxGroupMembers(),
      );
    },
    async updateGroupName(groupId, name) {
      const userId = await currentUserId();
      const { group, member } = await requireGroupMember(groupId, userId);
      if (!isGroupAdmin(group, member)) {
        throw new Error("Only a group admin can update the group.");
      }
      return repository.updateGroupName(groupId, name);
    },
    async archiveGroup(groupId) {
      const userId = await currentUserId();
      const { group, member } = await requireGroupMember(groupId, userId);
      if (!isGroupAdmin(group, member)) {
        throw new Error("Only a group admin can archive the group.");
      }
      return repository.archiveGroup(groupId);
    },
    listMembers(groupId) {
      return repository.listMembers(groupId);
    },
    async createInvitation(groupId) {
      const userId = await currentUserId();
      const { group, member } = await requireGroupMember(groupId, userId);
      if (!isGroupAdmin(group, member)) {
        throw new Error("Only a group admin can create an invitation.");
      }
      const now = Date.now();
      return repository.createInvitation({
        id: `invite-${now}-${Math.random().toString(36).slice(2, 8)}`,
        groupId,
        code: createInviteCode(),
        expiresAt: now + 24 * 60 * 60 * 1000,
        revokedAt: null,
        groupState: group.state,
        maxMembers: group.settings.maxMembers,
        groupName: group.name,
      });
    },
    async revokeInvitation(groupId, invitationId) {
      const userId = await currentUserId();
      const { group, member } = await requireGroupMember(groupId, userId);
      if (!isGroupAdmin(group, member)) {
        throw new Error("Only a group admin can revoke an invitation.");
      }
      return repository.revokeInvitation(invitationId);
    },
    async joinGroup(code) {
      if (!entitlements.canJoinGroup()) {
        throw new Error("Joining groups is not available for this account.");
      }
      const invitation = await repository.getInvitationByCode(code.trim());
      if (!invitation || !isInvitationValid(invitation)) {
        throw new Error("This invitation is invalid or expired.");
      }
      const userId = await currentUserId();
      if (invitation.inviteeUserId && invitation.inviteeUserId !== userId) {
        throw new Error("This invitation is not assigned to this user.");
      }
      if (invitation.groupState && invitation.groupState !== "ACTIVE") {
        throw new Error("This group is not active.");
      }
      const existing = await repository.getMember(invitation.groupId, userId);
      if (existing?.status === "ACTIVE") {
        const group = await repository.getGroup(invitation.groupId);
        if (!group) {
          throw new Error("This group is not available.");
        }
        return group;
      }
      if (invitation.maxMembers !== undefined && invitation.maxMembers < 1) {
        throw new Error("This group is full.");
      }
      const member: GroupMember = {
        groupId: invitation.groupId,
        userId,
        role: "RIDER",
        status: "ACTIVE",
        joinedAt: Date.now(),
        invitationId: invitation.id,
      };
      if (existing) {
        await repository.updateMember(member);
      } else {
        await repository.addMember(member);
      }
      const group: Group = {
        id: invitation.groupId,
        name: invitation.groupName ?? "Group",
        ownerId: "",
        state: invitation.groupState ?? "ACTIVE",
        settings: { maxMembers: invitation.maxMembers ?? 10 },
        createdAt: 0,
        updatedAt: 0,
      };
      return group;
    },
    async leaveGroup(groupId) {
      const userId = await currentUserId();
      const { group, member } = await requireGroupMember(groupId, userId);
      if (group.ownerId === userId) {
        throw new Error("The group owner must archive the group instead.");
      }
      const leftMember = { ...member, status: "LEFT" as const };
      return repository.updateMember(leftMember);
    },
    async removeMember(groupId, userId) {
      const actorId = await currentUserId();
      const { group, member } = await requireGroupMember(groupId, actorId);
      if (!isGroupAdmin(group, member) || userId === group.ownerId) {
        throw new Error("Only an admin can remove a non-owner member.");
      }
      const target = await repository.getMember(groupId, userId);
      if (!target) {
        throw new Error("Group member was not found.");
      }
      return repository.updateMember({ ...target, status: "REMOVED" });
    },
    async startRide(groupId) {
      const userId = await currentUserId();
      const { group } = await requireGroupMember(groupId, userId);
      if (group.state !== "ACTIVE") {
        throw new Error("An archived group cannot start a ride.");
      }
      const members = (await repository.listMembers(groupId)).filter(
        isActiveMember,
      );
      const now = Date.now();
      const participants = members.map((member) => ({
        userId: member.userId,
        state: "ACTIVE" as RideParticipationState,
        joinedAt: now,
      }));
      const ride: Ride = {
        id: `ride-${now}-${Math.random().toString(36).slice(2, 8)}`,
        groupId,
        createdBy: userId,
        state: "READY",
        contextId: `ride-${now}`,
        participantIds: participants.map((participant) => participant.userId),
        participants,
        createdAt: now,
        updatedAt: now,
      };
      const created = await repository.createRide(ride);
      realtime.connect();
      await realtime.authorizeContext?.(ride.contextId);
      await locationController.startTracking();
      return repository.updateRideState(created.id, "ACTIVE", participants);
    },
    getRide(rideId) {
      return repository.getRide(rideId);
    },
    async updateRideState(rideId, nextState) {
      const userId = await currentUserId();
      const ride = await repository.getRide(rideId);
      if (!ride) {
        throw new Error("Ride was not found.");
      }
      const member = await repository.getMember(ride.groupId, userId);
      const group = await repository.getGroup(ride.groupId);
      if (!group || !member || !isGroupAdmin(group, member)) {
        throw new Error("Only a group admin can control the ride.");
      }
      const state = transitionRideState(ride.state, nextState);
      const participants = ride.participants.map((participant) => ({
        ...participant,
        state:
          state === "COMPLETED" || state === "CANCELLED"
            ? ("COMPLETED" as RideParticipationState)
            : participant.state,
      }));
      const updated = await repository.updateRideState(
        rideId,
        state,
        participants,
      );
      if (state === "COMPLETED" || state === "CANCELLED") {
        await locationController.stopTracking();
        realtime.disconnect();
        await realtime.revokeContext?.(ride.contextId);
      }
      return updated;
    },
    async publishCurrentLocation(rideId) {
      const userId = await currentUserId();
      const ride = await repository.getRide(rideId);
      if (
        !ride ||
        !ride.participantIds.includes(userId) ||
        ride.state === "COMPLETED" ||
        ride.state === "CANCELLED"
      ) {
        throw new Error("You are not an active participant in this ride.");
      }
      const location = await locationController.getCurrentLocation();
      if (location) {
        await realtime.publish(ride.contextId, location);
      }
      return location;
    },
    async subscribeRideLocations(rideId, listener) {
      const userId = await currentUserId();
      const ride = await repository.getRide(rideId);
      if (!ride || !ride.participantIds.includes(userId)) {
        throw new Error("You are not authorized to view this ride.");
      }
      return realtime.subscribe(ride.contextId, (update) => {
        if (ride.participantIds.includes(update.userId)) {
          listener(update);
        }
      });
    },
    getLocationConnectionState() {
      return realtime.getConnectionState();
    },
  };
}
