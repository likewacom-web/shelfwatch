import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { writeZipBackup } from "@/lib/backup-zip";
import { serializeInventoryBackup, type InventoryBackup, type InventoryBackupImage, type InventoryBackupImageFile, type InventoryBackupProfile } from "@/lib/inventory-backup";
import { assertBackupSerializedSize } from "@/lib/inventory-backup-policy";
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
  imageFiles: InventoryBackupImageFile[];
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
    return { images, imageFiles: [], skippedImageCount };
  }
  if (!FileSystem.documentDirectory) {
    onProgress?.(sourceUris.length, sourceUris.length);
    return { images: [], imageFiles: [], skippedImageCount: sourceUris.length };
  }

  // Native: photos go into the zip as separate files at original quality, no size cap.
  const imageFiles: InventoryBackupImageFile[] = [];
  let skippedImageCount = 0;
  for (const [index, sourceUri] of sourceUris.entries()) {
    try {
      let localUri = sourceUri;
      let extension = imageExtension(sourceUri);
      const info = sourceUri.startsWith("file://") ? await FileSystem.getInfoAsync(sourceUri) : null;
      if (!info?.exists) {
        // Not a plain local file (content://, ph://, ...): convert to a local JPEG copy.
        const converted = await ImageManipulator.manipulateAsync(sourceUri, [], { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG });
        localUri = converted.uri;
        extension = "jpg";
      }
      const size = info?.exists && "size" in info ? info.size : 0;
      imageFiles.push({ sourceUri, localUri, extension, size, path: `images/img-${String(imageFiles.length + 1).padStart(5, "0")}.${extension}` });
    } catch {
      skippedImageCount += 1;
    }
    onProgress?.(index + 1, sourceUris.length);
  }
  return { images, imageFiles, skippedImageCount };
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
    const imageFiles = backup.imageFiles ?? [];
    const total = backup.images.length + imageFiles.length;
    for (const [index, image] of backup.images.entries()) {
      try {
        const destination = `${directory}restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${image.extension}`;
        await FileSystem.writeAsStringAsync(destination, image.base64, { encoding: FileSystem.EncodingType.Base64 });
        restoredImages.set(image.sourceUri, destination);
      } catch {
        skippedImageCount += 1;
      }
      onProgress?.(index + 1, total);
    }
    // Photos from a .zip backup were already extracted; move them into the app's folder.
    for (const [index, imageFile] of imageFiles.entries()) {
      try {
        if (!imageFile.localUri) throw new Error("missing extracted image");
        const destination = `${directory}restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${imageFile.extension}`;
        await FileSystem.moveAsync({ from: imageFile.localUri, to: destination });
        restoredImages.set(imageFile.sourceUri, destination);
      } catch {
        skippedImageCount += 1;
      }
      onProgress?.(backup.images.length + index + 1, total);
    }
  } else {
    backup.images.forEach((image, index) => {
      restoredImages.set(image.sourceUri, `data:image/${image.extension};base64,${image.base64}`);
      onProgress?.(index + 1, backup.images.length);
    });
  }
  if (backup.images.length === 0 && (backup.imageFiles?.length ?? 0) === 0) onProgress?.(0, 0);

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
    skippedImageCount: skippedImageCount + Math.max(0, backup.images.length + (backup.imageFiles?.length ?? 0) - restoredImages.size - skippedImageCount),
  };
}

function createBackupFileName() {
  const compactDate = new Date().toISOString().replace(/[:.]/g, "-");
  return `ShelfWatch-backup-${compactDate}.json`;
}

export interface SavedBackupResult {
  mode: "shared" | "downloaded";
  imageCount: number;
  skippedImageCount: number;
}

export async function saveAndShareInventoryBackup(backup: InventoryBackup, onImageProgress?: BackupFileProgressCallback): Promise<SavedBackupResult> {
  if (Platform.OS !== "web") {
    const zip = await writeZipBackup(backup, onImageProgress);
    if (!(await Sharing.isAvailableAsync())) throw new Error("อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์สำรอง");
    await Sharing.shareAsync(zip.uri, { dialogTitle: "บันทึกไฟล์สำรอง ShelfWatch", mimeType: "application/zip", UTI: "public.zip-archive" });
    return { mode: "shared", imageCount: zip.writtenImages + backup.images.length, skippedImageCount: (backup.skippedImageCount ?? 0) + zip.failedImages };
  }
  const serialized = serializeInventoryBackup(backup);
  assertBackupSerializedSize(serialized);
  const filename = createBackupFileName();
  if (typeof document === "undefined" || typeof URL === "undefined") throw new Error("เบราว์เซอร์นี้ไม่รองรับการดาวน์โหลดไฟล์สำรอง");
  const blob = new Blob([serialized], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return { mode: "downloaded", imageCount: backup.images.length, skippedImageCount: backup.skippedImageCount ?? 0 };
}

export async function readInventoryBackupText(uri: string, webFile?: File): Promise<string> {
  if (Platform.OS === "web" && webFile) return webFile.text();
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
}
