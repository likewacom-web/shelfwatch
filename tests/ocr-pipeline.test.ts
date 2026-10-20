import { describe, expect, it } from "vitest";

import { clampOcrConfidence, mergeOcrLines, normalizeOcrDetectedText } from "../lib/ocr-pipeline";

describe("server OCR pipeline helpers", () => {
  it("normalizes and limits noisy multiline transcription", () => {
    expect(normalizeOcrDetectedText("  นม   ไทย  \r\n\n ราคา 45 บาท \n ")).toBe("นม ไทย\nราคา 45 บาท");
  });

  it("merges full text and line results without crashing on malformed arrays", () => {
    expect(mergeOcrLines("นม ไทย", ["รสจืด", 123, null, "ราคา 45"])).toBe("นม ไทย\nรสจืด\nราคา 45");
    expect(mergeOcrLines("ชาเขียว", { bad: true })).toBe("ชาเขียว");
  });

  it("clamps invalid confidence values", () => {
    expect(clampOcrConfidence(1.4)).toBe(1);
    expect(clampOcrConfidence(-0.2)).toBe(0);
    expect(clampOcrConfidence("bad")).toBe(0);
  });
});
