export type AppEnvironment = "development" | "staging" | "production";

export type AppConfig = {
  environment: AppEnvironment;
  apiBaseUrl: string;
  enableAnalytics: boolean;
  enableLogging: boolean;
  appName: string;
};

const config: AppConfig = {
  environment:
    (process.env.EXPO_PUBLIC_ENVIRONMENT as AppEnvironment) ?? "development",
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://api.example.com",
  enableAnalytics:
    (process.env.EXPO_PUBLIC_ENABLE_ANALYTICS ?? "false") === "true",
  enableLogging: (process.env.EXPO_PUBLIC_ENABLE_LOGGING ?? "true") === "true",
  appName: "Rider App",
};

export function getAppConfig(): AppConfig {
  return config;
}
