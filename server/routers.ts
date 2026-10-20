import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { acceptOcrProductName, collectOcrProductCandidates } from "../lib/ocr";
import { clampOcrConfidence, mergeOcrLines, parseLlmJson } from "../lib/ocr-pipeline";
import { storagePut } from "./storage";

const OCR_MODEL = "gemini-3-flash-preview";

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
        // Gemini 3 "thinks" before answering and those tokens count toward max_tokens.
        // The old 128-token limit was used up by thinking, so the box came back empty.
        const response = await invokeLLM({
          model: OCR_MODEL,
          messages: [
            { role: "system", content: "คุณเป็นระบบหากรอบข้อความชื่อสินค้าในภาพถ่ายชั้นวางหรือฉลากสินค้า ให้คืนกรอบในพิกัด normalized 0 ถึง 1 (x,y คือมุมซ้ายบน) ลำดับความสำคัญ: 1) ป้ายราคา/ป้ายชื่อสีเหลืองบนชั้นวางที่มีชื่อสินค้า 2) ถ้าไม่มีป้ายเหลือง ให้ใช้บริเวณข้อความชื่อสินค้าที่ใหญ่และชัดที่สุดบนฉลากหรือบรรจุภัณฑ์ ไม่ต้องรวมบาร์โค้ด ราคา หรือรูปภาพที่ไม่เกี่ยวข้อง หากไม่พบข้อความเลยให้คืนกรอบเต็มภาพและ confidence ต่ำ ตอบ JSON ตาม schema เท่านั้น" },
            { role: "user", content: [{ type: "text", text: "หากรอบของชื่อสินค้าในภาพนี้ ให้ครอบทั้งบรรทัดชื่อสินค้าและเผื่อขอบเล็กน้อย" }, { type: "image_url", image_url: { url: input.imageDataUrl, detail: "high" } }] },
          ],
          maxTokens: 2048,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "product_name_box",
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
        const parsed = parseLlmJson<{ x: number; y: number; width: number; height: number; confidence: number }>(response.choices[0]?.message?.content);
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
        type LabelResult = { lines: unknown; productName: string; confidence: unknown; productCandidates: unknown };

        // One vision call that transcribes the label and picks the product name together.
        // The old version made two sequential calls with small token limits; Gemini's thinking
        // tokens often used up the limit, so the JSON was cut off and the name came back empty.
        const response = await invokeLLM({
          model: OCR_MODEL,
          messages: [
            { role: "system", content: "คุณเป็นระบบอ่านชื่อสินค้าจากภาพฉลาก/ป้ายสินค้าไทย ขั้นแรกถอดข้อความทุกบรรทัดตามที่เห็นจริง (lines) รักษาสระ วรรณยุกต์ และตัวการันต์ ห้ามเดาข้อความที่มองไม่เห็น จากนั้นเลือกชื่อสินค้า (productName) = แบรนด์ + ชื่อ/รุ่น/รสชาติ ตามที่ปรากฏ เช่น 'นมจืด ไทย-เดนมาร์ก' หรือ 'มาม่า รสต้มยำกุ้ง' ห้ามใช้ราคา ปริมาณ น้ำหนัก หน่วย วันผลิต วันหมดอายุ เลขล็อต เลข อย. บาร์โค้ด หรือคำโฆษณาเป็นชื่อ ถ้าภาพมีภาษาอังกฤษให้คงตามที่เห็น productCandidates คือชื่อที่เป็นไปได้ไม่เกิน 5 แบบ เรียงจากมั่นใจมากไปน้อย (รวม productName เป็นตัวแรก) confidence คือความมั่นใจของ productName 0 ถึง 1 ถ้าไม่พบชื่อสินค้าเลยให้ productName เป็นสตริงว่าง ตอบ JSON ตาม schema เท่านั้น" },
            { role: "user", content: [{ type: "text", text: "อ่านชื่อสินค้าจากภาพนี้" }, { type: "image_url", image_url: { url: input.imageDataUrl, detail: "high" } }] },
          ],
          maxTokens: 4096,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "thai_product_label",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  lines: { type: "array", items: { type: "string" }, maxItems: 40 },
                  productName: { type: "string" },
                  confidence: { type: "number" },
                  productCandidates: { type: "array", items: { type: "string" }, maxItems: 5 },
                },
                required: ["lines", "productName", "confidence", "productCandidates"],
                additionalProperties: false,
              },
            },
          },
        });
        const result = parseLlmJson<LabelResult>(response.choices[0]?.message?.content);
        const detectedText = mergeOcrLines("", result.lines);
        const productName = typeof result.productName === "string" ? result.productName : "";
        // A missing confidence field must not throw away a name the model did return.
        const rawConfidence = clampOcrConfidence(result.confidence);
        const confidence = rawConfidence > 0 ? rawConfidence : productName ? 0.5 : 0;
        let candidates = collectOcrProductCandidates(productName, result.productCandidates, confidence);
        if (candidates.length === 0 && detectedText) {
          // Fallback: offer the first readable transcribed lines so the user can pick one instead of retyping.
          candidates = collectOcrProductCandidates("", detectedText.split("\n").slice(0, 5), 0.5);
        }
        return { productName: candidates[0] ?? "", productCandidates: candidates, detectedText, confidence, transcriptionConfidence: confidence };
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
          model: OCR_MODEL,
          messages: [
            { role: "system", content: "คุณเป็นผู้ตรวจทานชื่อสินค้าไทยจากผล OCR ตอบเป็น JSON object เท่านั้น ห้ามแต่งชื่อสินค้าใหม่ ห้ามเปลี่ยนชื่อแบรนด์โดยไม่มีเหตุผล และห้ามแนะนำราคา วันหมดอายุ ปริมาณ เลขล็อต หรือคำโฆษณา ให้เสนอคำแก้ไขเฉพาะเมื่อมีความเป็นไปได้ว่า OCR อ่านพยัญชนะ สระ วรรณยุกต์ หรือการเว้นวรรคผิด หากข้อความถูกต้องแล้วให้คืน suggestions เป็นอาร์เรย์ว่าง" },
            { role: "user", content: `ตรวจทานผล OCR นี้: ${input.productName}\nเสนอคำแก้ไขภาษาไทยที่เป็นไปได้ไม่เกิน 3 รายการ เรียงจากน่าเชื่อถือที่สุด และต้องคงความหมายกับชื่อสินค้าเดิม` },
          ],
          maxTokens: 2048,
          response_format: { type: "json_object" },
        });
        const parsed = parseLlmJson<{ suggestions: unknown }>(response.choices[0]?.message?.content);
        const suggestions = Array.isArray(parsed.suggestions)
          ? [...new Set(parsed.suggestions.filter((value): value is string => typeof value === "string").map((value) => acceptOcrProductName(value, 1)).filter((value) => value && value !== input.productName.trim()))].slice(0, 3)
          : [];
        return { suggestions };
      }),
  }),
});

export type AppRouter = typeof appRouter;
