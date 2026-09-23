# Rider App — Agent Instructions

## Quick Commands

| Task                              | Command               |
| --------------------------------- | --------------------- |
| Start dev server                  | `npm start`           |
| Run on Android                    | `npm run android`     |
| Run on iOS                        | `npm run ios`         |
| Typecheck                         | `npm run typecheck`   |
| Lint                              | `npm run lint`        |
| Test (unit)                       | `npm test`            |
| Test (Firebase rules/integration) | `npm run test:rules`  |
| Format                            | `npm run format`      |
| CI validation (local)             | `npm run validate:ci` |

**CI order:** `typecheck → lint → test` (see `.github/workflows/ci.yml`)

---

## Architecture Overview

**Stack:** React Native 0.79 + Expo 53 + TypeScript 5.8 + Firebase 11

**Structure:**

```
src/
  app/              # App entry, navigation, theme
  core/             # Shared infrastructure (location, firebase, identity, storage, etc.)
  features/
    riding/         # Group riding feature (main feature currently)
  security/         # Firebase rules tests
  shared/           # (empty placeholder)
```

**Module ownership** (per ADRs):

- Location → `core/location`
- Identity/Auth → `core/identity`
- Riding/Groups → `features/riding`
- Firebase config → `core/firebase`

---

## Key Conventions

### TypeScript

- Strict mode enabled (`tsconfig.json`)
- Path alias: `@/*` → `src/*`
- Type errors = build failures
- No `@ts-ignore` without justification

### Testing

- **Unit/component tests:** `jest.config.js` (jest-expo preset), ignore `/src/security/**` and `/src/features/riding/firebase.integration.test.ts`
- **Firebase rules/integration:** `jest.firebase.config.js` (node env, `*.rules.test.ts` and `*.integration.test.ts`)
- Run Firebase tests: `npm run test:rules` (requires emulators)

### Firebase Emulators

```bash
# Terminal 1: start emulators
npm run firebase:emulators

# Terminal 2: run tests against emulators
npm run test:rules
```

### Lint/Format

- ESLint flat config (`eslint.config.js`) with `eslint-config-expo` + Prettier
- `no-console` warns (allow: warn, error, info, debug)
- Format on save recommended

### Platform-Specific Code

- Use `foo.ts` / `foo.ios.ts` / `foo.android.ts` pattern
- Don't scatter `Platform.OS` checks

---

## Important Constraints

1. **Location is centralized** — never implement GPS logic in features (groups, navigation, trips, safety). Use `core/location`.
2. **Offline-first** — location/trip recording must continue locally; queue pending data; sync on reconnect.
3. **Server-side authz** — all authorization decisions enforced server-side (Firebase rules).
4. **No hardcoded secrets** — use `expo-secure-store` for device-side secrets.
5. **Realtime freshness** — every realtime entity must define: connection state, last update, stale threshold, reconnect behavior.
6. **UI states required** — initial, loading, success, empty, error, offline, permission denied, unauthorized, expired, retrying, cancelled (+ connecting/connected/disconnected/reconnecting/stale/recovered for realtime).
7. **Two-device testing required** for: live location, group membership, realtime presence, rider separation, messaging, SOS, ride lifecycle.

---

## ADRs (Architecture Decision Records)

Located in `docs/decisions/`:

- ADR-001: Foundation baseline
- ADR-002: Firebase realtime location config
- ADR-003: Riding group ride core

Reference these before making architectural changes.

---

## Firebase Config

- Project: `rider-app-emulator` (emulators)
- Rules: `firestore.rules`, `database.rules.json`
- Rules tests: `src/security/firebase.rules.test.ts`
- Integration tests: `src/features/riding/firebase.integration.test.ts`

---

## Development Builds

Use Expo development builds (`expo-dev-client`). Do not design around Expo Go limitations. New native deps must be evaluated for iOS/Android/Expo/RN compatibility, maintenance, build/runtime implications.

---

## Git Workflow

- Main branch: `main` (or `master`)
- CI runs on push/PR to main/master
- `validate:ci` runs the full CI pipeline locally
