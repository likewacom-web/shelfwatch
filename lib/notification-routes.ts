export const EXPIRY_ALERT_ROUTE = "/alerts";

export function getExpiryAlertDestination(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const url = (data as { url?: unknown }).url;
  return url === EXPIRY_ALERT_ROUTE ? url : null;
}
