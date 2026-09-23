import {
  createMockLocationService,
  createLocationController,
  createLocationSample,
  createMockLocationStream,
} from "../../core/location";
import { createDevelopmentEntitlements } from "./entitlements";
import { InMemoryRidingRepository } from "./InMemoryRidingRepository";
import { createRidingService } from "./service";

function createTestService(
  userId = "owner-a",
  repository = new InMemoryRidingRepository(),
) {
  const identity = { getIdentity: jest.fn(async () => ({ userId })) };
  const realtime = createMockLocationStream(userId);
  const locationController = createLocationController(
    createMockLocationService(),
  );
  const service = createRidingService({
    identity,
    repository,
    realtime,
    locationController,
    entitlements: createDevelopmentEntitlements(),
  });
  return { service, repository, realtime, locationController };
}

describe("Riding service", () => {
  it("creates groups and prevents duplicate active rides", async () => {
    const { service } = createTestService();
    const group = await service.createGroup("Saturday Riders");
    const ride = await service.startRide(group.id);

    expect(ride.state).toBe("ACTIVE");
    await expect(service.startRide(group.id)).rejects.toThrow(
      "already has an active ride",
    );
  });

  it("validates invitations and joins a second development identity", async () => {
    const owner = createTestService();
    const group = await owner.service.createGroup("Invite Only");
    const invitation = await owner.service.createInvitation(group.id);
    const rider = createTestService("rider-b", owner.repository);
    const joined = await rider.service.joinGroup(invitation.code);

    expect(joined.id).toBe(group.id);
    await expect(
      rider.service.joinGroup(invitation.code),
    ).resolves.toMatchObject({ id: group.id });
    await expect(rider.service.joinGroup("000000")).rejects.toThrow(
      "invalid or expired",
    );
  });

  it("allows an admin to archive a group and revoke its invitation", async () => {
    const owner = createTestService();
    const group = await owner.service.createGroup("Managed Group");
    const invitation = await owner.service.createInvitation(group.id);

    await owner.service.revokeInvitation(group.id, invitation.id);
    await expect(owner.service.joinGroup(invitation.code)).rejects.toThrow(
      "invalid or expired",
    );
    expect((await owner.service.archiveGroup(group.id)).state).toBe("ARCHIVED");
  });

  it("binds active members to a ride and filters realtime locations", async () => {
    const owner = createTestService();
    const group = await owner.service.createGroup("Live Riders");
    const invitation = await owner.service.createInvitation(group.id);
    const rider = createTestService("rider-b", owner.repository);
    await rider.service.joinGroup(invitation.code);

    const ride = await owner.service.startRide(group.id);
    const updates: string[] = [];
    await owner.service.subscribeRideLocations(ride.id, (update) =>
      updates.push(update.userId),
    );
    await owner.realtime.publish(
      ride.contextId,
      createLocationSample({
        latitude: 1,
        longitude: 2,
        timestamp: Date.now(),
        accuracy: 5,
      }),
    );

    expect(ride.participantIds).toEqual(
      expect.arrayContaining(["owner-a", "rider-b"]),
    );
    expect(updates).toContain("owner-a");
  });

  it("completes a ride and rejects invalid later transitions", async () => {
    const { service } = createTestService();
    const group = await service.createGroup("Lifecycle");
    const ride = await service.startRide(group.id);
    const completed = await service.updateRideState(ride.id, "COMPLETED");

    expect(completed.state).toBe("COMPLETED");
    await expect(service.updateRideState(ride.id, "ACTIVE")).rejects.toThrow(
      "Invalid ride transition",
    );
  });
});
