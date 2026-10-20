# Android Prebuild Diagnostics

วันที่ตรวจสอบ: 27 สิงหาคม 2569

## ข้อค้นพบ

- การจำลองคำสั่ง Android Prebuild ล้มเหลวด้วยข้อความ `Could not find MIME for Buffer <null>` จากตัวประมวลผลภาพ Jimp
- ไฟล์ `icon.png`, `splash-icon.png`, `favicon.png` และ `android-icon-foreground.png` เป็นข้อความ ASCII ไม่ใช่ไฟล์ PNG จึงเป็นสาเหตุโดยตรงที่การประมวลผลทรัพยากรภาพของ Android อ่านข้อมูลไม่ได้
- ไฟล์ `android-icon-background.png` และ `android-icon-monochrome.png` เปิดได้ในรูปแบบ PNG แต่เป็นภาพเทมเพลต ไม่ใช่ไอคอนแบรนด์ที่เหมาะจะใช้แทนไอคอนหลัก
- คำสั่ง Prebuild ได้สร้างโฟลเดอร์ `android/` ชั่วคราวและเปลี่ยนสคริปต์ `android`/`ios` ใน `package.json`; ต้องคืนค่าสคริปต์และลบโฟลเดอร์ที่สร้างเพื่อรักษาแนวทาง CNG ก่อนตรวจสอบอีกครั้ง

## ผลการแก้ไข

ได้แทนที่ไฟล์ไอคอนที่เสียหายด้วยไฟล์ PNG ขนาด 1024 × 1024 สำหรับไอคอนหลัก ไอคอนเริ่มต้น ไอคอนเว็บ และ Android adaptive foreground พร้อมปรับการตั้งค่า adaptive icon ให้ใช้พื้นหลังสีแบรนด์โดยตรง จากนั้นคืนค่าสคริปต์พัฒนาและลบโฟลเดอร์ Android ที่สร้างเพื่อทดสอบชั่วคราว

คำสั่ง `pnpm exec expo prebuild --platform android --no-install` ทำงานสำเร็จแล้ว รวมทั้งการตรวจค่า Expo, TypeScript และยูนิตเทสต์ของคลังสินค้า/ไฟล์สำรอง 34 รายการ การสร้าง EAS รอบใหม่จึงควรผ่านขั้นตอน Prebuild นี้ได้ โดยยังต้องรอผลของขั้นตอนบนระบบ EAS หลังส่งสร้างอีกครั้ง
