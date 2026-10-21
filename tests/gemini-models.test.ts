import { describe, expect, it } from "vitest";

import { rankFlashModels } from "../lib/gemini-models";

describe("Gemini model selection", () => {
  it("keeps text Flash models, stable before preview, newest first, Lite before regular Flash", () => {
    const names = [
      "models/gemini-2.5-flash-lite", "models/gemini-3.5-flash", "models/gemini-3.5-flash-lite", "models/gemini-3.5-flash-image",
      "models/gemini-3.5-flash-tts", "models/gemini-3.1-pro-preview", "models/gemini-3.6-flash-preview-05-2026", "models/text-embedding-004",
      "models/gemini-flash-latest",
    ];
    expect(rankFlashModels(names)).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-2.5-flash-lite", "gemini-3.6-flash-preview-05-2026"]);
  });

  it("returns nothing for an empty list", () => {
    expect(rankFlashModels([])).toEqual([]);
  });
});
