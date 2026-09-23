export type NotificationPayload = {
  title: string;
  body?: string;
  data?: Record<string, string>;
};

export async function scheduleLocalNotification(
  payload: NotificationPayload,
): Promise<void> {
  console.info("[notifications]", payload);
}

export async function requestNotificationPermissions(): Promise<boolean> {
  return true;
}
