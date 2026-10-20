export type UpdateConnectionStatus = "ready" | "not-configured" | "development";

export function getUpdateConnectionStatus(platform: string, isDevelopment: boolean, isEnabled: boolean): UpdateConnectionStatus {
  if (platform === "web" || isDevelopment) return "development";
  return isEnabled ? "ready" : "not-configured";
}
