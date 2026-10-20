import { describe, expect, it } from "vitest";

import { createInventoryBackup, getInventoryBackupRestorePreview, getInventoryBackupSummary, INVENTORY_BACKUP_FILE_TYPE, INVENTORY_BACKUP_SCHEMA_VERSION, parseInventoryBackup, serializeInventoryBackup, type InventoryBackupProfile } from "../lib/inventory-backup";

const backupProfile: InventoryBackupProfile = {
  id: "default",
  displayName: "ผู้ใช้ทดสอบ",
  storageName: "คลังทดสอบ",
  avatarUri: "file:///profile-images/test-user.jpg",
  products: [
    {
      id: "product-milk",
      name: "นมสด",
      category: "เครื่องดื่มแช่เย็น",
      productCode: "MILK-001",
      quantity: 8,
      shelf: "A",
      row: "1",
      itemNumber: 1,
      dateType: "expiry",
      date: "2026-09-15",
      lots: [
        { id: "lot-1", batchNumber: "1", quantity: 3, dateType: "expiry", date: "2026-09-15", createdAt: "2026-08-26T00:00:00.000Z" },
        { id: "lot-2", batchNumber: "2", quantity: 5, dateType: "expiry", date: "2026-10-15", createdAt: "2026-08-26T00:00:00.000Z" },
      ],
      imageUris: ["file:///product-images/milk-front.jpg"],
      createdAt: "2026-08-26T00:00:00.000Z",
    },
  ],
  settings: { nearExpiryDays: 7, lowStockThreshold: 3, notificationsEnabled: true, nameFieldHighlightEnabled: true, colorScheme: "dark", brandColor: "#1D4ED8", backgroundImageUri: "file:///background-images/warehouse.jpg", backgroundImageOpacity: 0.18 },
  positionHistory: [
    {
      id: "history-delete",
      productId: "product-old",
      productName: "สินค้าเดิม",
      from: { shelf: "A", row: "2", itemNumber: 4 },
      changedAt: "2026-08-26T00:00:00.000Z",
      action: "delete",
      deletedProduct: {
        id: "product-old",
        name: "สินค้าเดิม",
        productCode: "OLD-001",
        quantity: 1,
        shelf: "A",
        row: "2",
        itemNumber: 4,
        dateType: "expiry",
        date: "2026-11-15",
        createdAt: "2026-08-20T00:00:00.000Z",
      },
    },
  ],
};

describe("inventory backup", () => {
  it("round-trips profiles, settings, lot details, history, and image payloads", () => {
    const backup = createInventoryBackup({
      activeUserId: "default",
      profiles: [backupProfile, { ...backupProfile, id: "user-branch", displayName: "สาขา B", storageName: "คลังสาขา B", products: [] }],
      images: [{ sourceUri: "file:///product-images/milk-front.jpg", extension: "jpg", base64: "aGVsbG8=" }, { sourceUri: "file:///profile-images/test-user.jpg", extension: "jpg", base64: "dXNlcg==" }, { sourceUri: "file:///background-images/warehouse.jpg", extension: "jpg", base64: "YmFja2dyb3VuZA==" }],
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const parsed = parseInventoryBackup(serializeInventoryBackup(backup));

    expect(parsed.activeUserId).toBe("default");
    expect(parsed.profiles).toHaveLength(2);
    expect(parsed.profiles[0]?.products[0]?.lots?.map((lot) => lot.quantity)).toEqual([3, 5]);
    expect(parsed.profiles[0]?.products[0]?.quantity).toBe(8);
    expect(parsed.profiles[0]?.products[0]?.category).toBe("เครื่องดื่มแช่เย็น");
    expect(parsed.profiles[0]?.positionHistory[0]?.deletedProduct?.id).toBe("product-old");
    expect(parsed.profiles[0]?.avatarUri).toBe("file:///profile-images/test-user.jpg");
    expect(parsed.profiles[0]?.settings.backgroundImageUri).toBe("file:///background-images/warehouse.jpg");
    expect(parsed.images).toEqual([{ sourceUri: "file:///product-images/milk-front.jpg", extension: "jpg", base64: "aGVsbG8=" }, { sourceUri: "file:///profile-images/test-user.jpg", extension: "jpg", base64: "dXNlcg==" }, { sourceUri: "file:///background-images/warehouse.jpg", extension: "jpg", base64: "YmFja2dyb3VuZA==" }]);
    expect(getInventoryBackupSummary(parsed)).toEqual({ createdAt: "2026-08-27T00:00:00.000Z", profileCount: 2, productCount: 1, historyCount: 2, imageCount: 3 });
  });

  it("uses lot quantities as the source of truth when normalizing a backup", () => {
    const backup = createInventoryBackup({ activeUserId: "default", profiles: [backupProfile], createdAt: "2026-08-27T00:00:00.000Z" });
    const raw = JSON.parse(serializeInventoryBackup(backup)) as { profiles: Array<{ products: Array<{ quantity: number }> }> };
    raw.profiles[0]!.products[0]!.quantity = 999;
    const parsed = parseInventoryBackup(JSON.stringify(raw));

    expect(parsed.profiles[0]?.products[0]?.quantity).toBe(8);
  });

  it("keeps insertion history that has only a destination position", () => {
    const insertionProfile: InventoryBackupProfile = {
      ...backupProfile,
      positionHistory: [{ id: "history-insert", productId: "product-milk", productName: "นมสด", to: { shelf: "A", row: "1", itemNumber: 2 }, changedAt: "2026-08-27T00:00:00.000Z", action: "insert" }],
    };
    const backup = createInventoryBackup({ activeUserId: "default", profiles: [insertionProfile], createdAt: "2026-08-27T00:00:00.000Z" });
    const parsed = parseInventoryBackup(serializeInventoryBackup(backup));

    expect(parsed.profiles[0]?.positionHistory[0]).toMatchObject({ action: "insert", to: { shelf: "A", row: "1", itemNumber: 2 } });
    expect(parsed.profiles[0]?.positionHistory[0]?.from).toBeUndefined();
  });

  it("summarizes profiles, lots, history, images, and the active user before restore", () => {
    const backup = createInventoryBackup({
      activeUserId: "default",
      profiles: [backupProfile, { ...backupProfile, id: "user-branch", displayName: "สาขา B", storageName: "คลังสาขา B", products: [], positionHistory: [] }],
      images: [{ sourceUri: "file:///product-images/milk-front.jpg", extension: "jpg", base64: "aGVsbG8=" }, { sourceUri: "file:///profile-images/test-user.jpg", extension: "jpg", base64: "dXNlcg==" }, { sourceUri: "file:///background-images/warehouse.jpg", extension: "jpg", base64: "YmFja2dyb3VuZA==" }],
      createdAt: "2026-08-27T00:00:00.000Z",
    });
    const preview = getInventoryBackupRestorePreview(backup);

    expect(preview.activeProfileName).toBe("ผู้ใช้ทดสอบ");
    expect(preview.lotCount).toBe(2);
    expect(preview.imageCount).toBe(3);
    expect(preview.profiles).toEqual([
      { id: "default", displayName: "ผู้ใช้ทดสอบ", storageName: "คลังทดสอบ", productCount: 1, lotCount: 2, historyCount: 1, isActiveProfile: true },
      { id: "user-branch", displayName: "สาขา B", storageName: "คลังสาขา B", productCount: 0, lotCount: 0, historyCount: 0, isActiveProfile: false },
    ]);
  });

  it("rejects files that are not ShelfWatch backups or use unsupported schema versions", () => {
    expect(() => parseInventoryBackup(JSON.stringify({ type: "other-app", schemaVersion: INVENTORY_BACKUP_SCHEMA_VERSION }))).toThrow("ไม่ใช่ไฟล์สำรองของ ShelfWatch");
    expect(() => parseInventoryBackup(JSON.stringify({ type: INVENTORY_BACKUP_FILE_TYPE, schemaVersion: 999, createdAt: "2026-08-27T00:00:00.000Z", activeUserId: "default", profiles: [], images: [] }))).toThrow("เวอร์ชันที่ยังไม่รองรับ");
  });

  it("rejects malformed or incomplete restore data before it can replace device data", () => {
    const backup = createInventoryBackup({ activeUserId: "default", profiles: [backupProfile], createdAt: "2026-08-27T00:00:00.000Z" });
    const raw = JSON.parse(serializeInventoryBackup(backup)) as { activeUserId: string; images: Array<{ sourceUri: string; extension: string; base64: string }> };
    raw.activeUserId = "missing-user";
    expect(() => parseInventoryBackup(JSON.stringify(raw))).toThrow("ไม่พบผู้ใช้ที่กำลังใช้งาน");

    const malformedImage = { ...backup, images: [{ sourceUri: "file:///image.jpg", extension: "jpg", base64: "not-a-base64!" }] };
    expect(() => parseInventoryBackup(JSON.stringify(malformedImage))).toThrow("ข้อมูลรูปสินค้าไม่ถูกต้อง");

    const malformedDate = JSON.parse(serializeInventoryBackup(backup)) as { profiles: Array<{ products: Array<{ date: string }> }> };
    malformedDate.profiles[0]!.products[0]!.date = "2026-02-31";
    expect(() => parseInventoryBackup(JSON.stringify(malformedDate))).toThrow("วันที่สินค้าไม่ถูกต้อง");

    const invalidOpacity = JSON.parse(serializeInventoryBackup(backup)) as { profiles: Array<{ settings: { backgroundImageOpacity: number } }> };
    invalidOpacity.profiles[0]!.settings.backgroundImageOpacity = 0.9;
    expect(() => parseInventoryBackup(JSON.stringify(invalidOpacity))).toThrow("ระดับความโปร่งใสพื้นหลังไม่ถูกต้อง");
  });
});
