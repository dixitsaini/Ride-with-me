# ADR-003: Riding Group and Ride Core

## Context

Phase 2A introduces the first product module. Durable group, membership,
invitation, and ride metadata need a clear owner while high-frequency live
location remains in the existing Realtime Location module.

## Decision

The Riding application service owns product orchestration and authorization
checks. The Riding domain owns membership states, invitation validity, ride
lifecycle transitions, and rider participation states.

Firestore owns:

- `groups/{groupId}`
- `groups/{groupId}/members/{userId}`
- `groupInvitations/{invitationId}`
- `rides/{rideId}` and ride participant metadata

Realtime Database owns live location transport under a ride context. A ride
provisions user-scoped access at `/liveLocations/{rideId}/access/{userId}` and
publishes location records at `/liveLocations/{rideId}/locations/{userId}`.

The map consumes `RidingService` updates and the existing MapProvider boundary.
Screens do not import Firebase SDKs or persistence repositories directly.

## Development providers

The application defaults to in-memory Firestore-shaped repositories and the
mock realtime provider. `EXPO_PUBLIC_DATA_PROVIDER=firebase` selects Firestore;
`EXPO_PUBLIC_REALTIME_PROVIDER=firebase` selects Firebase Realtime Database.
The entitlement boundary currently supplies development defaults.

## Consequences

The client now has a complete create, join, start, pause, resume, and complete
ride path. Server rules remain authoritative: Firestore requires authenticated
group membership and admin controls, while Realtime Database requires an
authorized context and self-owned location writes.

## PLATFORM VALIDATION REQUIRED

iOS and Android navigation, Firestore persistence, Firebase Auth identity,
two-user group joining, two-client live map updates, stale/offline recovery,
background behavior, and battery impact still require device validation.
