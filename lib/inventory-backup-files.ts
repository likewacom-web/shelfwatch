import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { type InventoryBackup, type InventoryBackupImage, type InventoryBackupProfile } from "@/lib/inventory-backup";
import { assertBackupSerializedSize, canIncludeBackupImage } from "@/lib/inventory-backup-policy";
import { getProductImageUris, type Product } from "@/lib/inventory";

function imageExtension(uri: string, mimeType?: string): string {
  const mimeExtension = mimeType?.split("/")[1]?.split(";")[0]?.toLowerCase();
  if (mimeExtension && /^[a-z0-9]{2,5}$/.test(mimeExtension)) return mimeExtension === "jpeg" ? "jpg" : mimeExtension;
  const extension = uri.split("?")[0]?.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "jpg";
}

function decodeDataUri(uri: string): InventoryBackupImage | undefined {
  const match = uri.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return undefined;
  return { sourceUri: uri, base64: match[2], extension: imageExtension(uri, match[1]) };
}

async function collectWebImage(sourceUri: string): Promise<InventoryBackupImage | undefined> {
  const dataImage = decodeDataUri(sourceUri);
  if (dataImage) return dataImage;
  try {
    const compressed = await ImageManipulator.manipulateAsync(sourceUri, [], { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    if (compressed.base64) return { sourceUri, base64: compressed.base64, extension: "jpg" };
  } catch {
    // Fall back to the original fetch path when the browser cannot process the URI.
  }
  const response = await fetch(sourceUri);
  if (!response.ok) return undefined;
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return { sourceUri, base64: btoa(binary), extension: imageExtension(sourceUri, blob.type) };
}

function collectProductsWithImages(profile: InventoryBackupProfile): Product[] {
  return [...profile.products, ...(profile.deletedProducts ?? []), ...profile.positionHistory.flatMap((entry) => entry.deletedProduct ? [entry.deletedProduct] : [])];
}

export interface CollectedBackupImages {
  images: InventoryBackupImage[];
  skippedImageCount: number;
}

export type BackupFileProgressCallback = (completed: number, total: number) => void;

export async function collectBackupImages(profiles: InventoryBackupProfile[], onProgress?: BackupFileProgressCallback): Promise<CollectedBackupImages> {
  const sourceUris = [...new Set([
    ...profiles.flatMap(collectProductsWithImages).flatMap(getProductImageUris),
    ...profiles.flatMap((profile) => profile.avatarUri ? [profile.avatarUri] : []),
    ...profiles.flatMap((profile) => profile.settings.backgroundImageUri ? [profile.settings.backgroundImageUri] : []),
  ])];
  const images: InventoryBackupImage[] = [];
  if (Platform.OS === "web") {
    let skippedImageCount = 0;
    for (const [index, sourceUri] of sourceUris.entries()) {
      try {
        const image = await collectWebImage(sourceUri);
        if (image) images.push(image);
        else skippedImageCount += 1;
      } catch {
        skippedImageCount += 1;
      }
      onProgress?.(index + 1, sourceUris.length);
    }
    return { images, skippedImageCount };
  }
  if (!FileSystem.documentDirectory) {
    onProgress?.(sourceUris.length, sourceUris.length);
    return { images: [], skippedImageCount: sourceUris.length };
  }

  let skippedImageCount = 0;
  let totalBytes = 0;
  for (const [index, sourceUri] of sourceUris.entries()) {
    try {
      const compressed = await ImageManipulator.manipulateAsync(sourceUri, [], { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      const base64 = compressed.base64;
      const compressedBytes = base64 ? Math.ceil((base64.length * 3) / 4) : 0;
      if (!base64 || !canIncludeBackupImage(compressedBytes, totalBytes)) {
        skippedImageCount += 1;
        continue;
      }
      images.push({ sourceUri, base64, extension: "jpg" });
      totalBytes += compressedBytes;
    } catch {
      skippedImageCount += 1;
    }
    onProgress?.(index + 1, sourceUris.length);
  }
  return { images, skippedImageCount };
}

function replaceProductImageUris(product: Product, restoredImages: Map<string, string>): Product {
  const imageUris = getProductImageUris(product).flatMap((sourceUri) => {
    const restoredUri = restoredImages.get(sourceUri);
    return restoredUri ? [restoredUri] : [];
  });
  return { ...product, imageUris, imageUri: imageUris[0] };
}

export interface HydratedBackupImages {
  backup: InventoryBackup;
  restoredImageCount: number;
  skippedImageCount: number;
}

export async function hydrateBackupImages(backup: InventoryBackup, onProgress?: BackupFileProgressCallback): Promise<HydratedBackupImages> {
  const restoredImages = new Map<string, string>();
  let skippedImageCount = 0;
  if (Platform.OS !== "web" && FileSystem.documentDirectory) {
    const directory = `${FileSystem.documentDirectory}restored-product-images/`;
    const directoryInfo = await FileSystem.getInfoAsync(directory);
    if (!directoryInfo.exists) await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    for (const [index, image] of backup.images.entries()) {
      try {
        const destination = `${directory}restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${image.extension}`;
        await FileSystem.writeAsStringAsync(destination, image.base64, { encoding: FileSystem.EncodingType.Base64 });
        restoredImages.set(image.sourceUri, destination);
      } catch {
        skippedImageCount += 1;
      }
      onProgress?.(index + 1, backup.images.length);
    }
  } else {
    backup.images.forEach((image, index) => {
      restoredImages.set(image.sourceUri, `data:image/${image.extension};base64,${image.base64}`);
      onProgress?.(index + 1, backup.images.length);
    });
  }
  if (backup.images.length === 0) onProgress?.(0, 0);

  const profiles = backup.profiles.map((profile) => ({
    ...profile,
    avatarUri: profile.avatarUri ? restoredImages.get(profile.avatarUri) : undefined,
    settings: { ...profile.settings, backgroundImageUri: profile.settings.backgroundImageUri ? restoredImages.get(profile.settings.backgroundImageUri) : undefined },
    products: profile.products.map((product) => replaceProductImageUris(product, restoredImages)),
    deletedProducts: (profile.deletedProducts ?? []).map((product) => ({ ...replaceProductImageUris(product, restoredImages), deletedAt: product.deletedAt })),
    positionHistory: profile.positionHistory.map((entry) => ({
      ...entry,
      deletedProduct: entry.deletedProduct ? replaceProductImageUris(entry.deletedProduct, restoredImages) : undefined,
    })),
  }));
  return {
    backup: { ...backup, profiles },
    restoredImageCount: restoredImages.size,
    skippedImageCount: skippedImageCount + Math.max(0, backup.images.length - restoredImages.size - skippedImageCount),
  };
}

function createBackupFileName() {
  const compactDate = new Date().toISOString().replace(/[:.]/g, "-");
  return `ShelfWatch-backup-${compactDate}.json`;
}

export async function saveAndShareInventoryBackup(serialized: string): Promise<"shared" | "downloaded"> {
  assertBackupSerializedSize(serialized);
  const filename = createBackupFileName();
  if (Platform.OS === "web") {
    if (typeof document === "undefined" || typeof URL === "undefined") throw new Error("เบราว์เซอร์นี้ไม่รองรับการดาวน์โหลดไฟล์สำรอง");
    const blob = new Blob([serialized], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return "downloaded";
  }
  if (!FileSystem.cacheDirectory) throw new Error("ไม่พบพื้นที่สำหรับสร้างไฟล์สำรอง");
  const fileUri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, serialized, { encoding: FileSystem.EncodingType.UTF8 });
  if (!(await Sharing.isAvailableAsync())) throw new Error("อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์สำรอง");
  await Sharing.shareAsync(fileUri, { dialogTitle: "บันทึกไฟล์สำรอง ShelfWatch", mimeType: "application/json", UTI: "public.json" });
  return "shared";
}

export async function readInventoryBackupText(uri: string, webFile?: File): Promise<string> {
  if (Platform.OS === "web" && webFile) return webFile.text();
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
}
