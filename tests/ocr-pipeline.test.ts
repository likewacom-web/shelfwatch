import { describe, expect, it } from "vitest";

import { clampOcrConfidence, mergeOcrLines, normalizeOcrDetectedText, parseLlmJson } from "../lib/ocr-pipeline";

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

  it("parses LLM JSON even when wrapped in code fences or extra text", () => {
    expect(parseLlmJson<{ productName: string }>('{"productName":"นมไทย"}')).toEqual({ productName: "นมไทย" });
    expect(parseLlmJson<{ productName: string }>('```json\n{"productName":"นมไทย"}\n```')).toEqual({ productName: "นมไทย" });
    expect(parseLlmJson<{ productName: string }>('ผลลัพธ์: {"productName":"ชาเขียว"} จบ')).toEqual({ productName: "ชาเขียว" });
    expect(parseLlmJson<{ productName: string }>([{ type: "text", text: '{"productName":"กาแฟ"}' }])).toEqual({ productName: "กาแฟ" });
  });

  it("returns an empty object for truncated or missing JSON", () => {
    expect(parseLlmJson('{"productName":"นม')).toEqual({});
    expect(parseLlmJson(undefined)).toEqual({});
    expect(parseLlmJson("")).toEqual({});
  });
});
