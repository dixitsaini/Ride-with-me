import {
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from "firebase/app";

export type FirebaseRuntimeConfig = FirebaseOptions & {
  environment: "development" | "staging" | "production";
};

export function getFirebaseConfig(): FirebaseRuntimeConfig {
  return {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    environment:
      (process.env
        .EXPO_PUBLIC_ENVIRONMENT as FirebaseRuntimeConfig["environment"]) ??
      "development",
  };
}

function assertFirebaseConfig(
  config: FirebaseRuntimeConfig,
): asserts config is FirebaseRuntimeConfig & {
  apiKey: string;
  databaseURL: string;
  projectId: string;
  appId: string;
} {
  const required: (keyof FirebaseRuntimeConfig)[] = [
    "apiKey",
    "databaseURL",
    "projectId",
    "appId",
  ];

  if (required.some((key) => !config[key])) {
    throw new Error(
      "Firebase configuration is incomplete. Set the EXPO_PUBLIC_FIREBASE_* variables.",
    );
  }
}

export function getFirebaseApp(): FirebaseApp {
  const existingApp = getApps()[0];
  if (existingApp) {
    return existingApp;
  }

  const config = getFirebaseConfig();
  assertFirebaseConfig(config);
  return initializeApp(config);
}
