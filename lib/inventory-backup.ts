import { DEFAULT_SETTINGS, getProductLots, normalizeProductCategory, normalizeProductGrade, parseLocalDate, type InventorySettings, type PositionHistoryEntry, type Product, type ProductDateType, type ProductLot, type ProductPosition } from "./inventory";
import { type UserProfile } from "./user-profile";
import { type DeletedProduct } from "./inventory";

export const INVENTORY_BACKUP_FILE_TYPE = "shelfwatch-backup";
export const INVENTORY_BACKUP_SCHEMA_VERSION = 1;

export interface InventoryBackupImage {
  sourceUri: string;
  base64: string;
  extension: string;
}

/**
 * An image stored as its own file inside a .zip backup (instead of base64 inside the JSON).
 * `localUri` only exists in memory: the original file while exporting, or the extracted
 * file while restoring. It is never written into backup.json.
 */
export interface InventoryBackupImageFile {
  sourceUri: string;
  path: string;
  extension: string;
  size: number;
  localUri?: string;
}

export interface InventoryBackupProfile extends UserProfile {
  products: Product[];
  deletedProducts?: DeletedProduct[];
  settings: InventorySettings;
  positionHistory: PositionHistoryEntry[];
}

export interface InventoryBackup {
  type: typeof INVENTORY_BACKUP_FILE_TYPE;
  schemaVersion: typeof INVENTORY_BACKUP_SCHEMA_VERSION;
  createdAt: string;
  activeUserId: string;
  profiles: InventoryBackupProfile[];
  images: InventoryBackupImage[];
  imageFiles?: InventoryBackupImageFile[];
  skippedImageCount?: number;
}

export interface InventoryBackupInput {
  activeUserId: string;
  profiles: InventoryBackupProfile[];
  images?: InventoryBackupImage[];
  imageFiles?: InventoryBackupImageFile[];
  skippedImageCount?: number;
  createdAt?: string;
}

export interface InventoryBackupSummary {
  createdAt: string;
  profileCount: number;
  productCount: number;
  historyCount: number;
  imageCount: number;
}

export interface InventoryBackupProfileSummary {
  id: string;
  displayName: string;
  storageName: string;
  productCount: number;
  lotCount: number;
  historyCount: number;
  isActiveProfile: boolean;
}

export interface InventoryBackupRestorePreview extends InventoryBackupSummary {
  lotCount: number;
  activeProfileName: string;
  profiles: InventoryBackupProfileSummary[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`ไฟล์สำรองมี${label}ไม่ถูกต้อง`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredISODate(value: unknown, label: string): string {
  const date = requiredString(value, label);
  if (!parseLocalDate(date)) throw new Error(`ไฟล์สำรองมี${label}ไม่ถูกต้อง`);
  return date;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`ไฟล์สำรองมี${label}ไม่ถูกต้อง`);
  return value as number;
}

function positiveInteger(value: unknown, label: string): number {
  const number = nonNegativeInteger(value, label);
  if (number < 1) throw new Error(`ไฟล์สำรองมี${label}ไม่ถูกต้อง`);
  return number;
}

function normalizeDateType(value: unknown, label: string): ProductDateType {
  if (value === "manufactured" || value === "expiry") return value;
  throw new Error(`ไฟล์สำรองมี${label}ไม่ถูกต้อง`);
}

function normalizeOptionalShelfLifeDays(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return positiveInteger(value, "อายุสินค้า");
}

function normalizeImageUris(value: unknown, legacyImageUri: unknown): string[] {
  if (Array.isArray(value)) return value.filter((uri): uri is string => typeof uri === "string" && Boolean(uri.trim())).map((uri) => uri.trim());
  return typeof legacyImageUri === "string" && legacyImageUri.trim() ? [legacyImageUri.trim()] : [];
}

function normalizeLot(value: unknown, productId: string, index: number): ProductLot {
  if (!isRecord(value)) throw new Error("ไฟล์สำรองมีล็อตสินค้าไม่ถูกต้อง");
  return {
    id: requiredString(value.id, "รหสล็อตสินค้า"),
    batchNumber: requiredString(value.batchNumber, "หมายเลขล็อตสินค้า"),
    quantity: nonNegativeInteger(value.quantity, "จำนวนสินค้าในล็อต"),
    dateType: normalizeDateType(value.dateType, "ประเภทวันที่ของล็อต"),
    date: requiredISODate(value.date, "วันที่ของล็อต"),
    shelfLifeDays: normalizeOptionalShelfLifeDays(value.shelfLifeDays),
    createdAt: optionalString(value.createdAt) ?? `${productId}-lot-${index}`,
  };
}

function normalizeProduct(value: unknown): Product {
  if (!isRecord(value)) throw new Error("ไฟล์สำรองมีข้อมูลสินค้าไม่ถูกต้อง");
  const id = requiredString(value.id, "รหัสสินค้า");
  const imageUris = normalizeImageUris(value.imageUris, value.imageUri);
  const lots = Array.isArray(value.lots) ? value.lots.map((lot, index) => normalizeLot(lot, id, index)) : undefined;
  const quantity = lots ? lots.reduce((total, lot) => total + lot.quantity, 0) : nonNegativeInteger(value.quantity, "จำนวนสินค้า");
  const itemNumber = value.itemNumber === undefined || value.itemNumber === null ? undefined : positiveInteger(value.itemNumber, "ลำดับสินค้า");

  return {
    id,
    name: requiredString(value.name, "ชื่อสินค้า"),
    category: normalizeProductCategory(optionalString(value.category)) || undefined,
    grade: normalizeProductGrade(optionalString(value.grade)),
    productCode: typeof value.productCode === "string" ? value.productCode.trim() : "",
    batchNumber: optionalString(value.batchNumber),
    quantity,
    shelf: requiredString(value.shelf, "ชั้นวางสินค้า"),
    row: requiredString(value.row, "แถวสินค้า"),
    itemNumber,
    dateType: normalizeDateType(value.dateType ?? "expiry", "ประเภทวันที่สินค้า"),
    date: requiredISODate(value.date ?? value.expiryDate, "วันที่สินค้า"),
    shelfLifeDays: normalizeOptionalShelfLifeDays(value.shelfLifeDays),
    lots,
    imageUri: imageUris[0],
    imageUris,
    createdAt: requiredString(value.createdAt, "วันเวลาที่สร้างสินค้า"),
  };
}

function normalizePosition(value: unknown, label: string): ProductPosition {
  if (!isRecord(value)) throw new Error(`ไฟล์สำรองมี${label}ไม่ถูกต้อง`);
  return {
    shelf: requiredString(value.shelf, `ชั้นวางของ${label}`),
    row: requiredString(value.row, `แถวของ${label}`),
    itemNumber: value.itemNumber === undefined || value.itemNumber === null ? undefined : positiveInteger(value.itemNumber, `ลำดับของ${label}`),
  };
}

function normalizeHistoryEntry(value: unknown): PositionHistoryEntry {
  if (!isRecord(value)) throw new Error("ไฟล์สำรองมีประวัติการจัดตำแหน่งไม่ถูกต้อง");
  const action = value.action;
  if (action !== "insert" && action !== "move" && action !== "reorder" && action !== "delete" && action !== "restore") {
    throw new Error("ไฟล์สำรองมีประเภทประวัติไม่ถูกต้อง");
  }
  const hasFromPosition = value.from !== undefined && value.from !== null;
  if (action !== "insert" && !hasFromPosition) throw new Error("ไฟล์สำรองไม่มีตำแหน่งเดิมในประวัติ");
  return {
    id: requiredString(value.id, "รหัสประวัติ"),
    productId: requiredString(value.productId, "รหัสสินค้าในประวัติ"),
    productName: requiredString(value.productName, "ชื่อสินค้าในประวัติ"),
    from: hasFromPosition ? normalizePosition(value.from, "ตำแหน่งเดิม") : undefined,
    to: value.to === undefined || value.to === null ? undefined : normalizePosition(value.to, "ตำแหน่งใหม่"),
    changedAt: requiredString(value.changedAt, "เวลาในประวัติ"),
    action,
    deletedProduct: value.deletedProduct === undefined || value.deletedProduct === null ? undefined : normalizeProduct(value.deletedProduct),
  };
}

function normalizeSettings(value: unknown): InventorySettings {
  if (!isRecord(value)) throw new Error("ไฟล์สำรองมีการตั้งค่าไม่ถูกต้อง");
  const nearExpiryDays = positiveInteger(value.nearExpiryDays ?? DEFAULT_SETTINGS.nearExpiryDays, "เกณฑ์ใกล้หมดอายุ");
  const lowStockThreshold = positiveInteger(value.lowStockThreshold ?? DEFAULT_SETTINGS.lowStockThreshold, "เกณฑ์จำนวนใกล้หมด");
  if (nearExpiryDays > 90 || lowStockThreshold > 999) throw new Error("ไฟล์สำรองมีค่าเกณฑ์การแจ้งเตือนไม่ถูกต้อง");
  if (typeof value.notificationsEnabled !== "boolean" || (value.colorScheme !== "light" && value.colorScheme !== "dark")) {
    throw new Error("ไฟล์สำรองมีการตั้งค่าการแสดงผลไม่ถูกต้อง");
  }
  const brandColor = requiredString(value.brandColor, "สีแบรนด์");
  if (!/^#[0-9a-fA-F]{6}$/.test(brandColor)) throw new Error("ไฟล์สำรองมีสีแบรนด์ไม่ถูกต้อง");
  const backgroundImageOpacity = typeof value.backgroundImageOpacity === "number" ? value.backgroundImageOpacity : DEFAULT_SETTINGS.backgroundImageOpacity;
  if (!Number.isFinite(backgroundImageOpacity) || backgroundImageOpacity < 0.05 || backgroundImageOpacity > 0.6) throw new Error("ไฟล์สำรองมีระดับความโปร่งใสพื้นหลังไม่ถูกต้อง");
  const nameFieldHighlightEnabled = typeof value.nameFieldHighlightEnabled === "boolean" ? value.nameFieldHighlightEnabled : DEFAULT_SETTINGS.nameFieldHighlightEnabled;
  const categoryCatalog = Array.isArray(value.categoryCatalog)
    ? [...new Set(value.categoryCatalog.filter((category): category is string => typeof category === "string").map(normalizeProductCategory).filter(Boolean))]
    : DEFAULT_SETTINGS.categoryCatalog;
  return { nearExpiryDays, lowStockThreshold, notificationsEnabled: value.notificationsEnabled, nameFieldHighlightEnabled, colorScheme: value.colorScheme, brandColor, backgroundImageUri: optionalString(value.backgroundImageUri), backgroundImageOpacity, categoryCatalog };
}

function normalizeProfile(value: unknown): InventoryBackupProfile {
  if (!isRecord(value)) throw new Error("ไฟล์สำรองมีผู้ใช้ไม่ถูกต้อง");
  const productsSource = value.products;
  const historySource = value.positionHistory;
  if (!Array.isArray(productsSource) || !Array.isArray(historySource)) throw new Error("ไฟล์สำรองมีรายการข้อมูลผู้ใช้ไม่ถูกต้อง");
  const products = productsSource.map(normalizeProduct);
  if (new Set(products.map((product) => product.id)).size !== products.length) throw new Error("ไฟล์สำรองมีรหัสสินค้าซ้ำกัน");
  const deletedProductsSource = value.deletedProducts;
  const deletedProducts = Array.isArray(deletedProductsSource)
    ? deletedProductsSource.map((product) => ({ ...normalizeProduct(product), deletedAt: requiredString(isRecord(product) ? product.deletedAt : undefined, "เวลาที่ลบสินค้า") }))
    : [];
  return {
    id: requiredString(value.id, "รหัสผู้ใช้"),
    displayName: requiredString(value.displayName, "ชื่อผู้ใช้"),
    storageName: requiredString(value.storageName, "ชื่อคลังสินค้า"),
    avatarUri: optionalString(value.avatarUri),
    products,
    deletedProducts,
    settings: normalizeSettings(value.settings),
    positionHistory: historySource.map(normalizeHistoryEntry),
  };
}

function normalizeImage(value: unknown): InventoryBackupImage {
  if (!isRecord(value)) throw new Error("ไฟล์สำรองมีรูปสินค้าไม่ถูกต้อง");
  const base64 = requiredString(value.base64, "ข้อมูลรูปสินค้า");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("ไฟล์สำรองมีข้อมูลรูปสินค้าไม่ถูกต้อง");
  const extension = requiredString(value.extension, "นามสกุลรูปสินค้า").replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{2,5}$/.test(extension)) throw new Error("ไฟล์สำรองมีนามสกุลรูปสินค้าไม่ถูกต้อง");
  return { sourceUri: requiredString(value.sourceUri, "ที่อยู่รูปสินค้า"), base64, extension };
}

function normalizeImageFile(value: unknown): InventoryBackupImageFile {
  if (!isRecord(value)) throw new Error("ไฟล์สำรองมีข้อมูลไฟล์รูปไม่ถูกต้อง");
  const path = requiredString(value.path, "ตำแหน่งไฟล์รูป");
  if (!/^images\/[A-Za-z0-9._-]+$/.test(path)) throw new Error("ไฟล์สำรองมีตำแหน่งไฟล์รูปไม่ถูกต้อง");
  const extension = requiredString(value.extension, "นามสกุลรูปสินค้า").replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{2,5}$/.test(extension)) throw new Error("ไฟล์สำรองมีนามสกุลรูปสินค้าไม่ถูกต้อง");
  const size = typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0 ? Math.floor(value.size) : 0;
  return { sourceUri: requiredString(value.sourceUri, "ที่อยู่รูปสินค้า"), path, extension, size, localUri: optionalString(value.localUri) };
}

export function normalizeInventoryBackup(value: unknown): InventoryBackup {
  if (!isRecord(value)) throw new Error("ไม่พบข้อมูลไฟล์สำรองของ ShelfWatch");
  if (value.type !== INVENTORY_BACKUP_FILE_TYPE) throw new Error("ไฟล์นี้ไม่ใช่ไฟล์สำรองของ ShelfWatch");
  if (value.schemaVersion !== INVENTORY_BACKUP_SCHEMA_VERSION) throw new Error("ไฟล์สำรองนี้เป็นเวอร์ชันที่ยังไม่รองรับ");
  if (!Array.isArray(value.profiles) || value.profiles.length === 0 || !Array.isArray(value.images)) {
    throw new Error("โครงสร้างไฟล์สำรองไม่สมบูรณ์");
  }
  const profiles = value.profiles.map(normalizeProfile);
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error("ไฟล์สำรองมีรหัสผู้ใช้ซ้ำกัน");
  const activeUserId = requiredString(value.activeUserId, "รหัสผู้ใช้ที่กำลังใช้งาน");
  if (!profiles.some((profile) => profile.id === activeUserId)) throw new Error("ไม่พบผู้ใช้ที่กำลังใช้งานในไฟล์สำรอง");
  const images = value.images.map(normalizeImage);
  if (new Set(images.map((image) => image.sourceUri)).size !== images.length) throw new Error("ไฟล์สำรองมีรูปสินค้าซ้ำกัน");
  const imageFiles = Array.isArray(value.imageFiles) ? value.imageFiles.map(normalizeImageFile) : [];
  return {
    type: INVENTORY_BACKUP_FILE_TYPE,
    schemaVersion: INVENTORY_BACKUP_SCHEMA_VERSION,
    createdAt: requiredString(value.createdAt, "เวลาที่สำรองข้อมูล"),
    activeUserId,
    profiles,
    images,
    imageFiles,
    skippedImageCount: typeof value.skippedImageCount === "number" && value.skippedImageCount > 0 ? Math.floor(value.skippedImageCount) : 0,
  };
}

export function createInventoryBackup(input: InventoryBackupInput): InventoryBackup {
  return normalizeInventoryBackup({
    type: INVENTORY_BACKUP_FILE_TYPE,
    schemaVersion: INVENTORY_BACKUP_SCHEMA_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    activeUserId: input.activeUserId,
    profiles: input.profiles,
    images: input.images ?? [],
    imageFiles: input.imageFiles ?? [],
    skippedImageCount: input.skippedImageCount ?? 0,
  });
}

export function parseInventoryBackup(serialized: string): InventoryBackup {
  try {
    return normalizeInventoryBackup(JSON.parse(serialized) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("ไม่สามารถอ่านไฟล์สำรองได้");
    if (error instanceof Error) throw error;
    throw new Error("ไม่สามารถอ่านไฟล์สำรองได้");
  }
}

export function serializeInventoryBackup(backup: InventoryBackup): string {
  const imageFiles = (backup.imageFiles ?? []).map(({ sourceUri, path, extension, size }) => ({ sourceUri, path, extension, size }));
  return JSON.stringify({ ...backup, imageFiles });
}

export function getInventoryBackupSummary(backup: InventoryBackup): InventoryBackupSummary {
  return {
    createdAt: backup.createdAt,
    profileCount: backup.profiles.length,
    productCount: backup.profiles.reduce((total, profile) => total + profile.products.length, 0),
    historyCount: backup.profiles.reduce((total, profile) => total + profile.positionHistory.length, 0),
    imageCount: backup.images.length + (backup.imageFiles?.length ?? 0),
  };
}

export function getInventoryBackupRestorePreview(backup: InventoryBackup): InventoryBackupRestorePreview {
  const profiles = backup.profiles.map((profile) => ({
    id: profile.id,
    displayName: profile.displayName,
    storageName: profile.storageName,
    productCount: profile.products.length,
    lotCount: profile.products.reduce((total, product) => total + getProductLots(product).length, 0),
    historyCount: profile.positionHistory.length,
    isActiveProfile: profile.id === backup.activeUserId,
  }));
  const activeProfile = profiles.find((profile) => profile.isActiveProfile);
  return {
    ...getInventoryBackupSummary(backup),
    lotCount: profiles.reduce((total, profile) => total + profile.lotCount, 0),
    activeProfileName: activeProfile?.displayName ?? "ไม่ระบุ",
    profiles,
  };
}
