# ADR-002: Firebase Realtime Location Transport

## Context

Phase 1C needs a real transport for ephemeral live location while keeping the
location and map modules independent from vendor SDKs.

## Decision

Use the Firebase JavaScript SDK with Firebase Authentication anonymous identity
for development and Firebase Realtime Database for live location. The SDK is
isolated behind `FirebaseRealtimeLocationAdapter`, `FirebaseAnonymousIdentityAdapter`,
and the centralized Firebase configuration module.

Live records use `/liveLocations/{contextId}/{userId}` and contain only location
coordinates, timestamp, accuracy, speed, and heading. The domain queue remains
the application buffering boundary; Firebase owns transport reconnect behavior.

## Temporary development authorization

Authenticated development users may read a context and may write only their own
user record. Final group-membership authorization is intentionally deferred.
The rules are in `database.rules.json` and reject unauthenticated access.

## Alternatives considered

- React Native Firebase: deferred because no native-only requirement exists.
- A custom synchronization queue: rejected because it would duplicate Firebase
  transport persistence and reconnect behavior.

## Consequences

Firebase configuration must be supplied through `EXPO_PUBLIC_FIREBASE_*`
environment variables. API keys and project identifiers are not authorization;
Realtime Database rules remain the enforcement boundary.

## PLATFORM VALIDATION REQUIRED

Physical-device validation is still required for Firebase connection on iOS and
Android, two-client updates, background behavior, network switching, offline
recovery, and battery impact.
