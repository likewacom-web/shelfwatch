export function shouldCheckForUpdate(platform: string, isDevelopment: boolean, isChecking: boolean, isEnabled = true) {
  return platform !== "web" && !isDevelopment && !isChecking && isEnabled;
}
