import type {
  Group,
  GroupInvitation,
  GroupMember,
  Ride,
  RideState,
} from "./domain";

export type RidingRepository = {
  listGroups: (userId: string) => Promise<Group[]>;
  createGroup: (
    name: string,
    ownerId: string,
    maxMembers: number,
  ) => Promise<Group>;
  getGroup: (groupId: string) => Promise<Group | null>;
  updateGroupName: (groupId: string, name: string) => Promise<Group>;
  archiveGroup: (groupId: string) => Promise<Group>;
  listMembers: (groupId: string) => Promise<GroupMember[]>;
  getMember: (groupId: string, userId: string) => Promise<GroupMember | null>;
  addMember: (member: GroupMember) => Promise<GroupMember>;
  updateMember: (member: GroupMember) => Promise<GroupMember>;
  createInvitation: (invitation: GroupInvitation) => Promise<GroupInvitation>;
  getInvitationByCode: (code: string) => Promise<GroupInvitation | null>;
  revokeInvitation: (invitationId: string) => Promise<GroupInvitation>;
  createRide: (ride: Ride) => Promise<Ride>;
  getRide: (rideId: string) => Promise<Ride | null>;
  updateRideState: (
    rideId: string,
    state: RideState,
    participants: Ride["participants"],
  ) => Promise<Ride>;
};
