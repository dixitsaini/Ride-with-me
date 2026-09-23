import type { GroupInvitation, Group } from "./domain";
import type { RidingRepository } from "./repository";

export async function seedDevelopmentGroup(
  repository: RidingRepository,
): Promise<{
  group: Group;
  invitation: GroupInvitation;
}> {
  const group = await repository.createGroup(
    "Development Riders",
    "demo-owner",
    10,
  );
  const invitation = await repository.createInvitation({
    id: "development-invite",
    groupId: group.id,
    code: "DEMO01",
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    revokedAt: null,
  });
  return { group, invitation };
}
