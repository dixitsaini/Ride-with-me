import * as TaskManager from "expo-task-manager";
import { PLATFORM_VALIDATION_REQUIRED } from "./ExpoLocationAdapter";

export const BACKGROUND_LOCATION_TASK = "background-location-task";

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[background-location-task]", error);
  }

  if (data) {
    console.info("[background-location-task]", { data });
  }
});

export const BACKGROUND_LOCATION_PLATFORM_REQUIREMENTS = {
  ios: PLATFORM_VALIDATION_REQUIRED,
  android: PLATFORM_VALIDATION_REQUIRED,
  lifecycle: PLATFORM_VALIDATION_REQUIRED,
  terminatedApp: PLATFORM_VALIDATION_REQUIRED,
};
