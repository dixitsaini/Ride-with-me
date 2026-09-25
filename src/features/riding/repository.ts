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
  /**
   * Live membership feed. The listener fires immediately with the current
   * roster and then on every change; `onError` reports permission loss.
   */
  subscribeToMembers: (
    groupId: string,
    listener: (members: GroupMember[]) => void,
    onError?: (error: unknown) => void,
  ) => () => void;
  createInvitation: (invitation: GroupInvitation) => Promise<GroupInvitation>;
  getInvitationByCode: (code: string) => Promise<GroupInvitation | null>;
  listInvitations: (groupId: string) => Promise<GroupInvitation[]>;
  revokeInvitation: (invitationId: string) => Promise<GroupInvitation>;
  createRide: (ride: Ride) => Promise<Ride>;
  getRide: (rideId: string) => Promise<Ride | null>;
  /** The group's non-terminal ride, or null when the group is idle. */
  getActiveRide: (groupId: string) => Promise<Ride | null>;
  updateRideState: (
    rideId: string,
    state: RideState,
    participants: Ride["participants"],
  ) => Promise<Ride>;
  /**
   * Live ride feed. The listener fires immediately with the current ride and
   * then on every change; `onError` reports permission loss.
   */
  subscribeToRide: (
    rideId: string,
    listener: (ride: Ride | null) => void,
    onError?: (error: unknown) => void,
  ) => () => void;
};
