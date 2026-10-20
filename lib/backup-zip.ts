/**
 * .zip backups for Android/iOS.
 *
 * The old backup put every photo inside one JSON file as base64, which had to fit in memory,
 * so photos were squeezed to a 1 MB / 6 MB cap and most phone photos were skipped.
 * The zip keeps each photo as its own file (original quality) and is written and read in
 * small chunks, so the number of photos is no longer limited by memory.
 */
import { Directory, File, Paths } from "expo-file-system";
import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8 } from "fflate";

import { parseInventoryBackup, serializeInventoryBackup, type InventoryBackup } from "@/lib/inventory-backup";

export const BACKUP_JSON_ENTRY = "backup.json";
const READ_CHUNK_BYTES = 512 * 1024;
const IMAGE_ENTRY = /^images\/[A-Za-z0-9._-]+$/;

export type ZipProgressCallback = (completed: number, total: number) => void;

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function backupFileName() {
  return `ShelfWatch-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
}

/** Writes backup.json plus images/* into a zip in the cache folder and returns its uri. */
export async function writeZipBackup(backup: InventoryBackup, onProgress?: ZipProgressCallback): Promise<{ uri: string; writtenImages: number; failedImages: number }> {
  const target = new File(Paths.cache, backupFileName());
  if (target.exists) target.delete();
  target.create();
  const handle = target.open();
  let writeError: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) { writeError = error; return; }
    if (chunk.length > 0) handle.writeBytes(chunk);
  });

  const files = backup.imageFiles ?? [];
  const written: typeof files = [];
  let failedImages = 0;
  try {
    for (const [index, imageFile] of files.entries()) {
      try {
        if (!imageFile.localUri) throw new Error("missing image");
        const bytes = await new File(imageFile.localUri).bytes();
        const entry = new ZipPassThrough(imageFile.path); // JPEG/PNG are already compressed
        zip.add(entry);
        entry.push(bytes, true);
        written.push({ ...imageFile, size: bytes.length });
      } catch {
        failedImages += 1;
      }
      if (writeError) throw writeError;
      onProgress?.(index + 1, files.length);
      await nextFrame();
    }
    const finalBackup: InventoryBackup = { ...backup, imageFiles: written, skippedImageCount: (backup.skippedImageCount ?? 0) + failedImages };
    const json = new ZipDeflate(BACKUP_JSON_ENTRY, { level: 6 });
    zip.add(json);
    json.push(strToU8(serializeInventoryBackup(finalBackup)), true);
    zip.end();
    if (writeError) throw writeError;
  } catch (error) {
    try { handle.close(); } catch { /* ignore */ }
    try { target.delete(); } catch { /* ignore */ }
    throw error instanceof Error ? error : new Error("สร้างไฟล์สำรองไม่สำเร็จ");
  }
  handle.close();
  return { uri: target.uri, writtenImages: written.length, failedImages };
}

/** True when the file starts with the zip signature "PK". */
export function isZipFile(uri: string): boolean {
  try {
    const handle = new File(uri).open();
    try {
      const head = handle.readBytes(2);
      return head.length === 2 && head[0] === 0x50 && head[1] === 0x4b;
    } finally {
      handle.close();
    }
  } catch {
    return false;
  }
}

/**
 * Reads a zip backup. Photos are extracted to a temporary folder; each imageFiles entry gets
 * `localUri` pointing at its extracted file, ready for hydrateBackupImages to move into place.
 */
export async function readZipBackup(uri: string, onProgress?: ZipProgressCallback): Promise<InventoryBackup> {
  const source = new File(uri);
  const handle = source.open();
  const totalBytes = handle.size ?? source.size ?? 0;
  const folder = new Directory(Paths.cache, `restore-${Date.now()}`);
  folder.create({ intermediates: true });

  const jsonChunks: Uint8Array[] = [];
  const extracted = new Map<string, string>();
  let entryError: Error | null = null;

  const unzip = new Unzip((entry) => {
    if (entry.name === BACKUP_JSON_ENTRY) {
      entry.ondata = (error, data) => {
        if (error) { entryError = error; return; }
        if (data.length > 0) jsonChunks.push(data);
      };
      entry.start();
      return;
    }
    if (!IMAGE_ENTRY.test(entry.name)) return; // ignore anything unexpected
    const output = new File(folder, entry.name.slice("images/".length));
    output.create({ overwrite: true });
    const outputHandle = output.open();
    entry.ondata = (error, data, final) => {
      if (error) { entryError = error; try { outputHandle.close(); } catch { /* ignore */ } return; }
      if (data.length > 0) outputHandle.writeBytes(data);
      if (final) {
        outputHandle.close();
        extracted.set(entry.name, output.uri);
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  try {
    let readBytes = 0;
    while (readBytes < totalBytes) {
      const chunk = handle.readBytes(Math.min(READ_CHUNK_BYTES, totalBytes - readBytes));
      if (chunk.length === 0) break;
      readBytes += chunk.length;
      unzip.push(chunk, readBytes >= totalBytes);
      if (entryError) throw entryError;
      onProgress?.(readBytes, totalBytes);
      await nextFrame();
    }
  } finally {
    handle.close();
  }

  if (jsonChunks.length === 0) throw new Error("ไฟล์ zip นี้ไม่ใช่ไฟล์สำรองของ ShelfWatch");
  const jsonBytes = new Uint8Array(jsonChunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of jsonChunks) { jsonBytes.set(chunk, offset); offset += chunk.length; }
  const backup = parseInventoryBackup(strFromU8(jsonBytes));
  return {
    ...backup,
    imageFiles: (backup.imageFiles ?? []).map((imageFile) => ({ ...imageFile, localUri: extracted.get(imageFile.path) })),
  };
}
