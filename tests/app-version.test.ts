import { describe, expect, it } from "vitest";

import { getDisplayAppVersion } from "../lib/app-version";

describe("getDisplayAppVersion", () => {
  it("ใช้เลขเวอร์ชัน native ก่อน", () => {
    expect(getDisplayAppVersion("1.2.3", "1.2.0")).toBe("1.2.3");
  });

  it("ใช้เลขเวอร์ชันจาก Expo config เมื่อไม่มี native version", () => {
    expect(getDisplayAppVersion(null, "1.2.0")).toBe("1.2.0");
  });

  it("แสดงข้อความสำรองเมื่อไม่มีข้อมูลเวอร์ชัน", () => {
    expect(getDisplayAppVersion(undefined, undefined)).toBe("ไม่ทราบ");
  });
});
