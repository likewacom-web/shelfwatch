import { describe, expect, it } from "vitest";

import { computeGuideCrop } from "../lib/ocr-guide-crop";

describe("label camera guide crop", () => {
  it("maps a centred guide frame on a tall screen to the middle of a 3:4 photo", () => {
    // 400x800 screen, photo 3000x4000 => scale 0.2, photo shown 600x800, offsetX -100
    const crop = computeGuideCrop(3000, 4000, { x: 0, y: 0, width: 400, height: 800 }, { x: 16, y: 325, width: 368, height: 150 });
    // frame in photo: x=(16+100)/0.2=580, width=1840, y=1625, height=750
    expect(crop.x).toBe(Math.floor(580 - 1840 * 0.08));
    expect(crop.width).toBe(Math.ceil(580 + 1840 + 1840 * 0.08) - crop.x);
    expect(crop.y).toBe(1625 - 450);
    expect(crop.height).toBe(750 + 900);
  });

  it("stays inside the photo", () => {
    const crop = computeGuideCrop(1000, 1000, { x: 0, y: 0, width: 100, height: 100 }, { x: -50, y: -50, width: 300, height: 300 });
    expect(crop).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it("falls back to the middle band when the frame was not measured", () => {
    expect(computeGuideCrop(1000, 2000, { x: 0, y: 0, width: 0, height: 0 }, null)).toEqual({ x: 36, y: 120, width: 928, height: 1760 });
  });
});
