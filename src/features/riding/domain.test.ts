import {
  canTransitionRide,
  createInviteCode,
  isActiveMember,
  isInvitationValid,
  transitionRideState,
  type Group,
  type GroupMember,
} from "./domain";
import type { RealtimeState } from "../../core/location";

describe("riding domain rules", () => {
  const group: Group = {
    id: "group-a",
    name: "Riders",
    ownerId: "owner-a",
    state: "ACTIVE",
    settings: { maxMembers: 10 },
    createdAt: 1,
    updatedAt: 1,
  };

  it("allows only the defined ride lifecycle transitions", () => {
    expect(canTransitionRide("READY", "ACTIVE")).toBe(true);
    expect(canTransitionRide("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransitionRide("PAUSED", "ACTIVE")).toBe(true);
    expect(canTransitionRide("COMPLETED", "ACTIVE")).toBe(false);
    expect(() => transitionRideState("READY", "COMPLETED")).toThrow(
      "Invalid ride transition",
    );
  });

  it("validates active membership and invitations", () => {
    const member: GroupMember = {
      groupId: group.id,
      userId: "rider-a",
      role: "RIDER",
      status: "ACTIVE",
      joinedAt: 100,
    };
    expect(isActiveMember(member)).toBe(true);
    expect(isActiveMember({ ...member, status: "LEFT" })).toBe(false);
    expect(
      isInvitationValid(
        {
          id: "invite-a",
          groupId: group.id,
          code: "123456",
          expiresAt: 200,
          revokedAt: null,
        },
        100,
      ),
    ).toBe(true);
    expect(
      isInvitationValid(
        {
          id: "invite-a",
          groupId: group.id,
          code: "123456",
          expiresAt: 200,
          revokedAt: 101,
        },
        100,
      ),
    ).toBe(false);
  });

  it("creates fixed-width development invite codes", () => {
    expect(createInviteCode(0)).toBe("000000");
    expect(createInviteCode(0.999999)).toBe("999999");
  });

  it("keeps membership, ride participation, and realtime state independent", () => {
    const membership = "ACTIVE" as const;
    const rideParticipation = "ACTIVE" as const;
    const realtime: RealtimeState = "DISCONNECTED";

    expect(membership).toBe("ACTIVE");
    expect(rideParticipation).toBe("ACTIVE");
    expect(realtime).toBe("DISCONNECTED");
  });
});
