export function getNativeBuildDownloadUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const url = value.trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

export function getNativeBuildVersion(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}
