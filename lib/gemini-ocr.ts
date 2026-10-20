/**
 * On-device OCR client: the app calls Google Gemini directly with the user's own API key,
 * so no Manus (or any other) server is needed.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { collectOcrProductCandidates } from "@/lib/ocr";
import { clampOcrConfidence, mergeOcrLines, parseLlmJson } from "@/lib/ocr-pipeline";

const API_KEY_STORAGE_KEY = "shelfwatch.geminiApiKey";
const OCR_REPORTS_KEY = "shelfwatch.ocrReports";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Tried in order. "-latest" aliases follow Google's current Flash models; the pinned
// names are fallbacks in case an alias is unavailable for this key.
export const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
const REQUEST_TIMEOUT_MS = 45_000;

export class GeminiError extends Error {
  constructor(public code: "no-key" | "bad-key" | "quota" | "network" | "timeout" | "server", message: string) {
    super(message);
    this.name = "GeminiError";
  }
}

export function describeGeminiError(error: unknown): string {
  if (error instanceof GeminiError) {
    switch (error.code) {
      case "no-key": return "ยังไม่ได้ใส่ Gemini API key ไปที่หน้าตั้งค่า > อ่านชื่อสินค้าด้วย AI";
      case "bad-key": return "Gemini API key ไม่ถูกต้อง ตรวจสอบ key ในหน้าตั้งค่า";
      case "quota": return "ใช้โควตา Gemini ฟรีครบแล้ว รอสักครู่แล้วลองใหม่";
      case "network": return "เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบเน็ตแล้วลองใหม่";
      case "timeout": return "AI ตอบช้าเกินไป ลองใหม่อีกครั้ง";
      default: return "ระบบอ่านข้อความขัดข้องชั่วคราว ลองใหม่อีกครั้ง";
    }
  }
  return "อ่านข้อความไม่สำเร็จ ลองใหม่อีกครั้ง";
}

// ---------- API key storage ----------

const canUseSecureStore = Platform.OS !== "web";

export async function getGeminiApiKey(): Promise<string> {
  try {
    const value = canUseSecureStore ? await SecureStore.getItemAsync(API_KEY_STORAGE_KEY) : await AsyncStorage.getItem(API_KEY_STORAGE_KEY);
    return value?.trim() ?? "";
  } catch {
    return "";
  }
}

export async function setGeminiApiKey(value: string): Promise<void> {
  const key = value.trim();
  if (canUseSecureStore) {
    if (key) await SecureStore.setItemAsync(API_KEY_STORAGE_KEY, key);
    else await SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY);
  } else if (key) await AsyncStorage.setItem(API_KEY_STORAGE_KEY, key);
  else await AsyncStorage.removeItem(API_KEY_STORAGE_KEY);
}

export function maskApiKey(key: string): string {
  if (!key) return "";
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

// ---------- Core request ----------

type GeminiSchema = Record<string, unknown>;
type GeminiRequest = { system: string; prompt: string; imageBase64?: string; mimeType?: string; schema: GeminiSchema; maxOutputTokens?: number };

let workingModel: string | null = null;

async function postWithTimeout(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw new GeminiError("timeout", "timeout");
    throw new GeminiError("network", String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiJson<T extends object>(request: GeminiRequest, apiKeyOverride?: string): Promise<Partial<T>> {
  const apiKey = apiKeyOverride ?? await getGeminiApiKey();
  if (!apiKey) throw new GeminiError("no-key", "missing api key");

  const parts: Record<string, unknown>[] = [];
  if (request.imageBase64) parts.push({ inline_data: { mime_type: request.mimeType ?? "image/jpeg", data: request.imageBase64 } });
  parts.push({ text: request.prompt });
  const body = {
    system_instruction: { parts: [{ text: request.system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.1,
      // Large limit on purpose: newer Flash models spend tokens "thinking" before answering.
      maxOutputTokens: request.maxOutputTokens ?? 8192,
      responseMimeType: "application/json",
      responseSchema: request.schema,
    },
  };

  const models = workingModel ? [workingModel, ...GEMINI_MODELS.filter((m) => m !== workingModel)] : GEMINI_MODELS;
  let lastError: GeminiError = new GeminiError("server", "no model available");
  for (const model of models) {
    const response = await postWithTimeout(`${GEMINI_ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, body);
    if (response.ok) {
      workingModel = model;
      const json = (await response.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      const text = (json.candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought).map((part) => part.text ?? "").join("");
      return parseLlmJson<T>(text);
    }
    const errorText = await response.text().catch(() => "");
    if (response.status === 400 && /API key not valid|API_KEY_INVALID/i.test(errorText)) throw new GeminiError("bad-key", errorText);
    if (response.status === 401 || response.status === 403) throw new GeminiError("bad-key", errorText);
    if (response.status === 429) { lastError = new GeminiError("quota", errorText); continue; }
    if (response.status === 404 || response.status === 400) { lastError = new GeminiError("server", errorText); continue; }
    lastError = new GeminiError("server", `${response.status} ${errorText}`);
  }
  throw lastError;
}

// ---------- OCR features ----------

export type LabelBox = { x: number; y: number; width: number; height: number; confidence: number };

export async function detectProductNameBox(imageBase64: string): Promise<LabelBox> {
  const parsed = await callGeminiJson<LabelBox>({
    system: "คุณเป็นระบบหากรอบข้อความชื่อสินค้าในภาพถ่ายชั้นวางหรือฉลากสินค้า ให้คืนกรอบในพิกัด normalized 0 ถึง 1 (x,y คือมุมซ้ายบน) ลำดับความสำคัญ: 1) ป้ายราคา/ป้ายชื่อสีเหลืองบนชั้นวางที่มีชื่อสินค้า 2) ถ้าไม่มีป้ายเหลือง ให้ใช้บริเวณข้อความชื่อสินค้าที่ใหญ่และชัดที่สุดบนฉลากหรือบรรจุภัณฑ์ ไม่ต้องรวมบาร์โค้ด ราคา หรือรูปภาพที่ไม่เกี่ยวข้อง หากไม่พบข้อความเลยให้คืนกรอบเต็มภาพและ confidence ต่ำ",
    prompt: "หากรอบของชื่อสินค้าในภาพนี้ ให้ครอบทั้งบรรทัดชื่อสินค้าและเผื่อขอบเล็กน้อย",
    imageBase64,
    schema: {
      type: "OBJECT",
      properties: { x: { type: "NUMBER" }, y: { type: "NUMBER" }, width: { type: "NUMBER" }, height: { type: "NUMBER" }, confidence: { type: "NUMBER" } },
      required: ["x", "y", "width", "height", "confidence"],
    },
  });
  const clamp = (value: number | undefined, fallback: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value as number : fallback));
  const x = clamp(parsed.x, 0);
  const y = clamp(parsed.y, 0);
  const width = Math.min(1 - x, Math.max(0.05, clamp(parsed.width, 1)));
  const height = Math.min(1 - y, Math.max(0.05, clamp(parsed.height, 1)));
  return { x, y, width, height, confidence: clamp(parsed.confidence, 0) };
}

export type ProductLabelResult = { productName: string; productCandidates: string[]; detectedText: string; confidence: number };

export async function readProductLabelImage(imageBase64: string, mimeType = "image/jpeg"): Promise<ProductLabelResult> {
  type Raw = { lines: unknown; productName: string; confidence: unknown; productCandidates: unknown };
  const result = await callGeminiJson<Raw>({
    system: "คุณเป็นระบบอ่านชื่อสินค้าจากภาพฉลาก/ป้ายสินค้าไทย ขั้นแรกถอดข้อความทุกบรรทัดตามที่เห็นจริง (lines) รักษาสระ วรรณยุกต์ และตัวการันต์ ห้ามเดาข้อความที่มองไม่เห็น จากนั้นเลือกชื่อสินค้า (productName) = แบรนด์ + ชื่อ/รุ่น/รสชาติ ตามที่ปรากฏ เช่น 'นมจืด ไทย-เดนมาร์ก' หรือ 'มาม่า รสต้มยำกุ้ง' ห้ามใช้ราคา ปริมาณ น้ำหนัก หน่วย วันผลิต วันหมดอายุ เลขล็อต เลข อย. บาร์โค้ด หรือคำโฆษณาเป็นชื่อ ถ้าภาพมีภาษาอังกฤษให้คงตามที่เห็น productCandidates คือชื่อที่เป็นไปได้ไม่เกิน 5 แบบ เรียงจากมั่นใจมากไปน้อย (รวม productName เป็นตัวแรก) confidence คือความมั่นใจของ productName 0 ถึง 1 ถ้าไม่พบชื่อสินค้าเลยให้ productName เป็นสตริงว่าง",
    prompt: "อ่านชื่อสินค้าจากภาพนี้",
    imageBase64,
    mimeType,
    schema: {
      type: "OBJECT",
      properties: {
        lines: { type: "ARRAY", items: { type: "STRING" } },
        productName: { type: "STRING" },
        confidence: { type: "NUMBER" },
        productCandidates: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["lines", "productName", "confidence", "productCandidates"],
      propertyOrdering: ["lines", "productName", "confidence", "productCandidates"],
    },
  });
  const detectedText = mergeOcrLines("", result.lines);
  const productName = typeof result.productName === "string" ? result.productName : "";
  const rawConfidence = clampOcrConfidence(result.confidence);
  const confidence = rawConfidence > 0 ? rawConfidence : productName ? 0.5 : 0;
  let candidates = collectOcrProductCandidates(productName, result.productCandidates, confidence);
  if (candidates.length === 0 && detectedText) candidates = collectOcrProductCandidates("", detectedText.split("\n").slice(0, 5), 0.5);
  return { productName: candidates[0] ?? "", productCandidates: candidates, detectedText, confidence };
}

export async function suggestNameCorrections(productName: string): Promise<string[]> {
  const parsed = await callGeminiJson<{ suggestions: unknown }>({
    system: "คุณเป็นผู้ตรวจทานชื่อสินค้าไทยจากผล OCR ห้ามแต่งชื่อสินค้าใหม่ ห้ามเปลี่ยนชื่อแบรนด์โดยไม่มีเหตุผล และห้ามแนะนำราคา วันหมดอายุ ปริมาณ เลขล็อต หรือคำโฆษณา ให้เสนอคำแก้ไขเฉพาะเมื่อมีความเป็นไปได้ว่า OCR อ่านพยัญชนะ สระ วรรณยุกต์ หรือการเว้นวรรคผิด หากข้อความถูกต้องแล้วให้คืน suggestions เป็นอาร์เรย์ว่าง",
    prompt: `ตรวจทานผล OCR นี้: ${productName}\nเสนอคำแก้ไขภาษาไทยที่เป็นไปได้ไม่เกิน 3 รายการ เรียงจากน่าเชื่อถือที่สุด และต้องคงความหมายกับชื่อสินค้าเดิม`,
    schema: { type: "OBJECT", properties: { suggestions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["suggestions"] },
    maxOutputTokens: 4096,
  });
  const values = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  return collectOcrProductCandidates("", values, 1).filter((value) => value !== productName.trim()).slice(0, 3);
}

/** Quick check used by the settings screen. */
export async function testGeminiApiKey(apiKey: string): Promise<void> {
  await callGeminiJson<{ ok: boolean }>({
    system: "ตอบ JSON เท่านั้น",
    prompt: "ตอบ ok เป็น true",
    schema: { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"] },
    maxOutputTokens: 1024,
  }, apiKey.trim());
}

/** OCR error reports are kept on the device (there is no server any more). */
export async function saveOcrReport(report: { ocrText: string; correctedText: string }): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(OCR_REPORTS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    list.unshift({ ...report, createdAt: new Date().toISOString() });
    await AsyncStorage.setItem(OCR_REPORTS_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    // Reports are optional.
  }
}
