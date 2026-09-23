export type PermissionStatus =
  "granted" | "denied" | "undetermined" | "unavailable";

export type PermissionName =
  "notifications" | "location" | "camera" | "microphone";

export async function requestPermission(
  _name: PermissionName,
): Promise<PermissionStatus> {
  return "undetermined";
}

export async function getPermissionStatus(
  _name: PermissionName,
): Promise<PermissionStatus> {
  return "undetermined";
}
