export type RidingEntitlements = {
  canCreateGroup: () => boolean;
  canJoinGroup: () => boolean;
  maxGroupMembers: () => number;
};

export function createDevelopmentEntitlements(): RidingEntitlements {
  return {
    canCreateGroup: () => true,
    canJoinGroup: () => true,
    maxGroupMembers: () => 10,
  };
}
