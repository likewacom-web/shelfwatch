export interface UserProfile {
  id: string;
  displayName: string;
  storageName: string;
  avatarUri?: string;
}

export type UserProfileInput = Omit<UserProfile, "id">;

export const DEFAULT_USER_PROFILE: UserProfile = {
  id: "default",
  displayName: "ผู้ใช้ ShelfWatch",
  storageName: "คลังสินค้าของฉัน",
};

export function createUserProfile(input: UserProfileInput): UserProfile {
  return {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    displayName: input.displayName.trim(),
    storageName: input.storageName.trim(),
    avatarUri: input.avatarUri?.trim() || undefined,
  };
}

export function getUserDataStorageKey(userId: string, type: "products" | "settings" | "history" | "deleted-products"): string {
  return `shelfwatch.user-data.v2.${userId}.${type}`;
}

export function getProfileInitials(displayName: string): string {
  const letters = displayName.trim().replace(/\s+/g, "").slice(0, 2);
  return letters || "SW";
}

const PROFILE_AVATAR_COLORS = ["#2563EB", "#7C3AED", "#DB2777", "#EA580C", "#0891B2", "#16A34A", "#B45309", "#4F46E5"];

export function getProfileAvatarInitial(displayName: string): string {
  return Array.from(displayName.trim())[0] ?? "S";
}

export function getProfileAvatarColor(userId: string): string {
  const hash = Array.from(userId).reduce((total, character) => ((total * 31) + character.codePointAt(0)!) >>> 0, 7);
  return PROFILE_AVATAR_COLORS[hash % PROFILE_AVATAR_COLORS.length]!;
}
