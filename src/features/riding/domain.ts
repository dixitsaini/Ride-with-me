export type GroupState = "ACTIVE" | "ARCHIVED";
export type GroupMemberRole = "ADMIN" | "RIDER";
export type GroupMemberStatus = "INVITED" | "ACTIVE" | "LEFT" | "REMOVED";
export type RideState =
  "READY" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type RideParticipationState =
  "JOINED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "LEFT";

export type GroupSettings = {
  maxMembers: number;
};

export type Group = {
  id: string;
  name: string;
  ownerId: string;
  state: GroupState;
  settings: GroupSettings;
  /** Ride currently driving this group's location context, when one exists. */
  activeRideId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type GroupMember = {
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  joinedAt: number | null;
  invitationId?: string;
};

export type GroupInvitation = {
  id: string;
  groupId: string;
  code: string;
  expiresAt: number;
  revokedAt: number | null;
  groupState?: GroupState;
  maxMembers?: number;
  groupName?: string;
  inviteeUserId?: string;
};

export type RideParticipant = {
  userId: string;
  state: RideParticipationState;
  joinedAt: number;
};

export type Ride = {
  id: string;
  groupId: string;
  createdBy: string;
  state: RideState;
  contextId: string;
  participantIds: string[];
  participants: RideParticipant[];
  createdAt: number;
  updatedAt: number;
};

export function isGroupAdmin(
  group: Group,
  member: GroupMember | null,
): boolean {
  return Boolean(
    member &&
    member.status === "ACTIVE" &&
    (member.role === "ADMIN" || member.userId === group.ownerId),
  );
}

export function isActiveMember(member: GroupMember | null): boolean {
  return member?.status === "ACTIVE";
}

export function isInvitationValid(
  invitation: GroupInvitation,
  now = Date.now(),
): boolean {
  return invitation.revokedAt === null && invitation.expiresAt > now;
}

const rideTransitions: Record<RideState, RideState[]> = {
  READY: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionRide(from: RideState, to: RideState): boolean {
  return rideTransitions[from].includes(to);
}

export function transitionRideState(from: RideState, to: RideState): RideState {
  if (!canTransitionRide(from, to)) {
    throw new Error(`Invalid ride transition: ${from} -> ${to}`);
  }

  return to;
}

export function createInviteCode(randomValue = Math.random()): string {
  return Math.floor(randomValue * 1_000_000)
    .toString()
    .padStart(6, "0");
}
