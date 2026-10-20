import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { acceptOcrProductName, collectOcrProductCandidates } from "../lib/ocr";
import { clampOcrConfidence, mergeOcrLines } from "../lib/ocr-pipeline";
import { storagePut } from "./storage";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  ocr: router({
    recordBoxFeedback: publicProcedure
      .input(z.object({
        eventType: z.enum(["selection", "finalize"]),
        userChoice: z.enum(["auto", "manual"]),
        confidence: z.number().min(0).max(1).nullable(),
        note: z.string().max(240).default(""),
        suggestedBox: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).nullable(),
        finalBox: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).nullable(),
      }))
      .mutation(async ({ input }) => {
        const createdAt = new Date().toISOString();
        const record = {
          schemaVersion: 1,
          createdAt,
          eventType: input.eventType,
          userChoice: input.userChoice,
          confidence: input.confidence,
          note: input.note.trim(),
          suggestedBox: input.suggestedBox,
          finalBox: input.finalBox,
        };
        await storagePut(`ocr-feedback/box-decisions/${createdAt.slice(0, 10)}/${crypto.randomUUID()}.json`, JSON.stringify(record), "application/json");
        return { success: true } as const;
      }),
    detectYellowLabel: publicProcedure
      .input(z.object({ imageDataUrl: z.string().startsWith("data:image/").max(12_000_000) }))
      .mutation(async ({ input }) => {
        const response = await invokeLLM({
          model: "gemini-3-flash-preview",
          messages: [
            { role: "system", content: "คุณเป็นระบบตรวจจับกรอบป้ายราคาสีเหลืองในภาพชั้นวางสินค้า ให้คืนกรอบของป้ายสีเหลืองที่มีข้อความชื่อสินค้าในพิกัด normalized 0 ถึง 1 เท่านั้น ห้ามเลือกบรรจุภัณฑ์หรือวัตถุสีเหลืองอื่น หากไม่พบให้คืน confidence ต่ำและกรอบเต็มภาพ" },
            { role: "user", content: [{ type: "text", text: "ค้นหาป้ายชื่อหรือป้ายราคาสีเหลืองที่อยู่ใกล้ชั้นวางและมีข้อความสินค้า ให้ครอบรวมทั้งแถบชื่อสินค้าและเผื่อขอบเล็กน้อย แต่ไม่ต้องรวมสินค้าด้านบนหรือบาร์โค้ดที่อยู่นอกป้าย" }, { type: "image_url", image_url: { url: input.imageDataUrl, detail: "high" } }] },
          ],
          maxTokens: 128,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "yellow_label_box",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  height: { type: "number" },
                  confidence: { type: "number" },
                },
                required: ["x", "y", "width", "height", "confidence"],
                additionalProperties: false,
              },
            },
          },
        });
        const content = response.choices[0]?.message?.content;
        let parsed: { x?: number; y?: number; width?: number; height?: number; confidence?: number } = {};
        try { parsed = typeof content === "string" ? (JSON.parse(content) as typeof parsed) : {}; } catch { parsed = {}; }
        const clamp = (value: number | undefined, fallback: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value as number : fallback));
        const x = clamp(parsed.x, 0);
        const y = clamp(parsed.y, 0);
        const width = Math.min(1 - x, Math.max(0.05, clamp(parsed.width, 1)));
        const height = Math.min(1 - y, Math.max(0.05, clamp(parsed.height, 1)));
        return { x, y, width, height, confidence: clamp(parsed.confidence, 0) };
      }),
    productLabel: publicProcedure
      .input(z.object({ imageDataUrl: z.string().startsWith("data:image/").max(12_000_000) }))
      .mutation(async ({ input }) => {
        type TranscriptionResult = { fullText?: string; lines?: unknown; confidence?: unknown };
        type ProductResult = { productName?: string; confidence?: unknown; productCandidates?: unknown };
        const parseJson = <T,>(content: unknown): T => {
          if (typeof content !== "string") return {} as T;
          try { return JSON.parse(content) as T; } catch { return {} as T; }
        };

        // รอบที่ 1: ทำ full-text detection แบบ document OCR ให้ได้ข้อความทุกบรรทัดก่อน
        const transcriptionResponse = await invokeLLM({
          model: "gemini-3-flash-preview",
          messages: [
            { role: "system", content: "คุณเป็นระบบถอดข้อความจากภาพฉลากสินค้าไทยแบบ document text detection อ่านตัวอักษรทุกบรรทัดตามที่เห็นจริง ห้ามสรุป ห้ามเดา และห้ามตัดราคา วันหมดอายุ ปริมาณ หรือบาร์โค้ดออก เพราะข้อมูลทั้งหมดจะถูกส่งให้ขั้นตอนคัดชื่อสินค้าในภายหลัง รักษาลำดับบรรทัด ภาษาไทย วรรณยุกต์ และตัวการันต์ ตอบ JSON ตาม schema เท่านั้น" },
            { role: "user", content: [{ type: "text", text: "ถอดข้อความทุกบรรทัดในภาพนี้จากบนลงล่าง ถ้าบรรทัดใดอ่านไม่ชัดให้ใส่เฉพาะส่วนที่เห็นจริง พร้อมคืน fullText และ lines" }, { type: "image_url", image_url: { url: input.imageDataUrl, detail: "high" } }] },
          ],
          maxTokens: 768,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "thai_label_transcription",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  fullText: { type: "string" },
                  lines: { type: "array", items: { type: "string" }, maxItems: 80 },
                  confidence: { type: "number" },
                },
                required: ["fullText", "lines", "confidence"],
                additionalProperties: false,
              },
            },
          },
        });
        const transcription = parseJson<TranscriptionResult>(transcriptionResponse.choices[0]?.message?.content);
        const detectedText = mergeOcrLines(typeof transcription.fullText === "string" ? transcription.fullText : "", transcription.lines);
        const transcriptionConfidence = clampOcrConfidence(transcription.confidence);

        // รอบที่ 2: ใช้ภาพจริง + transcription เพื่อคัดชื่อสินค้า ลดการดึงราคา/วันหมดอายุเป็นชื่อ
        const productResponse = await invokeLLM({
          model: "gemini-3-flash-preview",
          messages: [
            { role: "system", content: "คุณเป็นผู้คัดชื่อสินค้าไทยจากผล document OCR แบบ Google Lens ให้เลือกเฉพาะชื่อสินค้า/แบรนด์ที่มีหลักฐานจากภาพหรือข้อความถอดได้ ห้ามแต่งชื่อใหม่ ห้ามใช้ราคา ปริมาณ หน่วย น้ำหนัก วันผลิต วันหมดอายุ เลขล็อต เลข อย. บาร์โค้ด หรือคำโฆษณาเป็นชื่อสินค้า หากข้อความถอดผิด ให้ตรวจเทียบกับภาพจริงและแก้เฉพาะตัวอักษรที่มีหลักฐาน ตอบ JSON ตาม schema เท่านั้น" },
            { role: "user", content: [{ type: "text", text: `ผลถอดข้อความทุกบรรทัดจากรอบแรก:\n${detectedText || "(ไม่พบข้อความที่เชื่อถือได้)"}\n\nคัดชื่อสินค้า/แบรนด์ที่เป็นไปได้ไม่เกิน 5 แบบ เรียงจากมั่นใจมากไปน้อย ตรวจภาพจริงซ้ำ โดยเฉพาะสระ วรรณยุกต์ และตัวการันต์ คืน confidence ของชื่อที่เลือก ไม่ใช่ confidence ของการมองเห็นภาพ` }, { type: "image_url", image_url: { url: input.imageDataUrl, detail: "high" } }] },
          ],
          maxTokens: 512,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "thai_product_name_candidates",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  productName: { type: "string" },
                  confidence: { type: "number" },
                  productCandidates: { type: "array", items: { type: "string" }, maxItems: 5 },
                },
                required: ["productName", "confidence", "productCandidates"],
                additionalProperties: false,
              },
            },
          },
        });
        const product = parseJson<ProductResult>(productResponse.choices[0]?.message?.content);
        const confidence = clampOcrConfidence(product.confidence) || transcriptionConfidence;
        const candidates = collectOcrProductCandidates(product.productName ?? "", product.productCandidates, confidence);
        return { productName: candidates[0] ?? "", productCandidates: candidates, detectedText, confidence, transcriptionConfidence };
      }),
    reportError: publicProcedure
      .input(z.object({ imageDataUrl: z.string().startsWith("data:image/").max(12_000_000), ocrText: z.string().max(120).default(""), correctedText: z.string().min(1).max(120) }))
      .mutation(async ({ input }) => {
        const match = input.imageDataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
        if (!match) throw new Error("invalid-image-data");
        const contentType = match[1].toLowerCase();
        const extension = contentType.includes("png") ? "png" : "jpg";
        const timestamp = new Date().toISOString();
        const image = await storagePut(`ocr-reports/${timestamp}.${extension}`, Buffer.from(match[2], "base64"), contentType);
        await storagePut(`ocr-reports/${timestamp}-${crypto.randomUUID()}.json`, JSON.stringify({ ocrText: input.ocrText, correctedText: input.correctedText, imageUrl: image.url, createdAt: timestamp }), "application/json");
        return { success: true } as const;
      }),
    suggestCorrections: publicProcedure
      .input(z.object({ productName: z.string().min(1).max(120) }))
      .mutation(async ({ input }) => {
        const response = await invokeLLM({
          model: "gemini-3-flash-preview",
          messages: [
            { role: "system", content: "คุณเป็นผู้ตรวจทานชื่อสินค้าไทยจากผล OCR ตอบเป็น JSON object เท่านั้น ห้ามแต่งชื่อสินค้าใหม่ ห้ามเปลี่ยนชื่อแบรนด์โดยไม่มีเหตุผล และห้ามแนะนำราคา วันหมดอายุ ปริมาณ เลขล็อต หรือคำโฆษณา ให้เสนอคำแก้ไขเฉพาะเมื่อมีความเป็นไปได้ว่า OCR อ่านพยัญชนะ สระ วรรณยุกต์ หรือการเว้นวรรคผิด หากข้อความถูกต้องแล้วให้คืน suggestions เป็นอาร์เรย์ว่าง" },
            { role: "user", content: `ตรวจทานผล OCR นี้: ${input.productName}\nเสนอคำแก้ไขภาษาไทยที่เป็นไปได้ไม่เกิน 3 รายการ เรียงจากน่าเชื่อถือที่สุด และต้องคงความหมายกับชื่อสินค้าเดิม` },
          ],
          maxTokens: 256,
          response_format: { type: "json_object" },
        });
        const content = response.choices[0]?.message?.content;
        let parsed: { suggestions?: unknown } = {};
        try {
          parsed = typeof content === "string" ? (JSON.parse(content) as { suggestions?: unknown }) : {};
        } catch {
          parsed = {};
        }
        const suggestions = Array.isArray(parsed.suggestions)
          ? [...new Set(parsed.suggestions.filter((value): value is string => typeof value === "string").map((value) => acceptOcrProductName(value, 1)).filter((value) => value && value !== input.productName.trim()))].slice(0, 3)
          : [];
        return { suggestions };
      }),
  }),
});

export type AppRouter = typeof appRouter;
