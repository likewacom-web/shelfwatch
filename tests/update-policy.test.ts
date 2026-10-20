import { describe, expect, it } from "vitest";

import { shouldCheckForUpdate } from "../lib/update-policy";

describe("shouldCheckForUpdate", () => {
  it("อนุญาตให้ตรวจสอบบน native production", () => {
    expect(shouldCheckForUpdate("android", false, false)).toBe(true);
    expect(shouldCheckForUpdate("ios", false, false)).toBe(true);
  });

  it("ไม่ตรวจสอบบนเว็บ", () => {
    expect(shouldCheckForUpdate("web", false, false)).toBe(false);
  });

  it("ไม่ตรวจสอบในโหมดพัฒนา", () => {
    expect(shouldCheckForUpdate("android", true, false)).toBe(false);
  });

  it("ไม่ยิงคำขอซ้ำระหว่างกำลังตรวจสอบ", () => {
    expect(shouldCheckForUpdate("android", false, true)).toBe(false);
  });

  it("ไม่ตรวจสอบเมื่อ expo-updates ยังไม่เปิดใช้งาน", () => {
    expect(shouldCheckForUpdate("android", false, false, false)).toBe(false);
  });
});
