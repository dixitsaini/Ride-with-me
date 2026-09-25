import { AppState, type AppStateStatus } from "react-native";
import type { LocationAppState } from "./index";

export type LocationAppStateSource = {
  getState: () => LocationAppState;
  subscribe: (listener: (state: LocationAppState) => void) => () => void;
};

export function normalizeAppState(
  status: AppStateStatus | string | null | undefined,
): LocationAppState {
  switch (status) {
    case "active":
      return "foreground";
    case "background":
      return "background";
    case "inactive":
      return "inactive";
    default:
      return "unknown";
  }
}

export function createReactNativeAppStateSource(): LocationAppStateSource {
  return {
    getState: () => normalizeAppState(AppState.currentState),
    subscribe: (listener) => {
      const subscription = AppState.addEventListener("change", (status) => {
        listener(normalizeAppState(status));
      });
      return () => subscription.remove();
    },
  };
}

export type InMemoryAppStateSource = LocationAppStateSource & {
  setState: (state: LocationAppState) => void;
};

export function createInMemoryAppStateSource(
  initial: LocationAppState = "foreground",
): InMemoryAppStateSource {
  let current = initial;
  const listeners = new Set<(state: LocationAppState) => void>();

  return {
    getState: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState: (state) => {
      if (state === current) {
        return;
      }
      current = state;
      listeners.forEach((listener) => listener(state));
    },
  };
}
