import { describe, expect, it } from "vitest";

import { getUpdateConnectionStatus } from "../lib/update-status";

describe("getUpdateConnectionStatus", () => {
  it("รายงานพร้อมเมื่อเป็น native production ที่เปิด OTA", () => {
    expect(getUpdateConnectionStatus("android", false, true)).toBe("ready");
  });

  it("รายงานยังไม่ตั้งค่าเมื่อ native ยังไม่เปิด OTA", () => {
    expect(getUpdateConnectionStatus("android", false, false)).toBe("not-configured");
  });

  it("รายงานโหมดพัฒนาหรือเว็บเมื่อไม่ใช่ production native", () => {
    expect(getUpdateConnectionStatus("web", false, true)).toBe("development");
    expect(getUpdateConnectionStatus("ios", true, true)).toBe("development");
  });
});
