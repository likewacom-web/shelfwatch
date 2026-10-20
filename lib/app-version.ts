export function getDisplayAppVersion(nativeVersion?: string | null, configVersion?: string | null): string {
  return nativeVersion ?? configVersion ?? "ไม่ทราบ";
}
