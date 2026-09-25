export type PermissionStatus =
  "granted" | "denied" | "blocked" | "limited" | "undetermined" | "unavailable";

export type PermissionName =
  "notifications" | "location" | "camera" | "microphone";

export type PermissionSource = {
  getStatus: () => Promise<PermissionStatus>;
  request?: () => Promise<PermissionStatus>;
};

const sources = new Map<PermissionName, PermissionSource>();

export function registerPermissionSource(
  name: PermissionName,
  source: PermissionSource,
): () => void {
  sources.set(name, source);
  return () => {
    if (sources.get(name) === source) {
      sources.delete(name);
    }
  };
}

export function hasPermissionSource(name: PermissionName): boolean {
  return sources.has(name);
}

export function clearPermissionSources(): void {
  sources.clear();
}

export async function getPermissionStatus(
  name: PermissionName,
): Promise<PermissionStatus> {
  const source = sources.get(name);
  if (!source) {
    return "unavailable";
  }

  try {
    return await source.getStatus();
  } catch {
    return "unavailable";
  }
}

export async function requestPermission(
  name: PermissionName,
): Promise<PermissionStatus> {
  const source = sources.get(name);
  if (!source) {
    return "unavailable";
  }

  try {
    if (source.request) {
      return await source.request();
    }
    return await source.getStatus();
  } catch {
    return "unavailable";
  }
}
