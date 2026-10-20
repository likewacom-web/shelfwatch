# ShelfWatch

แอปติดตามวันหมดอายุสินค้าบนชั้นวาง (Expo / React Native) — เวอร์ชันแยกจาก Manus

- ข้อมูลสินค้าเก็บในเครื่อง (AsyncStorage) ไม่ต้องมีเซิร์ฟเวอร์
- การอ่านชื่อสินค้าจากรูปเรียก Google Gemini โดยตรง ใส่ API key ฟรีจาก https://aistudio.google.com/apikey ในหน้าตั้งค่าของแอป
- ทุกครั้งที่ push เข้า `main` GitHub Actions จะ build APK ให้อัตโนมัติ ดาวน์โหลดได้จากหน้า Releases
- APK ทุกตัวเซ็นด้วย `signing/shelfwatch-release.keystore` (รหัส `android`) เพื่อให้ติดตั้งทับเวอร์ชันเก่าได้ — อย่าลบไฟล์นี้ และเก็บ repo เป็น private
