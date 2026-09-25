# Location domain foundation

This module provides the shared location model, the real location engine, and the platform-independent boundaries for ride, navigation, trip, and safety features.

Core principles:

- Normalize values to a single shared model.
- Keep feature modules dependent on the shared location service, not on native APIs.
- Keep the state machine explicit and centralized.
- Allow platform adaptations behind a service interface.
- Keep map-facing logic separate from the core domain logic.
- Buffer locally first, publish second. Never drop a sample just because the network is gone.

## Data flow

```
expo-location (GPS)
      │
      ▼
ExpoLocationAdapter  ── implements ──►  LocationService
      │  (provider boundary, one only)
      ▼
LocationEngine
      │  sample gate  (validity, dedupe, ordering, accuracy, staleness)
      │  buffer       (persistent, local-first)
      │  publisher    (bound at runtime via setPublisher)
      ▼
Firebase RTDB publish path   (via features/riding/service.ts)
```

Background updates are forwarded by `background.ts` into `backgroundSink.ts`, which the engine drains on foreground.

## Files

| File                                  | Responsibility                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                            | Shared types, `LocationState` machine, `transitionLocationState`, `createLocationController`, mock service                                    |
| `LocationEngine.ts`                   | The real engine: permission/GPS session, sampling, buffering, publishing, flush/retry, pause/resume, stale recovery, app-state suspend/resume |
| `ExpoLocationAdapter.ts`              | Thin `expo-location` wrapper. The only place that touches the native location API                                                             |
| `locationProvider.ts`                 | Dependency injection seam (`real` by default, `mock` only when `EXPO_PUBLIC_LOCATION_PROVIDER=mock`)                                          |
| `sampleGate.ts`                       | Accept/reject a sample: invalid, stale, duplicate, out-of-order, accuracy                                                                     |
| `samplingPolicy.ts`                   | Independent sampling policy: intervals, accuracy, thresholds, retry/backoff                                                                   |
| `persistentBuffer.ts`                 | Local-first buffer with retention, persistence, and sync bookkeeping                                                                          |
| `appStateSource.ts`                   | Injectable foreground/background source (`react-native` `AppState` by default)                                                                |
| `background.ts` / `backgroundSink.ts` | Background task forwarding into the engine                                                                                                    |
| `../permissions/index.ts`             | Permission registry. Sources are registered by the engine, never hardcoded                                                                    |

## States

Permission: `NOT_REQUESTED → REQUESTED → GRANTED|DENIED|BLOCKED|LIMITED|RESTRICTED`

Tracking lifecycle (`LocationState`):

- `PERMISSION_REQUIRED`, `REQUESTED`, `PERMISSION_DENIED`, `PERMISSION_BLOCKED`, `PERMISSION_LIMITED`
- `AUTHORIZED` → `TRACKING`
- `TRACKING → STALE → RECOVERING → TRACKING`
- `TRACKING → OFFLINE_BUFFERING → SYNCING → TRACKING`
- `AUTHORIZED → PAUSED_BY_USER → AUTHORIZED`
- `AUTHORIZED → GPS_UNAVAILABLE`, `LOW_ACCURACY`, `SUSPENDED`, `ERROR`, `READY`

Transitions are computed in one place: `transitionLocationState(previous, permission, hasLocation, isOffline, stale, signals)`.

## Buffering rules

- Every accepted sample is appended to the local buffer before publishing.
- Only `publishable` samples are sent; low-accuracy samples are kept locally and reconciled on flush.
- `flush()` walks the buffer in timestamp order. Entries with `timestamp <= lastPublishedAt` are reconciled instead of re-published, so a stored position never regresses.
- Failed publishes are retained with an attempt count and retried with backoff.
- Retention: `maxSamples` (1000) and `maxAgeMs` (24h).

## Configuration

`EXPO_PUBLIC_LOCATION_PROVIDER=mock` is the only way to get the mock provider. The default is always the real provider.

## Testing

- `LocationEngine.test.ts` — permission, GPS, sampling, stale/recovery, pause/resume, offline buffer, flush, retry, persistence, background/foreground, subscription hygiene
- `sampleGate.test.ts`, `persistentBuffer.test.ts`, `samplingPolicy.test.ts` — unit coverage of the policy/gate/buffer
- `adapter.test.ts` — expo permission normalization, GPS availability, watch failure, mocked-position tagging
- `controller.test.ts` — controller over the real engine
- `locationProvider.test.ts` — DI defaults
- `permissions/index.test.ts` — permission registry
- `background.test.ts`, `appStateSource.test.ts` — background forwarding and app-state transitions

The mock path is never exercised by normal runtime; tests inject fakes through `createLocationEngine({ provider, buffer, appStateSource })`.

## Known platform limitations

- Background updates are not started. `startLocationUpdatesAsync` cannot be validated in this brick, so the background task only forwards payloads if something else starts it.
- `app.json` does not yet declare the `expo-location` plugin, iOS `NSLocation*` usage strings, or Android location permissions. Those must be added before a device build.
- Terminated-app background delivery is unverified and flagged as `PLATFORM VALIDATION_REQUIRED`.
