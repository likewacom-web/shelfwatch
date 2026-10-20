/**
 * On-device OCR client: the app calls Google Gemini directly with the user's own API key,
 * so no Manus (or any other) server is needed.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { collectOcrProductCandidates } from "@/lib/ocr";
import { clampOcrConfidence, parseLlmJson } from "@/lib/ocr-pipeline";

const API_KEY_STORAGE_KEY = "shelfwatch.geminiApiKey";
const OCR_REPORTS_KEY = "shelfwatch.ocrReports";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Tried in order, fastest first. Reading a label does not need the model to "think", so thinking
// is switched off where the model allows it (that alone saves several seconds per photo).
// "-latest" aliases are fallbacks in case a pinned model is unavailable for this key.
type ModelOption = { model: string; thinking?: Record<string, unknown> };
export const GEMINI_MODELS: ModelOption[] = [
  { model: "gemini-2.5-flash", thinking: { thinkingBudget: 0 } },
  { model: "gemini-flash-lite-latest", thinking: { thinkingBudget: 0 } },
  { model: "gemini-flash-latest", thinking: { thinkingBudget: 0 } },
  { model: "gemini-2.5-flash-lite" },
];
const REQUEST_TIMEOUT_MS = 15_000;
const WORKING_MODEL_KEY = "shelfwatch.geminiWorkingModel";

// Short log of the last request (model, result, seconds) so failures can be diagnosed from the app.
let lastTrace: string[] = [];
export function getLastGeminiTrace(): string {
  return lastTrace.join(" → ");
}

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

let workingModel: ModelOption | null = null;
let workingModelLoaded = false;

async function loadWorkingModel(): Promise<void> {
  if (workingModelLoaded) return;
  workingModelLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(WORKING_MODEL_KEY);
    const saved = raw ? (JSON.parse(raw) as ModelOption) : null;
    if (saved && GEMINI_MODELS.some((m) => m.model === saved.model)) workingModel = saved;
  } catch {
    // ignore
  }
}

function rememberWorkingModel(option: ModelOption) {
  const changed = workingModel?.model !== option.model || JSON.stringify(workingModel?.thinking) !== JSON.stringify(option.thinking);
  workingModel = option;
  if (changed) void AsyncStorage.setItem(WORKING_MODEL_KEY, JSON.stringify(option)).catch(() => undefined);
}

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
      // Small limit: the answer is a few words. A big limit let the model get stuck repeating
      // itself for 30+ seconds (the "AI ตอบช้าเกินไป" error).
      maxOutputTokens: request.maxOutputTokens ?? 512,
      responseMimeType: "application/json",
      responseSchema: request.schema,
    },
  };

  await loadWorkingModel();
  const models = workingModel ? [workingModel, ...GEMINI_MODELS.filter((m) => m.model !== workingModel?.model)] : GEMINI_MODELS;
  let lastError: GeminiError = new GeminiError("server", "no model available");
  lastTrace = [];
  const sizeKb = request.imageBase64 ? Math.round((request.imageBase64.length * 0.75) / 1024) : 0;
  if (sizeKb) lastTrace.push(`รูป ${sizeKb} KB`);
  for (const option of models) {
    // A model that rejects the thinking setting is retried once without it.
    for (const thinking of option.thinking ? [option.thinking, undefined] : [undefined]) {
      // If thinking could not be switched off, the model needs room to think before it answers.
      const thinkingStillOn = option.thinking && !thinking;
      const generationConfig = { ...body.generationConfig, ...(thinking ? { thinkingConfig: thinking } : {}), ...(thinkingStillOn ? { maxOutputTokens: 4096 } : {}) };
      const requestBody = { ...body, generationConfig };
      const startedAt = Date.now();
      const seconds = () => ((Date.now() - startedAt) / 1000).toFixed(1);
      let response: Response;
      try {
        response = await postWithTimeout(`${GEMINI_ENDPOINT}/${option.model}:generateContent?key=${encodeURIComponent(apiKey)}`, requestBody);
      } catch (error) {
        const geminiError = error instanceof GeminiError ? error : new GeminiError("network", String(error));
        lastTrace.push(`${option.model} ${geminiError.code} ${seconds()}s`);
        lastError = geminiError;
        if (geminiError.code === "network") throw geminiError; // no internet: other models won't help
        break; // timeout: try the next (faster) model
      }
      if (response.ok) {
        const json = (await response.json()) as { candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
        const candidate = json.candidates?.[0];
        const text = (candidate?.content?.parts ?? []).filter((part) => !part.thought).map((part) => part.text ?? "").join("");
        lastTrace.push(`${option.model} OK ${seconds()}s${candidate?.finishReason && candidate.finishReason !== "STOP" ? ` (${candidate.finishReason})` : ""}`);
        rememberWorkingModel({ model: option.model, thinking });
        return parseLlmJson<T>(text);
      }
      const errorText = await response.text().catch(() => "");
      lastTrace.push(`${option.model} HTTP ${response.status} ${seconds()}s`);
      if (response.status === 400 && /API key not valid|API_KEY_INVALID/i.test(errorText)) throw new GeminiError("bad-key", errorText);
      if (response.status === 401 || response.status === 403) throw new GeminiError("bad-key", errorText);
      if (response.status === 400 && thinking && /thinking/i.test(errorText)) continue;
      lastError = new GeminiError(response.status === 429 ? "quota" : "server", `${response.status} ${errorText}`);
      break; // try the next model
    }
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
  type Raw = { productName: string; confidence: unknown; productCandidates: unknown };
  // Only the name and a few alternatives are requested (no full transcription):
  // fewer output tokens is the main thing that makes the reply fast.
  const result = await callGeminiJson<Raw>({
    system: "อ่านชื่อสินค้าจากภาพป้าย/ฉลากสินค้าไทย productName = แบรนด์ + ชื่อ/รุ่น/รสชาติ ตามตัวอักษรที่เห็นจริง รักษาสระ วรรณยุกต์ ตัวการันต์ และภาษาอังกฤษตามที่เห็น ห้ามใช้ราคา ปริมาณ น้ำหนัก หน่วย วันผลิต วันหมดอายุ เลขล็อต บาร์โค้ด หรือคำโฆษณาเป็นชื่อ productCandidates = ชื่อที่เป็นไปได้ไม่เกิน 3 แบบ เรียงจากมั่นใจมากไปน้อย confidence = 0 ถึง 1 ถ้าไม่เห็นชื่อสินค้าให้ productName เป็นสตริงว่าง",
    prompt: "ชื่อสินค้าในภาพนี้คืออะไร",
    imageBase64,
    mimeType,
    schema: {
      type: "OBJECT",
      properties: {
        productName: { type: "STRING" },
        confidence: { type: "NUMBER" },
        productCandidates: { type: "ARRAY", items: { type: "STRING" }, maxItems: 3 },
      },
      required: ["productName", "confidence", "productCandidates"],
      propertyOrdering: ["productName", "confidence", "productCandidates"],
    },
  });
  const productName = typeof result.productName === "string" ? result.productName : "";
  const rawConfidence = clampOcrConfidence(result.confidence);
  const confidence = rawConfidence > 0 ? rawConfidence : productName ? 0.5 : 0;
  const candidates = collectOcrProductCandidates(productName, result.productCandidates, confidence);
  return { productName: candidates[0] ?? "", productCandidates: candidates, detectedText: "", confidence };
}

export async function suggestNameCorrections(productName: string): Promise<string[]> {
  const parsed = await callGeminiJson<{ suggestions: unknown }>({
    system: "คุณเป็นผู้ตรวจทานชื่อสินค้าไทยจากผล OCR ห้ามแต่งชื่อสินค้าใหม่ ห้ามเปลี่ยนชื่อแบรนด์โดยไม่มีเหตุผล และห้ามแนะนำราคา วันหมดอายุ ปริมาณ เลขล็อต หรือคำโฆษณา ให้เสนอคำแก้ไขเฉพาะเมื่อมีความเป็นไปได้ว่า OCR อ่านพยัญชนะ สระ วรรณยุกต์ หรือการเว้นวรรคผิด หากข้อความถูกต้องแล้วให้คืน suggestions เป็นอาร์เรย์ว่าง",
    prompt: `ตรวจทานผล OCR นี้: ${productName}\nเสนอคำแก้ไขภาษาไทยที่เป็นไปได้ไม่เกิน 3 รายการ เรียงจากน่าเชื่อถือที่สุด และต้องคงความหมายกับชื่อสินค้าเดิม`,
    schema: { type: "OBJECT", properties: { suggestions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["suggestions"] },
    maxOutputTokens: 512,
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
    maxOutputTokens: 64,
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
