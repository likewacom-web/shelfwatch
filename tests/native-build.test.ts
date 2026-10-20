import { describe, expect, it } from "vitest";

import { getNativeBuildDownloadUrl, getNativeBuildVersion } from "../lib/native-build";

describe("getNativeBuildDownloadUrl", () => {
  it("ยอมรับลิงก์ HTTP และตัดช่องว่าง", () => {
    expect(getNativeBuildDownloadUrl("  https://example.com/app.apk  ")).toBe("https://example.com/app.apk");
  });

  it("ปฏิเสธค่าที่ว่างหรือไม่ใช่ HTTP URL", () => {
    expect(getNativeBuildDownloadUrl("")).toBeNull();
    expect(getNativeBuildDownloadUrl("app.apk")).toBeNull();
    expect(getNativeBuildDownloadUrl(null)).toBeNull();
  });
});

describe("getNativeBuildVersion", () => {
  it("อ่านเลขเวอร์ชันและตัดช่องว่าง", () => {
    expect(getNativeBuildVersion("  1.4.0 (42) ")).toBe("1.4.0 (42)");
  });

  it("คืนค่า null เมื่อยังไม่ได้กำหนดเวอร์ชัน", () => {
    expect(getNativeBuildVersion(" ")).toBeNull();
    expect(getNativeBuildVersion(undefined)).toBeNull();
  });
});
