/**
 * Rider display identity resolution for the map layer.
 *
 * The repository has no profile/display-name source yet, so the map must not
 * invent one. It resolves a display name when a resolver is supplied and
 * otherwise falls back to a stable, pseudonymous label derived from the rider
 * reference so raw user ids are never surfaced on the map.
 */

export type RiderDisplayIdentity = {
  riderId: string;
  displayName: string | null;
  /** Never empty. Safe to render directly on a marker. */
  label: string;
};

export type DisplayNameResolver = (
  riderId: string,
) => string | null | undefined;

export function createRiderFallbackLabel(riderId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < riderId.length; index += 1) {
    hash ^= riderId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `Rider ${hash.toString(16).toUpperCase().padStart(8, "0").slice(0, 4)}`;
}

export function resolveRiderDisplayIdentity(
  riderId: string,
  displayName?: string | null,
): RiderDisplayIdentity {
  const trimmed = typeof displayName === "string" ? displayName.trim() : "";
  return {
    riderId,
    displayName: trimmed.length > 0 ? trimmed : null,
    label: trimmed.length > 0 ? trimmed : createRiderFallbackLabel(riderId),
  };
}

export function resolveRiderIdentity(
  riderId: string,
  resolver?: DisplayNameResolver,
): RiderDisplayIdentity {
  return resolveRiderDisplayIdentity(riderId, resolver?.(riderId) ?? null);
}
