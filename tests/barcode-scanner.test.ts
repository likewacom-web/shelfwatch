import { describe, expect, it } from "vitest";

import { getBarcodeScanDestination, normalizeScannedCode } from "../lib/barcode-scanner";

describe("barcode scanner navigation", () => {
  it("normalizes whitespace around scanned barcode data", () => {
    expect(normalizeScannedCode("  8851234567890\n")).toBe("8851234567890");
  });

  it("opens an existing product when searching by a recognized code", () => {
    expect(getBarcodeScanDestination({ mode: "manage", scannedCode: "8851234567890", matchingProductId: "product-42" })).toEqual({ kind: "product", productId: "product-42" });
  });

  it("takes an unrecognized code to the form and preserves its location", () => {
    expect(getBarcodeScanDestination({ mode: "manage", scannedCode: "  AC-128  ", shelf: "A", row: "2" })).toEqual({ kind: "form", scannedCode: "AC-128", shelf: "A", row: "2" });
  });

  it("routes name scanning back to the form with a name focus field", () => {
    expect(getBarcodeScanDestination({ mode: "name", scannedCode: "  8851234567890  " })).toEqual({ kind: "form", scannedCode: "8851234567890", focusField: "name" });
  });

  it("rejects an empty manual entry", () => {
    expect(getBarcodeScanDestination({ mode: "form", scannedCode: "   " })).toBeNull();
  });
});
