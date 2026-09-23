# Firebase Realtime Configuration

Copy `.env.example` to an environment-specific local file and provide the
Firebase web app values. Do not commit local environment files or secrets.

Required values:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_DATABASE_URL`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`

`EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` and
`EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` are retained for the complete Firebase
configuration but are not used by the Phase 1C realtime adapter.
