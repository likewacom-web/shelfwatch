const NON_PRODUCT_PREFIX = /^(ราคา|วันหมดอายุ|วันผลิต|ผลิต|หมดอายุ|ล็อต|lot|exp|best before)(?:\s|$)/i;

export function normalizeOcrProductName(value: string): string {
  return value
    .replace(/[|•·]+/g, " ")
    .replace(/^[\s"'“”‘’.,:;|/\\-]+|[\s"'“”‘’.,:;|/\\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function acceptOcrProductName(value: string, confidence: number): string {
  const normalized = normalizeOcrProductName(value);
  const hasLetters = /[A-Za-z\u0E00-\u0E7F]/.test(normalized);
  // The user always reviews the OCR result before it is saved, so only drop names the model
  // itself marks as near-guesses. A strict cut-off here used to discard correct Thai names.
  if (confidence < 0.1 || normalized.length < 2 || normalized.length > 120 || !hasLetters || NON_PRODUCT_PREFIX.test(normalized)) {
    return "";
  }
  return normalized;
}

export function collectOcrProductCandidates(productName: string, candidates: unknown, confidence: number): string[] {
  const values = Array.isArray(candidates) ? candidates : [];
  return [...new Set([
    productName,
    ...values.filter((value): value is string => typeof value === "string"),
  ].map((value) => acceptOcrProductName(value, confidence)).filter(Boolean))].slice(0, 5);
}
