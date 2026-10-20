// Base64 และ JSON ใช้หน่วยความจำมากกว่าขนาดไฟล์รูปจริงหลายเท่า จึงใช้ขีดจำกัดแบบอนุรักษ์นิยมสำหรับอุปกรณ์ Android
export const MAX_BACKUP_IMAGE_BYTES = 1 * 1024 * 1024;
export const MAX_BACKUP_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_BACKUP_SERIALIZED_CHARACTERS = 12 * 1024 * 1024;

export function canIncludeBackupImage(size: number, totalBytes: number): boolean {
  return Number.isFinite(size) && size > 0 && size <= MAX_BACKUP_IMAGE_BYTES && totalBytes + size <= MAX_BACKUP_TOTAL_IMAGE_BYTES;
}

export function assertBackupSerializedSize(serialized: string): void {
  if (serialized.length > MAX_BACKUP_SERIALIZED_CHARACTERS) {
    throw new Error("ไฟล์สำรองมีขนาดใหญ่เกินกว่าที่อุปกรณ์จะสร้างได้อย่างปลอดภัย โปรดลองลบหรือเปลี่ยนรูปขนาดใหญ่ แล้วสำรองใหม่");
  }
}
