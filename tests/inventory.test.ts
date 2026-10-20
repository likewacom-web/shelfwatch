import { describe, expect, it } from "vitest";

import { addLotToProduct, buildStorageMap, calculateExpiryDate, createISODateFromParts, findProductAtPosition, findProductByCode, findDuplicateBarcode, formatProductPosition, getBatchBadgeTheme, getDaysRemaining, getDaysRemainingForProduct, getLotAlerts, getNextAvailableItemNumber, getNextBatchNumber, getNextItemNumberAfterSave, getProductCategories, getProductCategoryLabel, getProductGradeLabel, getProductGradeTheme, getProductImageUris, normalizeProductGrade, getProductLots, getProductStatus, insertProductIntoRow, matchesProductSearch, moveProductWithinRow, normalizeProductCategory, parseLocalDate, relocateProduct, removeProductLot, restoreDeletedProduct, sortProductsForShelves, summarizeProductStatuses, summarizeRows, comparePositionLabels, type Product, updateProductLotQuantity } from "../lib/inventory";
import { EXPIRY_ALERT_ROUTE, getExpiryAlertDestination } from "../lib/notification-routes";
import { createUserProfile, getProfileAvatarColor, getProfileAvatarInitial, getProfileInitials, getUserDataStorageKey } from "../lib/user-profile";
import { createProductBarcode } from "../lib/product-barcode";
import { normalizeVoiceSearchQuery } from "../lib/voice-search";

const referenceDate = new Date(2026, 7, 26, 12, 0, 0);

describe("product grades", () => {
  it("accepts only A, B, and C grades and keeps legacy values ungraded", () => {
    expect(normalizeProductGrade("A")).toBe("A");
    expect(normalizeProductGrade("B")).toBe("B");
    expect(normalizeProductGrade("C")).toBe("C");
    expect(normalizeProductGrade("D")).toBeUndefined();
    expect(getProductGradeLabel("A")).toBe("เกรด A");
    expect(getProductGradeTheme("A").textColor).toBe("#166534");
    expect(getProductGradeTheme("C").textColor).toBe("#991B1B");
  });
});

describe("expiry calculations", () => {
  it("validates ISO dates and rejects invalid calendar dates", () => {
    expect(parseLocalDate("2026-08-31")).not.toBeNull();
    expect(parseLocalDate("2026-02-31")).toBeNull();
    expect(parseLocalDate("31-08-2026")).toBeNull();
  });

  it("creates ISO dates from day, month, and Gregorian or Buddhist years", () => {
    expect(createISODateFromParts({ day: "31", month: "12", year: "2569" })).toBe("2026-12-31");
    expect(createISODateFromParts({ day: "31", month: "12", year: "2026" })).toBe("2026-12-31");
    expect(createISODateFromParts({ day: "31", month: "2", year: "2569" })).toBeNull();
  });

  it("recognizes only the urgent-list route in notification data", () => {
    expect(getExpiryAlertDestination({ url: EXPIRY_ALERT_ROUTE })).toBe("/alerts");
    expect(getExpiryAlertDestination({ url: "/settings" })).toBeNull();
    expect(getExpiryAlertDestination(null)).toBeNull();
  });

  it("creates profile initials for the user page", () => {
    expect(getProfileInitials("สมชาย ใจดี")).toBe("สม");
    expect(getProfileInitials("  ")).toBe("SW");
    expect(getProfileAvatarInitial("สมชาย ใจดี")).toBe("ส");
    expect(getProfileAvatarInitial("  ")).toBe("S");
    expect(getProfileAvatarColor("user-a")).toBe(getProfileAvatarColor("user-a"));
    expect(getProfileAvatarColor("user-a")).not.toBe(getProfileAvatarColor("user-b"));
  });

  it("creates independent local user profiles", () => {
    const user = createUserProfile({ displayName: "  คลังสาขา A ", storageName: "  สาขาพระนคร  ", avatarUri: "file:///profile-images/branch-a.jpg" });
    expect(user.id).toMatch(/^user-/);
    expect(user.displayName).toBe("คลังสาขา A");
    expect(user.storageName).toBe("สาขาพระนคร");
    expect(user.avatarUri).toBe("file:///profile-images/branch-a.jpg");
    expect(getUserDataStorageKey(user.id, "products")).not.toBe(getUserDataStorageKey("default", "products"));
  });

  it("uses multiple product images while retaining compatibility with a single legacy image", () => {
    expect(getProductImageUris({ imageUri: "file:///legacy.jpg" })).toEqual(["file:///legacy.jpg"]);
    expect(getProductImageUris({ imageUri: "file:///legacy.jpg", imageUris: ["file:///front.jpg", "file:///side.jpg", ""] })).toEqual(["file:///front.jpg", "file:///side.jpg"]);
  });

  it("normalizes a voice transcript before using it as a product search query", () => {
    expect(normalizeVoiceSearchQuery("  นมสด   พาสเจอร์ไรส์  ")).toBe("นมสด พาสเจอร์ไรส์");
    expect(normalizeVoiceSearchQuery("   ")).toBe("");
  });

  it("allows the same product code to remain distinguishable by lot and expiry date", () => {
    const firstLot: Product = { id: "lot-a", name: "นมสด", productCode: "MILK-001", batchNumber: "LOT-A", quantity: 6, shelf: "1", row: "1", itemNumber: 1, dateType: "expiry", date: "2026-09-10", createdAt: "2026-08-26T00:00:00.000Z" };
    const secondLot: Product = { ...firstLot, id: "lot-b", batchNumber: "LOT-B", quantity: 4, itemNumber: 2, date: "2026-10-10" };
    expect(firstLot.productCode).toBe(secondLot.productCode);
    expect(firstLot.date).not.toBe(secondLot.date);
    expect(matchesProductSearch(secondLot, "lot-b")).toBe(true);
  });

  it("suggests the next numeric lot for the same product code", () => {
    const products: Product[] = [
      { id: "lot-1", name: "นมสด", productCode: "MILK-001", batchNumber: "1", quantity: 6, shelf: "1", row: "1", itemNumber: 1, dateType: "expiry", date: "2026-09-10", createdAt: "2026-08-26T00:00:00.000Z" },
      { id: "lot-2", name: "นมสด", productCode: "MILK-001", batchNumber: "3", quantity: 4, shelf: "1", row: "1", itemNumber: 2, dateType: "expiry", date: "2026-10-10", createdAt: "2026-08-26T00:00:00.000Z" },
    ];
    expect(getNextBatchNumber(products, "นมสด", "MILK-001")).toBe(4);
    expect(getNextBatchNumber(products, "", "")).toBeNull();
  });

  it("assigns a stable but varied color theme to each numeric lot badge", () => {
    expect(getBatchBadgeTheme("1")).toEqual(getBatchBadgeTheme("1"));
    expect(getBatchBadgeTheme("1")).not.toEqual(getBatchBadgeTheme("2"));
    expect(getBatchBadgeTheme()).toEqual(getBatchBadgeTheme(""));
  });

  it("adds a new lot inside the existing product without changing its position", () => {
    const source: Product = { id: "source", name: "นมสด", productCode: "MILK-001", batchNumber: "1", quantity: 6, shelf: "1", row: "1", itemNumber: 1, dateType: "expiry", date: "2026-09-10", createdAt: "2026-08-26T00:00:00.000Z" };
    const updated = addLotToProduct(source, { batchNumber: "1", quantity: 4, dateType: "expiry", date: "2026-10-10" });
    expect(updated.id).toBe(source.id);
    expect(updated.itemNumber).toBe(1);
    expect(updated.quantity).toBe(10);
    expect(getProductLots(updated).map((lot) => lot.batchNumber)).toEqual(["1", "2"]);
  });

  it("updates lot quantity and removes only an empty lot", () => {
    const product: Product = { id: "source", name: "นมสด", productCode: "MILK-001", quantity: 5, shelf: "1", row: "1", itemNumber: 1, dateType: "expiry", date: "2026-09-10", lots: [{ id: "lot-1", batchNumber: "1", quantity: 5, dateType: "expiry", date: "2026-09-10", createdAt: "2026-08-26T00:00:00.000Z" }], createdAt: "2026-08-26T00:00:00.000Z" };
    const depleted = updateProductLotQuantity(product, "lot-1", 0);
    expect(depleted?.quantity).toBe(0);
    expect(removeProductLot(product, "lot-1")).toBeNull();
    expect(removeProductLot(depleted!, "lot-1")).toBeNull();
  });

  it("creates separate lot alerts for near expiry and low stock", () => {
    const product: Product = { id: "source", name: "นมสด", productCode: "MILK-001", quantity: 2, shelf: "1", row: "1", itemNumber: 1, dateType: "expiry", date: "2026-08-29", lots: [{ id: "lot-1", batchNumber: "1", quantity: 2, dateType: "expiry", date: "2026-08-29", createdAt: "2026-08-26T00:00:00.000Z" }], createdAt: "2026-08-26T00:00:00.000Z" };
    const alerts = getLotAlerts([product], { nearExpiryDays: 7, lowStockThreshold: 3, notificationsEnabled: true, nameFieldHighlightEnabled: true, colorScheme: "light", brandColor: "#1D4ED8", backgroundImageOpacity: 0.18 }, referenceDate);
    expect(alerts.map((alert) => alert.type)).toEqual(["near-expiry", "low-stock"]);
  });

  it("encodes a product code as a Code 128 barcode", () => {
    const barcode = createProductBarcode("MILK-001");
    expect(barcode).not.toBeNull();
    expect(barcode?.pattern).toMatch(/^[01]+$/);
    expect(barcode?.pattern.startsWith("11010010000")).toBe(true);
    expect(createProductBarcode("   ")).toBeNull();
    expect(createProductBarcode("รหัสไทย")).toBeNull();
  });

  it("calculates whole remaining days from the device-local date", () => {
    expect(getDaysRemaining("2026-08-26", referenceDate)).toBe(0);
    expect(getDaysRemaining("2026-08-29", referenceDate)).toBe(3);
    expect(getDaysRemaining("2026-08-25", referenceDate)).toBe(-1);
  });

  it("calculates expiry dates from manufacture dates and shelf life", () => {
    const manufacturedProduct = { dateType: "manufactured" as const, date: "2026-08-01", shelfLifeDays: 30 };
    expect(calculateExpiryDate("2026-08-01", 30)).toBe("2026-08-31");
    expect(getDaysRemainingForProduct(manufacturedProduct, referenceDate)).toBe(5);
    expect(getProductStatus(manufacturedProduct, 7, referenceDate)).toBe("urgent");
  });

  it("classifies expired, urgent, and safe inventory correctly", () => {
    expect(getProductStatus({ dateType: "expiry", date: "2026-08-25" }, 7, referenceDate)).toBe("expired");
    expect(getProductStatus({ dateType: "expiry", date: "2026-08-30" }, 7, referenceDate)).toBe("urgent");
    expect(getProductStatus({ dateType: "expiry", date: "2026-09-10" }, 7, referenceDate)).toBe("safe");
    expect(getProductStatus({ dateType: "manufactured", date: "2026-08-25" }, 7, referenceDate)).toBe("safe");
  });

  it("summarizes safe, urgent, and expired products for the status chart", () => {
    const products = ["2026-08-25", "2026-08-29", "2026-09-10"].map((date, index): Product => ({ id: String(index), name: String(index), productCode: String(index), quantity: 1, shelf: "A", row: "1", dateType: "expiry", date, createdAt: "2026-08-26T00:00:00.000Z" }));
    expect(summarizeProductStatuses(products, 7, referenceDate)).toEqual({ expired: 1, urgent: 1, safe: 1 });
  });

  it("applies the selected advance-notice duration to the urgent status", () => {
    const product = { dateType: "expiry" as const, date: "2026-08-29" };
    expect(getProductStatus(product, 1, referenceDate)).toBe("safe");
    expect(getProductStatus(product, 3, referenceDate)).toBe("urgent");
    expect(getProductStatus(product, 7, referenceDate)).toBe("urgent");
  });

  it("keeps a product code with each inventory record", () => {
    const product: Product = {
      id: "product-1",
      name: "นมสด",
      productCode: "MILK-001",
      quantity: 2,
      shelf: "A",
      row: "1",
      itemNumber: 3,
      dateType: "expiry",
      date: "2026-08-30",
      imageUri: "file:///product-images/milk.jpg",
      createdAt: "2026-08-26T00:00:00.000Z",
    };
    expect(product.productCode).toBe("MILK-001");
    expect(product.imageUri).toBe("file:///product-images/milk.jpg");
    expect(findProductByCode([product], "MILK-001")).toEqual(product);
    expect(findProductByCode([product], " UNKNOWN ")).toBeUndefined();
    expect(findDuplicateBarcode([product], "MILK-001")).toEqual({ product, barcode: "MILK-001" });
    expect(findDuplicateBarcode([product], "MILK-001", { shelf: product.shelf, row: product.row }, product.id)).toBeUndefined();
    expect(matchesProductSearch(product, "นม")).toBe(true);
    expect(matchesProductSearch(product, "milk-001")).toBe(true);
    expect(matchesProductSearch(product, "4901234567890")).toBe(false);
    expect(matchesProductSearch(product, "unknown")).toBe(false);
    expect(formatProductPosition(product)).toBe("ชั้นวางที่ A · แถวที่ 1 · สินค้าตัวที่ 3");
  });

  it("normalizes categories and supports category-based product search", () => {
    const beverage: Product = { id: "beverage", name: "นมสด", category: "  เครื่องดื่ม   แช่เย็น ", productCode: "MILK-001", quantity: 1, shelf: "A", row: "1", dateType: "expiry", date: "2026-09-20", createdAt: "2026-08-26T00:00:00.000Z" };
    const uncategorized: Product = { ...beverage, id: "uncategorized", name: "ถุงมือ", category: undefined };
    expect(normalizeProductCategory(beverage.category)).toBe("เครื่องดื่ม แช่เย็น");
    expect(getProductCategories([beverage, { ...beverage, id: "duplicate", category: "เครื่องดื่ม แช่เย็น" }])).toEqual(["เครื่องดื่ม แช่เย็น"]);
    expect(getProductCategoryLabel(uncategorized)).toBe("ยังไม่จัดหมวดหมู่");
    expect(matchesProductSearch(beverage, "แช่เย็น")).toBe(true);
  });

  it("detects a product already assigned to the same shelf, row, and item position", () => {
    const product: Product = { id: "occupied", name: "นมสด", productCode: "MILK-001", quantity: 1, shelf: "A", row: "1", itemNumber: 2, dateType: "expiry", date: "2026-09-10", createdAt: "2026-08-26T00:00:00.000Z" };
    expect(findProductAtPosition([product], { shelf: " A ", row: "1", itemNumber: 2 })).toEqual(product);
    expect(findProductAtPosition([product], { shelf: "A", row: "1", itemNumber: 2 }, "occupied")).toBeUndefined();
    expect(findProductAtPosition([product], { shelf: "A", row: "1", itemNumber: 3 })).toBeUndefined();
  });

  it("suggests the next available item number for the selected shelf row", () => {
    const makeProduct = (id: string, shelf: string, row: string, itemNumber: number): Product => ({ id, name: id, productCode: id, quantity: 1, shelf, row, itemNumber, dateType: "expiry", date: "2026-09-20", createdAt: "2026-08-26T00:00:00.000Z" });
    const products = [makeProduct("one", "A", "1", 1), makeProduct("three", "A", "1", 3), makeProduct("other-row", "A", "2", 9)];
    expect(getNextAvailableItemNumber(products, "A", "1")).toBe(4);
    expect(getNextAvailableItemNumber(products, " A ", "1", "three")).toBe(2);
    expect(getNextAvailableItemNumber(products, "B", "1")).toBe(1);
  });

  it("continues with the next item number after saving in the same row", () => {
    const makeProduct = (id: string, itemNumber: number): Product => ({ id, name: id, productCode: id, quantity: 1, shelf: "A", row: "1", itemNumber, dateType: "expiry", date: "2026-09-20", createdAt: "2026-08-26T00:00:00.000Z" });
    const products = [makeProduct("first", 1), makeProduct("third", 3)];
    expect(getNextItemNumberAfterSave(products, "A", "1", 4)).toBe(5);
    expect(getNextItemNumberAfterSave(products, "A", "1", 2)).toBe(4);
    expect(getNextItemNumberAfterSave(products, "B", "1", 1)).toBe(2);
    expect(getNextItemNumberAfterSave(products, "A", "1", 2, true)).toBe(5);
  });

  it("restores a deleted product at its original position or the next available one", () => {
    const deleted: Product = { id: "deleted", name: "นมสด", productCode: "MILK-001", quantity: 1, shelf: "A", row: "1", itemNumber: 2, dateType: "expiry", date: "2026-09-20", createdAt: "2026-08-26T00:00:00.000Z" };
    const occupyingProduct: Product = { ...deleted, id: "occupying", name: "สินค้าใหม่" };
    expect(restoreDeletedProduct([], deleted).itemNumber).toBe(2);
    expect(restoreDeletedProduct([occupyingProduct], deleted).itemNumber).toBe(3);
  });

  it("builds a storage map with occupied and vacant positions for each shelf row", () => {
    const makeProduct = (id: string, itemNumber: number): Product => ({ id, name: id, productCode: id, quantity: 1, shelf: "A", row: "1", itemNumber, dateType: "expiry", date: "2026-09-20", createdAt: "2026-08-26T00:00:00.000Z" });
    const map = buildStorageMap([makeProduct("first", 1), makeProduct("third", 3)]);
    expect(map[0].rows[0].slots.map((slot) => slot.product?.id ?? "vacant")).toEqual(["first", "vacant", "third", "vacant"]);
  });

  it("prioritizes expired and urgent products within each shelf row", () => {
    const makeProduct = (id: string, date: string, shelf = "A", row = "1"): Product => ({
      id,
      name: id,
      productCode: id,
      quantity: 1,
      shelf,
      row,
      dateType: "expiry",
      date,
      createdAt: "2026-08-26T00:00:00.000Z",
    });
    const products = [makeProduct("safe", "2026-09-20"), makeProduct("urgent", "2026-08-28"), makeProduct("expired", "2026-08-25"), makeProduct("other-shelf", "2026-08-25", "B")];
    expect(sortProductsForShelves(products, 7, referenceDate).map((product) => product.id)).toEqual(["expired", "urgent", "safe", "other-shelf"]);
  });

  it("summarizes product counts and urgent statuses by row", () => {
    const makeProduct = (id: string, row: string, date: string): Product => ({ id, name: id, productCode: id, quantity: 1, shelf: "A", row, dateType: "expiry", date, createdAt: "2026-08-26T00:00:00.000Z" });
    expect(summarizeRows([makeProduct("expired", "1", "2026-08-25"), makeProduct("urgent", "1", "2026-08-29"), makeProduct("row-10", "10", "2026-09-20"), makeProduct("safe", "2", "2026-09-20")], 7, referenceDate)).toEqual([
      { row: "1", productCount: 2, expiredCount: 1, urgentCount: 1 },
      { row: "2", productCount: 1, expiredCount: 0, urgentCount: 0 },
      { row: "10", productCount: 1, expiredCount: 0, urgentCount: 0 },
    ]);
    expect(comparePositionLabels("2", "10")).toBeLessThan(0);
  });

  it("swaps neighboring item positions only within the same shelf row", () => {
    const makeProduct = (id: string, itemNumber: number, row = "1"): Product => ({ id, name: id, productCode: id, quantity: 1, shelf: "A", row, itemNumber, dateType: "expiry", date: "2026-09-20", createdAt: "2026-08-26T00:00:00.000Z" });
    const products = [makeProduct("first", 1), makeProduct("second", 2), makeProduct("third", 3), makeProduct("other-row", 1, "2")];
    expect(moveProductWithinRow(products, "second", "up").map((product) => [product.id, product.itemNumber])).toEqual([
      ["first", 2], ["second", 1], ["third", 3], ["other-row", 1],
    ]);
    expect(moveProductWithinRow(products, "second", "down").map((product) => [product.id, product.itemNumber])).toEqual([
      ["first", 1], ["second", 3], ["third", 2], ["other-row", 1],
    ]);
  });

  it("relocates a product and reindexes the destination row", () => {
    const makeProduct = (id: string, shelf: string, row: string, itemNumber: number): Product => ({ id, name: id, productCode: id, quantity: 1, shelf, row, itemNumber, dateType: "expiry", date: "2026-09-20", createdAt: "2026-08-26T00:00:00.000Z" });
    const products = [makeProduct("move-me", "A", "1", 1), makeProduct("destination-first", "B", "2", 1), makeProduct("destination-second", "B", "2", 2)];
    expect(relocateProduct(products, "move-me", { shelf: "B", row: "2", itemNumber: 2 }).map((product) => [product.id, product.shelf, product.row, product.itemNumber])).toEqual([
      ["destination-first", "B", "2", 1], ["move-me", "B", "2", 2], ["destination-second", "B", "2", 3],
    ]);
  });

  it("inserts a product in a row and shifts following item positions", () => {
    const makeProduct = (id: string, itemNumber: number, row = "1"): Product => ({ id, name: id, productCode: id, quantity: 1, shelf: "A", row, itemNumber, dateType: "expiry", date: "2026-09-20", createdAt: "2026-08-26T00:00:00.000Z" });
    const products = [makeProduct("first", 1), makeProduct("third", 2), makeProduct("other-row", 1, "2")];
    const inserted = insertProductIntoRow(products, makeProduct("second", 2));
    expect(inserted.map((product) => [product.id, product.itemNumber])).toEqual([["other-row", 1], ["first", 1], ["second", 2], ["third", 3]]);
    expect(insertProductIntoRow(products, makeProduct("invalid", 0))).toEqual(products);
  });
});
