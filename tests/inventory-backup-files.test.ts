import { describe, expect, it } from "vitest";

import { assertBackupSerializedSize, canIncludeBackupImage, MAX_BACKUP_IMAGE_BYTES, MAX_BACKUP_SERIALIZED_CHARACTERS, MAX_BACKUP_TOTAL_IMAGE_BYTES } from "../lib/inventory-backup-policy";

describe("backup image size limits", () => {
  it("includes small images while the aggregate size remains safe", () => {
    expect(canIncludeBackupImage(512 * 1024, 0)).toBe(true);
    expect(canIncludeBackupImage(MAX_BACKUP_IMAGE_BYTES, MAX_BACKUP_TOTAL_IMAGE_BYTES - MAX_BACKUP_IMAGE_BYTES)).toBe(true);
  });

  it("skips individual or combined images that could make Android backups too large", () => {
    expect(canIncludeBackupImage(MAX_BACKUP_IMAGE_BYTES + 1, 0)).toBe(false);
    expect(canIncludeBackupImage(1, MAX_BACKUP_TOTAL_IMAGE_BYTES)).toBe(false);
  });

  it("blocks an oversized serialized backup before FileSystem tries to write it", () => {
    expect(() => assertBackupSerializedSize("backup")).not.toThrow();
    expect(() => assertBackupSerializedSize("x".repeat(MAX_BACKUP_SERIALIZED_CHARACTERS + 1))).toThrow("ขนาดใหญ่เกิน");
  });
});
