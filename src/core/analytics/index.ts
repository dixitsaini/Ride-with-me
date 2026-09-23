export type AnalyticsEvent = {
  name: string;
  properties?: Record<string, string | number | boolean | null | undefined>;
};

export function trackAnalytics(event: AnalyticsEvent): void {
  if (__DEV__) {
    console.info("[analytics]", event.name, event.properties ?? {});
  }
}
