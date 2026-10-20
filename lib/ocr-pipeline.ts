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
