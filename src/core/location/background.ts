import * as TaskManager from "expo-task-manager";
import {
  BACKGROUND_LOCATION_TASK,
  handleBackgroundLocationEvent,
} from "./backgroundLocation";

export * from "./backgroundLocation";

let taskRegistered = false;

/**
 * Registers the OS background location task exactly once. Expo requires the
 * task to be defined while the entry module is still evaluating, so this runs
 * at import time; the exported function keeps registration explicit for tests
 * and for code paths that are loaded lazily.
 */
export function registerBackgroundLocationTask(): boolean {
  if (taskRegistered) {
    return false;
  }
  taskRegistered = true;
  TaskManager.defineTask(
    BACKGROUND_LOCATION_TASK,
    handleBackgroundLocationEvent,
  );
  return true;
}

registerBackgroundLocationTask();
