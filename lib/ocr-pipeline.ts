export type OcrTranscription = {
  fullText: string;
  lines: string[];
  confidence: number;
};

export function normalizeOcrDetectedText(value: string): string {
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 80)
    .join("\n")
    .slice(0, 3000);
}

export function mergeOcrLines(fullText: string, lines: unknown): string {
  const sourceLines = Array.isArray(lines)
    ? lines.filter((line): line is string => typeof line === "string")
    : [];
  return normalizeOcrDetectedText([fullText, ...sourceLines].filter(Boolean).join("\n"));
}

export function clampOcrConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

/**
 * Parse JSON returned by the LLM. Models sometimes wrap JSON in ```json fences or add
 * text around it, and a truncated reply must not crash the OCR flow.
 */
export function parseLlmJson<T extends object>(content: unknown): Partial<T> {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
      .join("");
  }
  text = text.trim();
  if (!text) return {};
  const candidates = [text, text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Partial<T>;
    } catch {
      // try the next candidate
    }
  }
  return {};
}
