import type { IdentityService } from "../identity";
import {
  FirebaseRealtimeLocationAdapter,
  type FirebaseRealtimeLocationAdapterOptions,
} from "./FirebaseRealtimeLocationAdapter";
import {
  createMockLocationStream,
  type RealtimeLocationService,
} from "./index";

export type RealtimeProviderKind = "mock" | "firebase";

export type RealtimeProviderOptions = Omit<
  FirebaseRealtimeLocationAdapterOptions,
  "identity"
> & {
  identity: IdentityService;
};

export function getConfiguredRealtimeProviderKind(): RealtimeProviderKind {
  return process.env.EXPO_PUBLIC_REALTIME_PROVIDER === "firebase"
    ? "firebase"
    : "mock";
}

export function createRealtimeLocationService(
  provider: RealtimeProviderKind = getConfiguredRealtimeProviderKind(),
  options?: RealtimeProviderOptions,
): RealtimeLocationService {
  if (provider === "firebase") {
    if (!options) {
      throw new Error(
        "Firebase realtime provider requires an identity service.",
      );
    }

    return new FirebaseRealtimeLocationAdapter(options);
  }

  return createMockLocationStream();
}
