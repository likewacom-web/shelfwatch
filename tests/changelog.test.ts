import { describe, expect, it } from "vitest";

import { CURRENT_CHANGELOG } from "../lib/changelog";

describe("CURRENT_CHANGELOG", () => {
  it("มีรายการการเปลี่ยนแปลงที่แสดงผลได้", () => {
    expect(CURRENT_CHANGELOG.length).toBeGreaterThan(0);
    expect(CURRENT_CHANGELOG.every((item) => item.icon && item.title && item.description)).toBe(true);
  });

  it("ครอบคลุมฟีเจอร์อัปเดตและการทำงานหลักของเวอร์ชัน", () => {
    const text = CURRENT_CHANGELOG.map((item) => `${item.title} ${item.description}`).join(" ");
    expect(text).toContain("อัปเดต");
    expect(text).toContain("บาร์โค้ด");
    expect(text).toContain("หมวดหมู่");
  });
});
