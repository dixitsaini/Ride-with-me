import { FirebaseAnonymousIdentityAdapter } from "../../core/identity/FirebaseAnonymousIdentityAdapter";
import type { IdentityService } from "../../core/identity";
import {
  createMockLocationService,
  createLocationController,
} from "../../core/location";
import {
  createRealtimeLocationService,
  getConfiguredRealtimeProviderKind,
} from "../../core/location/realtimeProvider";
import { FirestoreRidingRepository } from "./FirestoreRidingRepository";
import { createDevelopmentEntitlements } from "./entitlements";
import { InMemoryRidingRepository } from "./InMemoryRidingRepository";
import { createRidingService } from "./service";
import type { RidingRepository } from "./repository";

export function createDevelopmentIdentityService(): IdentityService {
  if (getConfiguredRealtimeProviderKind() === "firebase") {
    return new FirebaseAnonymousIdentityAdapter();
  }

  return {
    async getIdentity() {
      return { userId: process.env.EXPO_PUBLIC_DEV_USER_ID ?? "mock-user" };
    },
  };
}

export function createDevelopmentRidingService() {
  const identity = createDevelopmentIdentityService();
  const useFirebase = process.env.EXPO_PUBLIC_DATA_PROVIDER === "firebase";
  const repository: RidingRepository = useFirebase
    ? new FirestoreRidingRepository()
    : new InMemoryRidingRepository();
  const locationController = createLocationController(
    createMockLocationService(),
  );
  const realtime = createRealtimeLocationService(
    getConfiguredRealtimeProviderKind(),
    getConfiguredRealtimeProviderKind() === "firebase"
      ? { identity }
      : undefined,
  );

  return createRidingService({
    identity,
    repository,
    realtime,
    locationController,
    entitlements: createDevelopmentEntitlements(),
  });
}

export const developmentRidingService = createDevelopmentRidingService();
