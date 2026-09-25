/**
 * Minimal `react-native` stand-in for the node environment used by
 * `jest.firebase.config.js`. The Firebase integration tests exercise the
 * Realtime Database path, so only the pieces `core/location` touches at import
 * time need to resolve.
 */

type AppStateStatus = "active" | "background" | "inactive" | "unknown";

type AppStateSubscription = { remove: () => void };

export const AppState: {
  currentState: AppStateStatus;
  addEventListener: (
    type: "change" | "memoryWarning" | "blur" | "focus",
    listener: (state: AppStateStatus) => void,
  ) => AppStateSubscription;
  removeEventListener: (
    type: "change" | "memoryWarning" | "blur" | "focus",
    listener: (state: AppStateStatus) => void,
  ) => void;
} = {
  currentState: "active",
  addEventListener: () => ({ remove: () => undefined }),
  removeEventListener: () => undefined,
};

export type { AppStateStatus };

export const Platform = {
  OS: "ios" as "ios" | "android" | "windows" | "macos" | "web",
  select<T>(spec: { ios?: T; android?: T; default?: T }): T | undefined {
    return spec.ios ?? spec.default;
  },
};
