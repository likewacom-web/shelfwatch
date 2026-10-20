import { describe, expect, it } from "vitest";

import { acceptOcrProductName, collectOcrProductCandidates, normalizeOcrProductName } from "../lib/ocr";

describe("Thai product label OCR", () => {
  it("preserves Thai spacing and removes label punctuation", () => {
    expect(normalizeOcrProductName("  ‘นม ไทย’  ")).toBe("นม ไทย");
  });

  it("accepts a confident Thai product name", () => {
    expect(acceptOcrProductName("นมสด รสจืด", 0.92)).toBe("นมสด รสจืด");
  });

  it("keeps a readable partial name from a small label for user review", () => {
    expect(acceptOcrProductName("นมสด", 0.36)).toBe("นมสด");
  });

  it("rejects pricing and expiry text", () => {
    expect(acceptOcrProductName("ราคา 45 บาท", 0.98)).toBe("");
    expect(acceptOcrProductName("วันหมดอายุ 12/09/69", 0.98)).toBe("");
  });

  it("rejects uncertain or non-text results", () => {
    expect(acceptOcrProductName("นม", 0.2)).toBe("");
    expect(acceptOcrProductName("1234567890", 0.99)).toBe("");
  });

  it("collects valid Lens-style name candidates and removes non-product text", () => {
    expect(collectOcrProductCandidates("นม ไทย", ["นม ไทย", "นม ไทบ", "ราคา 45 บาท", "วันหมดอายุ 12/09/69", "นมไทย", "", "12345"], 0.9)).toEqual(["นม ไทย", "นม ไทบ", "นมไทย"]);
  });

  it("handles malformed candidate payloads safely", () => {
    expect(collectOcrProductCandidates("ชาเขียว", { unexpected: true }, 0.9)).toEqual(["ชาเขียว"]);
  });
});
