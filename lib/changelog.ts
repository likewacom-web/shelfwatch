export interface ChangelogEntry {
  icon: string;
  title: string;
  description: string;
}

export const CURRENT_CHANGELOG: ChangelogEntry[] = [
  { icon: "system-update", title: "ตรวจสอบและอัปเดตแอปได้ง่ายขึ้น", description: "เพิ่มการตรวจสอบอัปเดตอัตโนมัติและปุ่มตรวจสอบการอัปเดตด้วยตนเองในหน้าการตั้งค่า" },
  { icon: "camera-alt", title: "โฟลว์ถ่ายรูปและสแกนต่อเนื่อง", description: "หลังถ่ายรูปสินค้า ระบบตั้งจำนวนเป็น 12 และเปิดหน้าสแกนบาร์โค้ดต่อให้อัตโนมัติ" },
  { icon: "category", title: "จัดการหมวดหมู่ได้เป็นระบบ", description: "รองรับหมวดหมู่ถาวร แก้ไข ลบ และคงหมวดหมู่ล่าสุดที่เลือกไว้สำหรับรายการถัดไป" },
  { icon: "qr-code-scanner", title: "สแกนบาร์โค้ดสะดวกขึ้น", description: "ปรับเลย์เอาต์กล้อง เพิ่มแถบซูม และแสดงสถานะขั้นตอนการถ่ายรูป สแกน และบันทึก" },
  { icon: "backup", title: "สำรองข้อมูลได้ครบถ้วนขึ้น", description: "รองรับการสำรองรูปภาพโปรไฟล์ พื้นหลัง และรูปสินค้า พร้อมบีบอัดรูปภาพอัตโนมัติ" },
];
