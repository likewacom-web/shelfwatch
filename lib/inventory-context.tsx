import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { clearExpiryNotifications, syncExpiryNotifications } from "@/lib/expiry-notifications";
import {
  createProductId,
  addLotToProduct as addInventoryLot,
  DEFAULT_SETTINGS,
  insertProductIntoRow,
  moveProductWithinRow,
  normalizeProductCategory,
  normalizeProductGrade,
  relocateProduct as relocateInventoryProduct,
  restoreDeletedProduct,
  removeProductLot,
  updateProductLotQuantity,
  type InventorySettings,
  type PositionHistoryEntry,
  type Product,
  type DeletedProduct,
  type ProductLotInput,
  type ProductPosition,
} from "@/lib/inventory";
import { createInventoryBackup, normalizeInventoryBackup, type InventoryBackup, type InventoryBackupProfile } from "@/lib/inventory-backup";
import { collectBackupImages, hydrateBackupImages } from "@/lib/inventory-backup-files";
import { createUserProfile, DEFAULT_USER_PROFILE, getUserDataStorageKey, type UserProfile, type UserProfileInput } from "@/lib/user-profile";

type StoredProduct = Omit<Product, "date" | "dateType"> & {
  date?: string;
  dateType?: Product["dateType"];
  expiryDate?: string;
};

const LEGACY_PRODUCTS_KEY = "shelfwatch.products.v1";
const LEGACY_SETTINGS_KEY = "shelfwatch.settings.v1";
const LEGACY_POSITION_HISTORY_KEY = "shelfwatch.position-history.v1";
const LEGACY_USER_PROFILE_KEY = "shelfwatch.user-profile.v1";
const USER_PROFILES_KEY = "shelfwatch.user-profiles.v2";
const ACTIVE_USER_KEY = "shelfwatch.active-user.v2";
const PRE_RESTORE_ROLLBACK_KEY = "shelfwatch.pre-restore-rollback.v1";
const DELETED_PRODUCTS_SUFFIX = "deleted-products";

type ProductInput = Omit<Product, "id" | "createdAt">;
export interface BackupProgressUpdate {
  percent: number;
  message: string;
}
type BackupProgressCallback = (update: BackupProgressUpdate) => void;

interface InventoryContextValue {
  products: Product[];
  deletedProducts: DeletedProduct[];
  positionHistory: PositionHistoryEntry[];
  lastDeletedProduct: Product | null;
  profile: UserProfile;
  profiles: UserProfile[];
  activeUserId: string;
  settings: InventorySettings;
  isLoading: boolean;
  addProduct: (input: ProductInput) => Promise<Product>;
  insertProduct: (input: ProductInput) => Promise<Product>;
  addLotToProduct: (id: string, input: ProductLotInput) => Promise<Product | null>;
  updateLotQuantity: (id: string, lotId: string, quantity: number) => Promise<Product | null>;
  deleteLot: (id: string, lotId: string) => Promise<boolean>;
  updateProduct: (id: string, input: ProductInput) => Promise<void>;
  renameCategory: (from: string, to: string) => Promise<boolean>;
  deleteUnusedCategory: (category: string) => Promise<boolean>;
  deleteProduct: (id: string) => Promise<void>;
  undoDelete: () => Promise<void>;
  restoreArchivedProduct: (id: string) => Promise<void>;
  moveProduct: (id: string, direction: "up" | "down") => Promise<void>;
  relocateProduct: (id: string, destination: ProductPosition) => Promise<void>;
  updateProfile: (patch: Partial<UserProfileInput>) => Promise<void>;
  createUser: (input: UserProfileInput) => Promise<UserProfile>;
  switchUser: (userId: string) => Promise<void>;
  updateSettings: (patch: Partial<InventorySettings>) => Promise<void>;
  exportBackupData: (onProgress?: BackupProgressCallback) => Promise<InventoryBackup>;
  restoreBackupData: (backup: InventoryBackup, onProgress?: BackupProgressCallback) => Promise<void>;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

function normalizeProducts(storedProducts: string | null): Product[] {
  if (!storedProducts) return [];
  const parsedProducts = JSON.parse(storedProducts) as StoredProduct[];
  return parsedProducts.map((product) => ({
    ...product,
    category: normalizeProductCategory(product.category) || undefined,
    grade: normalizeProductGrade(product.grade),
    productCode: product.productCode ?? "",
    dateType: product.dateType ?? "expiry",
    date: product.date ?? product.expiryDate ?? "",
    itemNumber: product.itemNumber ?? undefined,
    imageUris: Array.isArray(product.imageUris) ? product.imageUris.filter((uri) => typeof uri === "string" && uri.trim().length > 0) : product.imageUri ? [product.imageUri] : [],
    lots: Array.isArray(product.lots) ? product.lots.filter((lot) => typeof lot?.batchNumber === "string" && typeof lot?.quantity === "number" && typeof lot?.date === "string" && (lot?.dateType === "manufactured" || lot?.dateType === "expiry")) : undefined,
  }));
}

function normalizeProfile(value: Partial<UserProfile> | undefined, fallbackId: string): UserProfile {
  return {
    id: value?.id ?? fallbackId,
    displayName: value?.displayName?.trim() || DEFAULT_USER_PROFILE.displayName,
    storageName: value?.storageName?.trim() || DEFAULT_USER_PROFILE.storageName,
    avatarUri: value?.avatarUri?.trim() || undefined,
  };
}

function parseStoredSettings(value: string | null): InventorySettings {
  return value ? { ...DEFAULT_SETTINGS, ...(JSON.parse(value) as InventorySettings) } : DEFAULT_SETTINGS;
}

function parseStoredHistory(value: string | null): PositionHistoryEntry[] {
  return value ? (JSON.parse(value) as PositionHistoryEntry[]) : [];
}

async function syncActiveUserNotifications(products: Product[], settings: InventorySettings) {
  try {
    await clearExpiryNotifications();
    if (settings.notificationsEnabled) await syncExpiryNotifications(products, settings);
  } catch {
    // การแจ้งเตือนเป็นความสามารถเฉพาะอุปกรณ์ จึงไม่ควรขัดขวางการสลับผู้ใช้
  }
}

export function InventoryProvider({ children }: PropsWithChildren) {
  const [products, setProducts] = useState<Product[]>([]);
  const [deletedProducts, setDeletedProducts] = useState<DeletedProduct[]>([]);
  const [positionHistory, setPositionHistory] = useState<PositionHistoryEntry[]>([]);
  const [lastDeletedProduct, setLastDeletedProduct] = useState<Product | null>(null);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_USER_PROFILE);
  const [profiles, setProfiles] = useState<UserProfile[]>([DEFAULT_USER_PROFILE]);
  const [activeUserId, setActiveUserId] = useState(DEFAULT_USER_PROFILE.id);
  const [settings, setSettings] = useState<InventorySettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  const loadUserData = useCallback(async (userId: string, availableProfiles: UserProfile[]) => {
    const selectedProfile = availableProfiles.find((candidate) => candidate.id === userId) ?? DEFAULT_USER_PROFILE;
    const [storedProducts, storedSettings, storedHistory, storedDeletedProducts, legacyProducts, legacySettings, legacyHistory] = await Promise.all([
      AsyncStorage.getItem(getUserDataStorageKey(userId, "products")),
      AsyncStorage.getItem(getUserDataStorageKey(userId, "settings")),
      AsyncStorage.getItem(getUserDataStorageKey(userId, "history")),
      AsyncStorage.getItem(getUserDataStorageKey(userId, DELETED_PRODUCTS_SUFFIX)),
      userId === DEFAULT_USER_PROFILE.id ? AsyncStorage.getItem(LEGACY_PRODUCTS_KEY) : Promise.resolve(null),
      userId === DEFAULT_USER_PROFILE.id ? AsyncStorage.getItem(LEGACY_SETTINGS_KEY) : Promise.resolve(null),
      userId === DEFAULT_USER_PROFILE.id ? AsyncStorage.getItem(LEGACY_POSITION_HISTORY_KEY) : Promise.resolve(null),
    ]);

    const productSource = storedProducts ?? legacyProducts;
    const settingsSource = storedSettings ?? legacySettings;
    const historySource = storedHistory ?? legacyHistory;
    const nextProducts = normalizeProducts(productSource);
    const nextSettings = parseStoredSettings(settingsSource);
    const nextHistory = parseStoredHistory(historySource);
    const nextDeletedProducts = storedDeletedProducts ? JSON.parse(storedDeletedProducts) as DeletedProduct[] : [];

    setActiveUserId(selectedProfile.id);
    setProfile(selectedProfile);
    setProducts(nextProducts);
    setDeletedProducts(nextDeletedProducts);
    setSettings(nextSettings);
    setPositionHistory(nextHistory);
    setLastDeletedProduct(null);

    if (userId === DEFAULT_USER_PROFILE.id) {
      await Promise.all([
        storedProducts || !legacyProducts ? Promise.resolve() : AsyncStorage.setItem(getUserDataStorageKey(userId, "products"), JSON.stringify(nextProducts)),
        storedSettings || !legacySettings ? Promise.resolve() : AsyncStorage.setItem(getUserDataStorageKey(userId, "settings"), JSON.stringify(nextSettings)),
        storedHistory || !legacyHistory ? Promise.resolve() : AsyncStorage.setItem(getUserDataStorageKey(userId, "history"), JSON.stringify(nextHistory)),
      ]);
    }
    await syncActiveUserNotifications(nextProducts, nextSettings);
  }, []);

  useEffect(() => {
    async function loadInventory() {
      setIsLoading(true);
      try {
        const [storedProfiles, storedActiveUser, legacyProfile] = await Promise.all([
          AsyncStorage.getItem(USER_PROFILES_KEY),
          AsyncStorage.getItem(ACTIVE_USER_KEY),
          AsyncStorage.getItem(LEGACY_USER_PROFILE_KEY),
        ]);
        const parsedProfiles = storedProfiles ? (JSON.parse(storedProfiles) as Partial<UserProfile>[]) : [];
        const nextProfiles = parsedProfiles.length > 0
          ? parsedProfiles.map((candidate, index) => normalizeProfile(candidate, index === 0 ? DEFAULT_USER_PROFILE.id : `user-imported-${index}`))
          : [normalizeProfile(legacyProfile ? (JSON.parse(legacyProfile) as Partial<UserProfile>) : undefined, DEFAULT_USER_PROFILE.id)];
        const selectedUserId = storedActiveUser && nextProfiles.some((candidate) => candidate.id === storedActiveUser) ? storedActiveUser : nextProfiles[0].id;
        setProfiles(nextProfiles);
        await AsyncStorage.setItem(USER_PROFILES_KEY, JSON.stringify(nextProfiles));
        await AsyncStorage.setItem(ACTIVE_USER_KEY, selectedUserId);
        await loadUserData(selectedUserId, nextProfiles);
      } finally {
        setIsLoading(false);
      }
    }
    loadInventory();
  }, [loadUserData]);

  const persistProducts = useCallback(async (nextProducts: Product[]) => {
    setProducts(nextProducts);
    await AsyncStorage.setItem(getUserDataStorageKey(activeUserId, "products"), JSON.stringify(nextProducts));
    const nextCatalog = [...new Set([...(settings.categoryCatalog ?? []), ...nextProducts.map((product) => normalizeProductCategory(product.category)).filter(Boolean)])];
    if (nextCatalog.length !== (settings.categoryCatalog ?? []).length) {
      const nextSettings = { ...settings, categoryCatalog: nextCatalog };
      setSettings(nextSettings);
      await AsyncStorage.setItem(getUserDataStorageKey(activeUserId, "settings"), JSON.stringify(nextSettings));
    }
    await syncActiveUserNotifications(nextProducts, settings);
  }, [activeUserId, settings]);

  const persistDeletedProducts = useCallback(async (nextDeletedProducts: DeletedProduct[]) => {
    setDeletedProducts(nextDeletedProducts);
    await AsyncStorage.setItem(getUserDataStorageKey(activeUserId, DELETED_PRODUCTS_SUFFIX), JSON.stringify(nextDeletedProducts));
  }, [activeUserId]);

  const appendPositionHistory = useCallback(async (entry: PositionHistoryEntry) => {
    const nextHistory = [entry, ...positionHistory].slice(0, 200);
    setPositionHistory(nextHistory);
    await AsyncStorage.setItem(getUserDataStorageKey(activeUserId, "history"), JSON.stringify(nextHistory));
  }, [activeUserId, positionHistory]);

  const addProduct = useCallback(async (input: ProductInput) => {
    const product: Product = { ...input, id: createProductId(), createdAt: new Date().toISOString() };
    await persistProducts([...products, product]);
    return product;
  }, [persistProducts, products]);

  const insertProduct = useCallback(async (input: ProductInput) => {
    const product: Product = { ...input, id: createProductId(), createdAt: new Date().toISOString() };
    const nextProducts = insertProductIntoRow(products, product);
    await persistProducts(nextProducts);
    await appendPositionHistory({ id: `position-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, productId: product.id, productName: product.name, to: { shelf: product.shelf.trim(), row: product.row.trim(), itemNumber: product.itemNumber }, changedAt: new Date().toISOString(), action: "insert" });
    return nextProducts.find((item) => item.id === product.id) ?? product;
  }, [appendPositionHistory, persistProducts, products]);

  const updateProduct = useCallback(async (id: string, input: ProductInput) => {
    await persistProducts(products.map((product) => (product.id === id ? { ...product, ...input } : product)));
  }, [persistProducts, products]);

  const renameCategory = useCallback(async (from: string, to: string) => {
    const source = normalizeProductCategory(from);
    const target = normalizeProductCategory(to);
    if (!source || !target || source === target) return false;
    const matches = (category?: string) => normalizeProductCategory(category).toLocaleLowerCase("th-TH") === source.toLocaleLowerCase("th-TH");
    const nextProducts = products.map((product) => matches(product.category) ? { ...product, category: target } : product);
    const nextDeletedProducts = deletedProducts.map((product) => matches(product.category) ? { ...product, category: target } : product);
    const nextCatalog = [...new Set([...(settings.categoryCatalog ?? []).filter((category) => !matches(category)), target])];
    const hasProductChange = nextProducts.some((product, index) => product.category !== products[index]?.category) || nextDeletedProducts.some((product, index) => product.category !== deletedProducts[index]?.category);
    const hasCatalogChange = nextCatalog.length !== (settings.categoryCatalog ?? []).length || !nextCatalog.every((category, index) => category === settings.categoryCatalog?.[index]);
    if (!hasProductChange && !hasCatalogChange) return false;
    if (hasProductChange) await persistProducts(nextProducts);
    await persistDeletedProducts(nextDeletedProducts);
    if (hasCatalogChange) {
      const nextSettings = { ...settings, categoryCatalog: nextCatalog };
      setSettings(nextSettings);
      await AsyncStorage.setItem(getUserDataStorageKey(activeUserId, "settings"), JSON.stringify(nextSettings));
    }
    return true;
  }, [activeUserId, deletedProducts, persistDeletedProducts, persistProducts, products, settings]);

  const deleteUnusedCategory = useCallback(async (category: string) => {
    const target = normalizeProductCategory(category).toLocaleLowerCase("th-TH");
    if (!target || products.some((product) => normalizeProductCategory(product.category).toLocaleLowerCase("th-TH") === target) || deletedProducts.some((product) => normalizeProductCategory(product.category).toLocaleLowerCase("th-TH") === target)) return false;
    const nextCatalog = (settings.categoryCatalog ?? []).filter((item) => normalizeProductCategory(item).toLocaleLowerCase("th-TH") !== target);
    if (nextCatalog.length === (settings.categoryCatalog ?? []).length) return false;
    const nextSettings = { ...settings, categoryCatalog: nextCatalog };
    setSettings(nextSettings);
    await AsyncStorage.setItem(getUserDataStorageKey(activeUserId, "settings"), JSON.stringify(nextSettings));
    return true;
  }, [activeUserId, deletedProducts, products, settings]);

  const addLotToProduct = useCallback(async (id: string, input: ProductLotInput) => {
    const product = products.find((item) => item.id === id);
    if (!product) return null;
    const nextProduct = addInventoryLot(product, input);
    await persistProducts(products.map((item) => item.id === id ? nextProduct : item));
    return nextProduct;
  }, [persistProducts, products]);

  const updateLotQuantity = useCallback(async (id: string, lotId: string, quantity: number) => {
    const product = products.find((item) => item.id === id);
    if (!product) return null;
    const nextProduct = updateProductLotQuantity(product, lotId, quantity);
    if (!nextProduct) return null;
    await persistProducts(products.map((item) => item.id === id ? nextProduct : item));
    return nextProduct;
  }, [persistProducts, products]);

  const deleteLot = useCallback(async (id: string, lotId: string) => {
    const product = products.find((item) => item.id === id);
    if (!product) return false;
    const nextProduct = removeProductLot(product, lotId);
    if (nextProduct === undefined) return false;
    if (nextProduct === null) {
      await persistProducts(products.filter((item) => item.id !== id));
      return true;
    }
    await persistProducts(products.map((item) => item.id === id ? nextProduct : item));
    return false;
  }, [persistProducts, products]);

  const deleteProduct = useCallback(async (id: string) => {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    const deletedProduct: DeletedProduct = { ...product, deletedAt: new Date().toISOString() };
    await persistProducts(products.filter((item) => item.id !== id));
    await persistDeletedProducts([deletedProduct, ...deletedProducts.filter((item) => item.id !== id)]);
    await appendPositionHistory({ id: `position-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, productId: product.id, productName: product.name, from: { shelf: product.shelf, row: product.row, itemNumber: product.itemNumber }, changedAt: new Date().toISOString(), action: "delete", deletedProduct: product });
    setLastDeletedProduct(product);
  }, [appendPositionHistory, deletedProducts, persistDeletedProducts, persistProducts, products]);

  const undoDelete = useCallback(async () => {
    if (!lastDeletedProduct || products.some((product) => product.id === lastDeletedProduct.id)) return;
    const originalPosition: ProductPosition = { shelf: lastDeletedProduct.shelf, row: lastDeletedProduct.row, itemNumber: lastDeletedProduct.itemNumber };
    const restoredProduct = restoreDeletedProduct(products, lastDeletedProduct);
    const restoredPosition: ProductPosition = { shelf: restoredProduct.shelf, row: restoredProduct.row, itemNumber: restoredProduct.itemNumber };
    await persistProducts([...products, restoredProduct]);
    await persistDeletedProducts(deletedProducts.filter((product) => product.id !== lastDeletedProduct.id));
    await appendPositionHistory({ id: `position-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, productId: restoredProduct.id, productName: restoredProduct.name, from: originalPosition, to: restoredPosition, changedAt: new Date().toISOString(), action: "restore", deletedProduct: restoredProduct });
    setLastDeletedProduct(null);
  }, [appendPositionHistory, deletedProducts, lastDeletedProduct, persistDeletedProducts, persistProducts, products]);

  const restoreArchivedProduct = useCallback(async (id: string) => {
    const archived = deletedProducts.find((product) => product.id === id);
    if (!archived || products.some((product) => product.id === id)) return;
    const { deletedAt: _deletedAt, ...restoredProduct } = archived;
    await persistProducts([...products, restoredProduct]);
    await persistDeletedProducts(deletedProducts.filter((product) => product.id !== id));
    await appendPositionHistory({ id: `position-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, productId: restoredProduct.id, productName: restoredProduct.name, to: { shelf: restoredProduct.shelf, row: restoredProduct.row, itemNumber: restoredProduct.itemNumber }, changedAt: new Date().toISOString(), action: "restore", deletedProduct: restoredProduct });
  }, [appendPositionHistory, deletedProducts, persistDeletedProducts, persistProducts, products]);

  const moveProduct = useCallback(async (id: string, direction: "up" | "down") => {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    const nextProducts = moveProductWithinRow(products, id, direction);
    const movedProduct = nextProducts.find((item) => item.id === id);
    if (!movedProduct || movedProduct.itemNumber === product.itemNumber) return;
    await persistProducts(nextProducts);
    await appendPositionHistory({ id: `position-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, productId: id, productName: product.name, from: { shelf: product.shelf, row: product.row, itemNumber: product.itemNumber }, to: { shelf: movedProduct.shelf, row: movedProduct.row, itemNumber: movedProduct.itemNumber }, changedAt: new Date().toISOString(), action: "reorder" });
  }, [appendPositionHistory, persistProducts, products]);

  const relocateProduct = useCallback(async (id: string, destination: ProductPosition) => {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    const nextProducts = relocateInventoryProduct(products, id, destination);
    const movedProduct = nextProducts.find((item) => item.id === id);
    if (!movedProduct) return;
    const hasChanged = product.shelf !== movedProduct.shelf || product.row !== movedProduct.row || product.itemNumber !== movedProduct.itemNumber;
    if (!hasChanged) return;
    await persistProducts(nextProducts);
    await appendPositionHistory({ id: `position-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, productId: id, productName: product.name, from: { shelf: product.shelf, row: product.row, itemNumber: product.itemNumber }, to: { shelf: movedProduct.shelf, row: movedProduct.row, itemNumber: movedProduct.itemNumber }, changedAt: new Date().toISOString(), action: "move" });
  }, [appendPositionHistory, persistProducts, products]);

  const updateSettings = useCallback(async (patch: Partial<InventorySettings>) => {
    const nextSettings = { ...settings, ...patch };
    setSettings(nextSettings);
    await AsyncStorage.setItem(getUserDataStorageKey(activeUserId, "settings"), JSON.stringify(nextSettings));
  }, [activeUserId, settings]);

  const updateProfile = useCallback(async (patch: Partial<UserProfileInput>) => {
    const nextProfile = { ...profile, ...patch };
    const nextProfiles = profiles.map((candidate) => (candidate.id === nextProfile.id ? nextProfile : candidate));
    setProfile(nextProfile);
    setProfiles(nextProfiles);
    await AsyncStorage.setItem(USER_PROFILES_KEY, JSON.stringify(nextProfiles));
  }, [profile, profiles]);

  const switchUser = useCallback(async (userId: string) => {
    if (!profiles.some((candidate) => candidate.id === userId)) return;
    setIsLoading(true);
    try {
      await AsyncStorage.setItem(ACTIVE_USER_KEY, userId);
      await loadUserData(userId, profiles);
    } finally {
      setIsLoading(false);
    }
  }, [loadUserData, profiles]);

  const createUser = useCallback(async (input: UserProfileInput) => {
    const nextUser = createUserProfile(input);
    const nextProfiles = [...profiles, nextUser];
    setProfiles(nextProfiles);
    await AsyncStorage.setItem(USER_PROFILES_KEY, JSON.stringify(nextProfiles));
    setIsLoading(true);
    try {
      await AsyncStorage.setItem(ACTIVE_USER_KEY, nextUser.id);
      await loadUserData(nextUser.id, nextProfiles);
    } finally {
      setIsLoading(false);
    }
    return nextUser;
  }, [loadUserData, profiles]);

  const exportBackupData = useCallback(async (onProgress?: BackupProgressCallback) => {
    const profileEntries: InventoryBackupProfile[] = [];
    onProgress?.({ percent: 4, message: "กำลังอ่านข้อมูลคลังสินค้า" });
    for (const [index, candidate] of profiles.entries()) {
      const [storedProducts, storedSettings, storedHistory, storedDeletedProducts, legacyProducts, legacySettings, legacyHistory] = await Promise.all([
        AsyncStorage.getItem(getUserDataStorageKey(candidate.id, "products")),
        AsyncStorage.getItem(getUserDataStorageKey(candidate.id, "settings")),
        AsyncStorage.getItem(getUserDataStorageKey(candidate.id, "history")),
        AsyncStorage.getItem(getUserDataStorageKey(candidate.id, DELETED_PRODUCTS_SUFFIX)),
        candidate.id === DEFAULT_USER_PROFILE.id ? AsyncStorage.getItem(LEGACY_PRODUCTS_KEY) : Promise.resolve(null),
        candidate.id === DEFAULT_USER_PROFILE.id ? AsyncStorage.getItem(LEGACY_SETTINGS_KEY) : Promise.resolve(null),
        candidate.id === DEFAULT_USER_PROFILE.id ? AsyncStorage.getItem(LEGACY_POSITION_HISTORY_KEY) : Promise.resolve(null),
      ]);
      profileEntries.push({
        ...candidate,
        products: normalizeProducts(storedProducts ?? legacyProducts),
        deletedProducts: storedDeletedProducts ? JSON.parse(storedDeletedProducts) as DeletedProduct[] : [],
        settings: parseStoredSettings(storedSettings ?? legacySettings),
        positionHistory: parseStoredHistory(storedHistory ?? legacyHistory),
      });
      onProgress?.({
        percent: 8 + Math.round(((index + 1) / profiles.length) * 42),
        message: `อ่านข้อมูลผู้ใช้ ${index + 1} จาก ${profiles.length} คนแล้ว`,
      });
    }
    onProgress?.({ percent: 50, message: "กำลังรวบรวมรูปภาพสินค้า" });
    const collectedImages = await collectBackupImages(profileEntries, (completed, total) => {
      const imageProgress = total > 0 ? Math.round((completed / total) * 20) : 20;
      onProgress?.({ percent: 50 + imageProgress, message: total > 0 ? `กำลังสำรองรูปภาพ ${completed} จาก ${total} รูป` : "ไม่พบรูปภาพที่ต้องสำรอง" });
    });
    if (collectedImages.skippedImageCount > 0) {
      onProgress?.({ percent: 72, message: `ข้ามรูปภาพ ${collectedImages.skippedImageCount} รายการที่อ่านไม่ได้หรือมีขนาดเกินกำหนด` });
    }
    onProgress?.({ percent: 76, message: "กำลังจัดเตรียมไฟล์สำรอง" });
    return createInventoryBackup({ activeUserId, profiles: profileEntries, images: collectedImages.images, skippedImageCount: collectedImages.skippedImageCount });
  }, [activeUserId, profiles]);

  const restoreBackupData = useCallback(async (sourceBackup: InventoryBackup, onProgress?: BackupProgressCallback) => {
    onProgress?.({ percent: 6, message: "กำลังตรวจสอบข้อมูลสำรอง" });
    const normalizedBackup = normalizeInventoryBackup(sourceBackup);
    onProgress?.({ percent: 10, message: "กำลังกู้คืนรูปภาพสินค้า" });
    const hydratedResult = await hydrateBackupImages(normalizedBackup, (completed, total) => {
      const imageProgress = total > 0 ? Math.round((completed / total) * 12) : 12;
      onProgress?.({ percent: 10 + imageProgress, message: total > 0 ? `กำลังกู้คืนรูปภาพ ${completed} จาก ${total} รูป` : "ไม่พบรูปภาพในไฟล์สำรอง" });
    });
    const backup = hydratedResult.backup;
    onProgress?.({ percent: 10, message: "กำลังสร้างจุดย้อนคืนข้อมูลเดิม" });
    const rollbackBackup = await exportBackupData((update) => {
      onProgress?.({ percent: 10 + Math.round(update.percent * 0.24), message: "กำลังสร้างจุดย้อนคืนข้อมูลเดิม" });
    });
    const previousProfileIds = profiles.map((candidate) => candidate.id);
    const nextProfileIds = backup.profiles.map((candidate) => candidate.id);
    const allProfileIds = [...new Set([...previousProfileIds, ...nextProfileIds])];
    const dataKeys = allProfileIds.flatMap((userId) => [
      getUserDataStorageKey(userId, "products"),
      getUserDataStorageKey(userId, "settings"),
      getUserDataStorageKey(userId, "history"),
      getUserDataStorageKey(userId, DELETED_PRODUCTS_SUFFIX),
    ]);
    const storageKeys = [USER_PROFILES_KEY, ACTIVE_USER_KEY, ...dataKeys];
    const previousValues = await AsyncStorage.multiGet(storageKeys);
    const previousValueMap = new Map(previousValues);
    const restoredProfiles = backup.profiles.map(({ products: _products, deletedProducts: _deletedProducts, settings: _settings, positionHistory: _history, ...profile }) => profile);
    const nextEntries: [string, string][] = [
      [USER_PROFILES_KEY, JSON.stringify(restoredProfiles)],
      [ACTIVE_USER_KEY, backup.activeUserId],
      ...backup.profiles.flatMap((candidate): [string, string][] => [
        [getUserDataStorageKey(candidate.id, "products"), JSON.stringify(candidate.products)],
        [getUserDataStorageKey(candidate.id, DELETED_PRODUCTS_SUFFIX), JSON.stringify(candidate.deletedProducts ?? [])],
        [getUserDataStorageKey(candidate.id, "settings"), JSON.stringify(candidate.settings)],
        [getUserDataStorageKey(candidate.id, "history"), JSON.stringify(candidate.positionHistory)],
      ]),
    ];
    const obsoleteKeys = previousProfileIds
      .filter((userId) => !nextProfileIds.includes(userId))
      .flatMap((userId) => [getUserDataStorageKey(userId, "products"), getUserDataStorageKey(userId, DELETED_PRODUCTS_SUFFIX), getUserDataStorageKey(userId, "settings"), getUserDataStorageKey(userId, "history")]);

    onProgress?.({ percent: 38, message: "กำลังเตรียมแทนที่ข้อมูลเดิม" });
    setIsLoading(true);
    await AsyncStorage.setItem(PRE_RESTORE_ROLLBACK_KEY, JSON.stringify(rollbackBackup));
    try {
      onProgress?.({ percent: 50, message: "กำลังบันทึกข้อมูลที่กู้คืน" });
      await AsyncStorage.multiSet(nextEntries);
      onProgress?.({ percent: 70, message: "กำลังล้างข้อมูลผู้ใช้เดิม" });
      if (obsoleteKeys.length > 0) await AsyncStorage.multiRemove(obsoleteKeys);
      setProfiles(restoredProfiles);
      onProgress?.({ percent: 82, message: "กำลังโหลดข้อมูลและตั้งการแจ้งเตือน" });
      await loadUserData(backup.activeUserId, restoredProfiles);
      await AsyncStorage.removeItem(PRE_RESTORE_ROLLBACK_KEY);
      onProgress?.({ percent: 100, message: "กู้คืนข้อมูลเสร็จสมบูรณ์" });
    } catch (error) {
      const keysToRemove = storageKeys.filter((key) => previousValueMap.get(key) === null);
      const valuesToRestore = previousValues.filter((entry): entry is [string, string] => entry[1] !== null) as [string, string][];
      if (keysToRemove.length > 0) await AsyncStorage.multiRemove(keysToRemove);
      if (valuesToRestore.length > 0) await AsyncStorage.multiSet(valuesToRestore);
      setProfiles(profiles);
      try {
        await loadUserData(activeUserId, profiles);
      } catch {
        // คงการส่งข้อผิดพลาดเดิมให้หน้าจอแจ้งผู้ใช้ โดยไม่ปล่อยให้การโหลดหน้าจอขัดขวางการย้อนคืน
      }
      await AsyncStorage.removeItem(PRE_RESTORE_ROLLBACK_KEY);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [exportBackupData, loadUserData, profiles]);

  const value = useMemo(
    () => ({ products, deletedProducts, positionHistory, lastDeletedProduct, profile, profiles, activeUserId, settings, isLoading, addProduct, insertProduct, addLotToProduct, updateLotQuantity, deleteLot, updateProduct, renameCategory, deleteUnusedCategory, deleteProduct, undoDelete, restoreArchivedProduct, moveProduct, relocateProduct, updateProfile, createUser, switchUser, updateSettings, exportBackupData, restoreBackupData }),
    [activeUserId, addLotToProduct, addProduct, createUser, deleteLot, deleteProduct, deleteUnusedCategory, deletedProducts, exportBackupData, insertProduct, isLoading, lastDeletedProduct, moveProduct, positionHistory, products, profile, profiles, relocateProduct, renameCategory, restoreArchivedProduct, restoreBackupData, settings, switchUser, undoDelete, updateLotQuantity, updateProduct, updateProfile, updateSettings],
  );

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  const context = useContext(InventoryContext);
  if (!context) throw new Error("useInventory must be used within InventoryProvider");
  return context;
}
