export type ProductStatus = "expired" | "urgent" | "safe";
export type ProductDateType = "manufactured" | "expiry";
export type ProductGrade = "A" | "B" | "C";

export function normalizeProductGrade(value?: string): ProductGrade | undefined {
  return value === "A" || value === "B" || value === "C" ? value : undefined;
}

export function getProductGradeLabel(grade?: ProductGrade): string {
  return grade ? `เกรด ${grade}` : "ยังไม่จัดเกรด";
}

export function getProductGradeTheme(grade?: ProductGrade): { backgroundColor: string; textColor: string } {
  if (grade === "A") return { backgroundColor: "#DCFCE7", textColor: "#166534" };
  if (grade === "B") return { backgroundColor: "#FEF3C7", textColor: "#92400E" };
  return grade === "C" ? { backgroundColor: "#FEE2E2", textColor: "#991B1B" } : { backgroundColor: "#F2F4F7", textColor: "#667085" };
}

export interface ProductLot {
  id: string;
  batchNumber: string;
  quantity: number;
  dateType: ProductDateType;
  date: string;
  shelfLifeDays?: number;
  createdAt: string;
}

export type ProductLotInput = Omit<ProductLot, "id" | "createdAt">;

export interface Product {
  id: string;
  name: string;
  category?: string;
  grade?: ProductGrade;
  productCode: string;
  batchNumber?: string;
  quantity: number;
  shelf: string;
  row: string;
  itemNumber?: number;
  dateType: ProductDateType;
  date: string;
  shelfLifeDays?: number;
  lots?: ProductLot[];
  imageUri?: string;
  imageUris?: string[];
  createdAt: string;
}

export interface DeletedProduct extends Product {
  deletedAt: string;
}

export function normalizeProductCategory(value?: string): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export function getProductCategoryLabel(product: Pick<Product, "category">): string {
  return normalizeProductCategory(product.category) || "ยังไม่จัดหมวดหมู่";
}

export function getProductCategories(products: Product[]): string[] {
  return [...new Set(products.map((product) => normalizeProductCategory(product.category)).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second, "th"));
}

/** เปรียบเทียบชื่อชั้น/แถวโดยให้ค่าตัวเลขเรียงตามลำดับจริง เช่น 2 ก่อน 10 */
export function comparePositionLabels(first: string, second: string): number {
  return first.trim().localeCompare(second.trim(), "th", { numeric: true, sensitivity: "base" });
}

export interface InventorySettings {
  nearExpiryDays: number;
  lowStockThreshold: number;
  notificationsEnabled: boolean;
  nameFieldHighlightEnabled: boolean;
  colorScheme: "light" | "dark";
  brandColor: string;
  backgroundImageUri?: string;
  backgroundImageOpacity: number;
  categoryCatalog?: string[];
  latestCategory?: string;
}

export const DEFAULT_SETTINGS: InventorySettings = {
  nearExpiryDays: 7,
  lowStockThreshold: 3,
  notificationsEnabled: true,
  nameFieldHighlightEnabled: true,
  colorScheme: "light",
  brandColor: "#1D4ED8",
  backgroundImageOpacity: 0.18,
  categoryCatalog: [],
  latestCategory: "",
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function getDaysRemaining(expiryDate: string, now = new Date()): number {
  const expiry = parseLocalDate(expiryDate);
  if (!expiry) return 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((expiry.getTime() - today.getTime()) / DAY_MS);
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function calculateExpiryDate(manufacturedDate: string, shelfLifeDays?: number): string | null {
  const startDate = parseLocalDate(manufacturedDate);
  if (!startDate || !Number.isInteger(shelfLifeDays) || !shelfLifeDays || shelfLifeDays < 1) return null;
  const expiryDate = new Date(startDate);
  expiryDate.setDate(expiryDate.getDate() + shelfLifeDays);
  return toDateInput(expiryDate);
}

export function getExpiryDateForLot(lot: Pick<ProductLot, "date" | "dateType" | "shelfLifeDays">): string | null {
  if (lot.dateType === "expiry") return parseLocalDate(lot.date) ? lot.date : null;
  return calculateExpiryDate(lot.date, lot.shelfLifeDays);
}

type ProductLotSource = Pick<Product, "date" | "dateType" | "shelfLifeDays"> & Partial<Pick<Product, "id" | "batchNumber" | "quantity" | "lots">>;

export function getProductLots(product: ProductLotSource): ProductLot[] {
  if (Array.isArray(product.lots) && product.lots.length > 0) return product.lots;
  return [{ id: `legacy-${product.id ?? "product"}`, batchNumber: product.batchNumber ?? "1", quantity: product.quantity ?? 0, dateType: product.dateType, date: product.date, shelfLifeDays: product.shelfLifeDays, createdAt: "" }];
}

export function getExpiryDateForProduct(product: ProductLotSource): string | null {
  const expiryDates = getProductLots(product).map(getExpiryDateForLot).filter((date): date is string => Boolean(date));
  return expiryDates.sort((first, second) => first.localeCompare(second))[0] ?? null;
}

export function getDaysRemainingForProduct(
  product: ProductLotSource,
  now = new Date(),
): number | null {
  const expiryDate = getExpiryDateForProduct(product);
  return expiryDate ? getDaysRemaining(expiryDate, now) : null;
}

export function getProductStatus(
  product: ProductLotSource,
  nearExpiryDays: number,
  now = new Date(),
): ProductStatus {
  const remaining = getDaysRemainingForProduct(product, now);
  if (remaining === null) return "safe";
  if (remaining < 0) return "expired";
  if (remaining <= nearExpiryDays) return "urgent";
  return "safe";
}

export type LotAlertType = "expired" | "near-expiry" | "low-stock";

export interface LotAlert {
  product: Product;
  lot: ProductLot;
  type: LotAlertType;
  expiryDate: string | null;
  daysRemaining: number | null;
}

export function getLotAlerts(products: Product[], settings: InventorySettings, now = new Date()): LotAlert[] {
  const alerts: LotAlert[] = [];
  products.forEach((product) => {
    getProductLots(product).filter((lot) => lot.quantity > 0).forEach((lot) => {
      const expiryDate = getExpiryDateForLot(lot);
      const daysRemaining = expiryDate ? getDaysRemaining(expiryDate, now) : null;
      if (daysRemaining !== null && daysRemaining < 0) alerts.push({ product, lot, type: "expired", expiryDate, daysRemaining });
      else if (daysRemaining !== null && daysRemaining <= settings.nearExpiryDays) alerts.push({ product, lot, type: "near-expiry", expiryDate, daysRemaining });
      if (lot.quantity <= settings.lowStockThreshold) alerts.push({ product, lot, type: "low-stock", expiryDate, daysRemaining });
    });
  });
  const priority: Record<LotAlertType, number> = { expired: 0, "near-expiry": 1, "low-stock": 2 };
  return alerts.sort((first, second) => priority[first.type] - priority[second.type] || (first.expiryDate ?? "9999-12-31").localeCompare(second.expiryDate ?? "9999-12-31") || first.lot.quantity - second.lot.quantity);
}

export function getExpiryDateForLegacyProduct(product: Pick<Product, "date" | "dateType" | "shelfLifeDays">): string | null {
  if (product.dateType === "expiry") return parseLocalDate(product.date) ? product.date : null;
  return calculateExpiryDate(product.date, product.shelfLifeDays);
}

export function getProductImageUris(product: Pick<Product, "imageUri" | "imageUris">): string[] {
  if (Array.isArray(product.imageUris)) return product.imageUris.filter((uri) => typeof uri === "string" && uri.trim().length > 0);
  return product.imageUri?.trim() ? [product.imageUri] : [];
}

export interface ProductStatusSummary {
  safe: number;
  urgent: number;
  expired: number;
}

export interface BatchBadgeTheme {
  backgroundColor: string;
  textColor: string;
}

const BATCH_BADGE_THEMES: BatchBadgeTheme[] = [
  { backgroundColor: "#E8F1FC", textColor: "#1D4ED8" },
  { backgroundColor: "#E8F1FC", textColor: "#175CD3" },
  { backgroundColor: "#FEF0C7", textColor: "#B54708" },
  { backgroundColor: "#FCE7F3", textColor: "#C11574" },
  { backgroundColor: "#F3E8FF", textColor: "#7A2EAD" },
];

export function getBatchBadgeTheme(batchNumber?: string): BatchBadgeTheme {
  const value = batchNumber?.trim() ?? "";
  if (!value) return BATCH_BADGE_THEMES[0];
  const numericLot = Number(value);
  const index = Number.isInteger(numericLot) && numericLot > 0
    ? numericLot - 1
    : Array.from(value).reduce((total, character) => total + character.charCodeAt(0), 0);
  return BATCH_BADGE_THEMES[index % BATCH_BADGE_THEMES.length];
}

export function summarizeProductStatuses(products: Product[], nearExpiryDays: number, now = new Date()): ProductStatusSummary {
  return products.reduce<ProductStatusSummary>((summary, product) => {
    summary[getProductStatus(product, nearExpiryDays, now)] += 1;
    return summary;
  }, { safe: 0, urgent: 0, expired: 0 });
}

export function getStatusLabel(status: ProductStatus, daysRemaining: number | null, hasExpiryDate: boolean): string {
  if (!hasExpiryDate || daysRemaining === null) return "บันทึกวันผลิต";
  if (status === "expired") return `หมดอายุ ${Math.abs(daysRemaining)} วันแล้ว`;
  if (daysRemaining === 0) return "หมดอายุวันนี้";
  if (status === "urgent") return `เหลือ ${daysRemaining} วัน`;
  return `เหลือ ${daysRemaining} วัน`;
}

export function formatThaiDate(value: string): string {
  const date = parseLocalDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export type DateInputParts = { day: string; month: string; year: string };

export function getDatePartsForInput(value: string): DateInputParts {
  const date = parseLocalDate(value);
  if (!date) return { day: "", month: "", year: "" };
  return {
    day: String(date.getDate()),
    month: String(date.getMonth() + 1),
    year: String(date.getFullYear() + 543),
  };
}

export function createISODateFromParts({ day, month, year }: DateInputParts): string | null {
  const numericDay = Number(day);
  const numericMonth = Number(month);
  const enteredYear = Number(year);
  if (!Number.isInteger(numericDay) || !Number.isInteger(numericMonth) || !Number.isInteger(enteredYear)) return null;
  const numericYear = enteredYear >= 2400 ? enteredYear - 543 : enteredYear;
  const isoDate = `${String(numericYear).padStart(4, "0")}-${String(numericMonth).padStart(2, "0")}-${String(numericDay).padStart(2, "0")}`;
  return parseLocalDate(isoDate) ? isoDate : null;
}

export function formatDateParts(parts: DateInputParts): string {
  return `${parts.day}/${parts.month}/${parts.year}`;
}

export function getDateTypeLabel(dateType: ProductDateType): string {
  return dateType === "manufactured" ? "วันผลิต" : "วันหมดอายุ";
}

export function sortByExpiry(products: Product[]): Product[] {
  return [...products].sort((a, b) => (getExpiryDateForProduct(a) ?? "9999-12-31").localeCompare(getExpiryDateForProduct(b) ?? "9999-12-31"));
}

export function sortProductsForShelves(products: Product[], nearExpiryDays: number, now = new Date()): Product[] {
  const getStatusRank = (product: Product) => {
    const status = getProductStatus(product, nearExpiryDays, now);
    if (status === "expired") return 0;
    if (status === "urgent") return 1;
    return 2;
  };

  return [...products].sort((a, b) => {
    const shelfCompare = comparePositionLabels(a.shelf, b.shelf);
    if (shelfCompare !== 0) return shelfCompare;
    const rowCompare = comparePositionLabels(a.row, b.row);
    if (rowCompare !== 0) return rowCompare;
    const priorityCompare = getStatusRank(a) - getStatusRank(b);
    if (priorityCompare !== 0) return priorityCompare;
    const itemNumberCompare = (a.itemNumber ?? Number.MAX_SAFE_INTEGER) - (b.itemNumber ?? Number.MAX_SAFE_INTEGER);
    if (itemNumberCompare !== 0) return itemNumberCompare;
    const dateCompare = (getExpiryDateForProduct(a) ?? "9999-12-31").localeCompare(getExpiryDateForProduct(b) ?? "9999-12-31");
    if (dateCompare !== 0) return dateCompare;
    return a.name.localeCompare(b.name, "th");
  });
}

export function formatProductPosition(product: Pick<Product, "shelf" | "row" | "itemNumber">): string {
  const itemText = product.itemNumber ? ` · สินค้าตัวที่ ${product.itemNumber}` : "";
  return `ชั้นวางที่ ${product.shelf} · แถวที่ ${product.row}${itemText}`;
}

export function findProductAtPosition(
  products: Product[],
  position: Pick<Product, "shelf" | "row" | "itemNumber">,
  excludedProductId?: string,
): Product | undefined {
  const shelf = position.shelf.trim();
  const row = position.row.trim();
  return products.find((product) => product.id !== excludedProductId
    && product.shelf.trim() === shelf
    && product.row.trim() === row
    && product.itemNumber === position.itemNumber);
}

export function getNextAvailableItemNumber(products: Product[], shelfValue: string, rowValue: string, excludedProductId?: string): number {
  const shelf = shelfValue.trim();
  const row = rowValue.trim();
  const occupied = products
    .filter((product) => product.id !== excludedProductId && product.shelf.trim() === shelf && product.row.trim() === row)
    .map((product) => product.itemNumber ?? 0);
  return Math.max(0, ...occupied) + 1;
}

export function getNextItemNumberAfterSave(
  products: Product[],
  shelfValue: string,
  rowValue: string,
  savedItemNumber: number,
  inserting = false,
): number {
  const highestExisting = getNextAvailableItemNumber(products, shelfValue, rowValue) - 1;
  if (inserting) return highestExisting + 2;
  return Math.max(highestExisting, savedItemNumber) + 1;
}

export function getNextBatchNumber(products: Product[], productName: string, productCode: string, excludedProductId?: string): number | null {
  const name = productName.trim().toLocaleLowerCase();
  const code = productCode.trim().toLocaleLowerCase();
  if (!name && !code) return null;
  const batchNumbers = products
    .filter((product) => product.id !== excludedProductId && (code ? product.productCode.trim().toLocaleLowerCase() === code : product.name.trim().toLocaleLowerCase() === name))
    .flatMap((product) => getProductLots(product).map((lot) => Number(lot.batchNumber)))
    .filter((batchNumber) => Number.isInteger(batchNumber) && batchNumber > 0);
  return Math.max(0, ...batchNumbers) + 1;
}

export type ProductInput = Omit<Product, "id" | "createdAt">;

export function insertProductIntoRow(products: Product[], product: Product): Product[] {
  const shelf = product.shelf.trim();
  const row = product.row.trim();
  const requestedPosition = product.itemNumber;
  if (!shelf || !row || !requestedPosition || requestedPosition < 1) return products;

  const rowProducts = products
    .filter((item) => item.shelf.trim() === shelf && item.row.trim() === row)
    .sort((first, second) => (first.itemNumber ?? Number.MAX_SAFE_INTEGER) - (second.itemNumber ?? Number.MAX_SAFE_INTEGER) || first.name.localeCompare(second.name, "th"));
  const insertionIndex = Math.min(Math.max(requestedPosition - 1, 0), rowProducts.length);
  const reorderedRow = [...rowProducts];
  reorderedRow.splice(insertionIndex, 0, { ...product, shelf, row });
  const itemNumbers = new Map(reorderedRow.map((item, index) => [item.id, index + 1]));
  const unaffectedProducts = products.filter((item) => item.shelf.trim() !== shelf || item.row.trim() !== row);
  return unaffectedProducts.concat(reorderedRow.map((item) => ({ ...item, itemNumber: itemNumbers.get(item.id) })));
}

export function addLotToProduct(product: Product, lotInput: ProductLotInput): Product {
  const existingLots = getProductLots(product);
  const existingBatchNumbers = new Set(existingLots.map((lot) => lot.batchNumber));
  const preferredBatchNumber = lotInput.batchNumber.trim();
  const nextBatchNumber = getNextBatchNumber([product], product.name, product.productCode) ?? 1;
  const batchNumber = !preferredBatchNumber || existingBatchNumbers.has(preferredBatchNumber) ? String(nextBatchNumber) : preferredBatchNumber;
  const newLot: ProductLot = { ...lotInput, id: `lot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, batchNumber, createdAt: new Date().toISOString() };
  const lots = [...existingLots, newLot];
  return { ...product, lots, quantity: lots.reduce((total, lot) => total + lot.quantity, 0) };
}

export function updateProductLotQuantity(product: Product, lotId: string, quantity: number): Product | null {
  if (!Number.isInteger(quantity) || quantity < 0) return null;
  const lots = getProductLots(product);
  if (!lots.some((lot) => lot.id === lotId)) return null;
  const nextLots = lots.map((lot) => lot.id === lotId ? { ...lot, quantity } : lot);
  return { ...product, lots: nextLots, quantity: nextLots.reduce((total, lot) => total + lot.quantity, 0) };
}

export function removeProductLot(product: Product, lotId: string): Product | null | undefined {
  const lots = getProductLots(product);
  const targetLot = lots.find((lot) => lot.id === lotId);
  if (!targetLot) return undefined;
  const nextLots = lots.filter((lot) => lot.id !== lotId);
  if (nextLots.length === 0) return null;
  return { ...product, lots: nextLots, quantity: nextLots.reduce((total, lot) => total + lot.quantity, 0) };
}

export function restoreDeletedProduct(products: Product[], deletedProduct: Product): Product {
  const originalPosition: ProductPosition = { shelf: deletedProduct.shelf, row: deletedProduct.row, itemNumber: deletedProduct.itemNumber };
  const positionIsOccupied = Boolean(findProductAtPosition(products, originalPosition));
  const restoredPosition: ProductPosition = positionIsOccupied
    ? { shelf: deletedProduct.shelf, row: deletedProduct.row, itemNumber: getNextAvailableItemNumber(products, deletedProduct.shelf, deletedProduct.row) }
    : originalPosition;
  return { ...deletedProduct, ...restoredPosition };
}

export type MoveDirection = "up" | "down";

export type ProductPosition = Pick<Product, "shelf" | "row" | "itemNumber">;

export interface PositionHistoryEntry {
  id: string;
  productId: string;
  productName: string;
  from?: ProductPosition;
  to?: ProductPosition;
  changedAt: string;
  action: "insert" | "move" | "reorder" | "delete" | "restore";
  deletedProduct?: Product;
}

export function moveProductWithinRow(products: Product[], productId: string, direction: MoveDirection): Product[] {
  const target = products.find((product) => product.id === productId);
  if (!target) return products;
  const rowProducts = products
    .filter((product) => product.shelf === target.shelf && product.row === target.row)
    .sort((a, b) => (a.itemNumber ?? Number.MAX_SAFE_INTEGER) - (b.itemNumber ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, "th"));
  const currentIndex = rowProducts.findIndex((product) => product.id === productId);
  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= rowProducts.length) return products;
  [rowProducts[currentIndex], rowProducts[nextIndex]] = [rowProducts[nextIndex], rowProducts[currentIndex]];
  const newPositions = new Map(rowProducts.map((product, index) => [product.id, index + 1]));
  return products.map((product) => newPositions.has(product.id) ? { ...product, itemNumber: newPositions.get(product.id) } : product);
}

export function relocateProduct(
  products: Product[],
  productId: string,
  destination: ProductPosition,
): Product[] {
  const target = products.find((product) => product.id === productId);
  if (!target || !destination.shelf.trim() || !destination.row.trim() || !destination.itemNumber || destination.itemNumber < 1) return products;
  const withoutTarget = products.filter((product) => product.id !== productId);
  const destinationItems = withoutTarget
    .filter((product) => product.shelf === destination.shelf && product.row === destination.row)
    .sort((a, b) => (a.itemNumber ?? Number.MAX_SAFE_INTEGER) - (b.itemNumber ?? Number.MAX_SAFE_INTEGER));
  const insertAt = Math.min(Math.max(destination.itemNumber - 1, 0), destinationItems.length);
  const reorderedDestination = [...destinationItems];
  reorderedDestination.splice(insertAt, 0, { ...target, shelf: destination.shelf.trim(), row: destination.row.trim() });
  const newPositions = new Map(reorderedDestination.map((product, index) => [product.id, index + 1]));
  const unaffectedProducts = withoutTarget.filter((product) => product.shelf !== destination.shelf || product.row !== destination.row);
  return unaffectedProducts.concat(reorderedDestination.map((product) => ({ ...product, itemNumber: newPositions.get(product.id) })));
}

export interface RowSummary {
  row: string;
  productCount: number;
  expiredCount: number;
  urgentCount: number;
}

export function summarizeRows(products: Product[], nearExpiryDays: number, now = new Date()): RowSummary[] {
  const summaries = new Map<string, RowSummary>();
  products.forEach((product) => {
    const current = summaries.get(product.row) ?? { row: product.row, productCount: 0, expiredCount: 0, urgentCount: 0 };
    const status = getProductStatus(product, nearExpiryDays, now);
    current.productCount += 1;
    if (status === "expired") current.expiredCount += 1;
    if (status === "urgent") current.urgentCount += 1;
    summaries.set(product.row, current);
  });
  return [...summaries.values()].sort((a, b) => comparePositionLabels(a.row, b.row));
}

export interface StorageMapSlot {
  itemNumber: number;
  product?: Product;
}

export interface StorageMapRow {
  row: string;
  slots: StorageMapSlot[];
}

export interface StorageMapShelf {
  shelf: string;
  rows: StorageMapRow[];
}

export function buildStorageMap(products: Product[]): StorageMapShelf[] {
  const shelves = new Map<string, Map<string, Product[]>>();
  products.forEach((product) => {
    const rows = shelves.get(product.shelf) ?? new Map<string, Product[]>();
    const items = rows.get(product.row) ?? [];
    items.push(product);
    rows.set(product.row, items);
    shelves.set(product.shelf, rows);
  });
  return [...shelves.entries()]
    .map(([shelf, rows]) => ({
      shelf,
      rows: [...rows.entries()]
        .map(([row, items]) => {
          const itemByNumber = new Map(items.map((item) => [item.itemNumber ?? 0, item]));
          const maxItemNumber = Math.max(2, ...items.map((item) => item.itemNumber ?? 0));
          return { row, slots: Array.from({ length: maxItemNumber + 1 }, (_, index) => ({ itemNumber: index + 1, product: itemByNumber.get(index + 1) })) };
        })
        .sort((a, b) => comparePositionLabels(a.row, b.row)),
    }))
    .sort((a, b) => comparePositionLabels(a.shelf, b.shelf));
}

export function findProductByCode(products: Product[], productCode: string): Product | undefined {
  const normalizedCode = productCode.trim();
  if (!normalizedCode) return undefined;
  return products.find((product) => product.productCode.trim() === normalizedCode);
}

export function findDuplicateBarcode(products: Product[], productCode: string, location?: { shelf: string; row: string }, excludedProductId?: string): { product: Product; barcode: string } | undefined {
  const normalizedCode = productCode.trim();
  if (!normalizedCode) return undefined;
  const targetShelf = location?.shelf.trim();
  const targetRow = location?.row.trim();
  for (const product of products) {
    if (product.id === excludedProductId) continue;
    if (targetShelf && targetRow && (product.shelf.trim() !== targetShelf || product.row.trim() !== targetRow)) continue;
    const barcode = product.productCode.trim() === normalizedCode ? product.productCode.trim() : "";
    if (barcode) return { product, barcode };
  }
  return undefined;
}

export function matchesProductSearch(product: Product, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return product.name.toLocaleLowerCase().includes(normalizedQuery)
    || normalizeProductCategory(product.category).toLocaleLowerCase().includes(normalizedQuery)
    || product.productCode.toLocaleLowerCase().includes(normalizedQuery)
    || getProductLots(product).some((lot) => lot.batchNumber.toLocaleLowerCase().includes(normalizedQuery));
}

export function createProductId(): string {
  return `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
