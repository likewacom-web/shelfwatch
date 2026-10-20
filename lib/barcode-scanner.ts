import type { BarcodeType } from "expo-camera";

export const PRODUCT_BARCODE_TYPES = ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"] as const satisfies BarcodeType[];

export type ScannerMode = "form" | "manage" | "name";
export type BarcodeScanDestination =
  | { kind: "product"; productId: string }
  | { kind: "form"; scannedCode: string; shelf?: string; row?: string; focusField?: "name"; category?: string; quantity?: string; imageUri?: string };

export function normalizeScannedCode(value: string): string {
  return value.trim();
}

export function getBarcodeScanDestination({ mode, scannedCode, matchingProductId, shelf, row, category, quantity, imageUri }: { mode: ScannerMode; scannedCode: string; matchingProductId?: string; shelf?: string; row?: string; category?: string; quantity?: string; imageUri?: string }): BarcodeScanDestination | null {
  const code = normalizeScannedCode(scannedCode);
  if (!code) return null;
  if (mode === "manage" && matchingProductId) return { kind: "product", productId: matchingProductId };
  return { kind: "form", scannedCode: code, shelf, row, focusField: mode === "name" ? "name" : undefined, category, quantity, imageUri };
}
