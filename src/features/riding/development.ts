import { FirebaseAnonymousIdentityAdapter } from "../../core/identity/FirebaseAnonymousIdentityAdapter";
import type { IdentityService } from "../../core/identity";
import { createLocationController } from "../../core/location";
import { createLocationEngine } from "../../core/location/LocationEngine";
import {
  createBackgroundLocationProvider,
  createLocationProvider,
} from "../../core/location/locationProvider";
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

export function createDevelopmentLocationEngine() {
  return createLocationEngine({
    provider: createLocationProvider(),
    background: createBackgroundLocationProvider(),
  });
}

export function createDevelopmentRidingService() {
  const identity = createDevelopmentIdentityService();
  const useFirebase = process.env.EXPO_PUBLIC_DATA_PROVIDER === "firebase";
  const repository: RidingRepository = useFirebase
    ? new FirestoreRidingRepository()
    : new InMemoryRidingRepository();
  const locationController = createLocationController(
    createDevelopmentLocationEngine(),
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
